const express = require('express');
const multer = require('multer');
const { body, param, validationResult } = require('express-validator');
const { validate: uuidValidate } = require('uuid');
const { pool } = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { canManageCatalog } = require('../utils/userRoles');
const { getCached, setCached, invalidateCatalogCache } = require('../lib/catalogRedis');
const { buildCatalogXlsx, parseImportBuffer, validateImportRows, applyImportRows } = require('../lib/catalogExcel');
const {
  logCatalogChanges,
  logItemCreate,
  itemUpdateChanges,
  categoryUpdateChanges,
  fetchCatalogHistory,
} = require('../lib/catalogChangeLog');
const {
  normalizePrefix,
  suggestNextCodigo,
  validateCategoryCodigo,
  afterItemCodigoSaved,
  syncCategoryNextSeq,
} = require('../lib/catalogCodigo');
const {
  previewPrefixRegularization,
  applyPrefixRegularization,
} = require('../lib/catalogPrefixRegularize');
const { verifyUserPassword } = require('../lib/verifyUserPassword');
const {
  isOtrosCategory,
  deactivateCatalogCategory,
} = require('../lib/catalogCategoryLifecycle');
const { normalizeBool, regularizeCatalogActiveFlags } = require('../lib/catalogNormalize');
const { assertUniqueDescription } = require('../lib/catalogItemUniqueness');
const {
  fetchDirectDependencies,
  setItemDependencies,
  resolveDependencyBundle,
} = require('../lib/catalogItemDependencies');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok =
      /\.(xlsx|xls)$/i.test(file.originalname) ||
      [
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel',
      ].includes(file.mimetype);
    cb(null, ok);
  },
});

const router = express.Router();
router.use(requireAuth);

function mapCategory(row) {
  return {
    id: row.id,
    nombre: row.nombre,
    codigoPrefix: row.codigo_prefix || null,
    nextSeq: row.next_seq != null ? Number(row.next_seq) : 1,
    sortOrder: row.sort_order,
    active: normalizeBool(row.active, true),
    defaultApplyAdjustment: row.default_apply_adjustment !== false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapItem(row) {
  return {
    id: row.id,
    categoryId: row.category_id,
    categoryNombre: row.category_nombre || null,
    codigo: row.codigo,
    descripcion: row.descripcion,
    unidad: row.unidad,
    tipo: row.tipo,
    unitPrice: row.unit_price != null ? Number(row.unit_price) : 0,
    active: normalizeBool(row.active, true),
    sortOrder: row.sort_order,
    dependencyCount: row.dependency_count != null ? Number(row.dependency_count) : 0,
    hasDependencies: row.dependency_count != null ? Number(row.dependency_count) > 0 : false,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function fetchCatalogFromDb(includeInactive) {
  const { rows: catRows } = await pool.query(
    includeInactive
      ? `SELECT * FROM catalog_categories ORDER BY sort_order ASC, nombre ASC`
      : `SELECT * FROM catalog_categories WHERE active IS TRUE ORDER BY sort_order ASC, nombre ASC`
  );

  let itemSql;
  if (includeInactive) {
    itemSql = `
      SELECT i.*, c.nombre AS category_nombre,
        (SELECT COUNT(*)::int FROM catalog_item_dependencies d WHERE d.parent_item_id = i.id) AS dependency_count
      FROM catalog_items i
      JOIN catalog_categories c ON c.id = i.category_id
      ORDER BY c.sort_order ASC, i.sort_order ASC, i.codigo ASC`;
  } else {
    itemSql = `
      SELECT i.*, c.nombre AS category_nombre,
        (SELECT COUNT(*)::int FROM catalog_item_dependencies d WHERE d.parent_item_id = i.id) AS dependency_count
      FROM catalog_items i
      INNER JOIN catalog_categories c ON c.id = i.category_id
      WHERE i.active IS TRUE AND c.active IS TRUE
      ORDER BY c.sort_order ASC, i.sort_order ASC, i.codigo ASC`;
  }
  const { rows: itemRows } = await pool.query(itemSql);

  return {
    categories: catRows.map(mapCategory),
    items: itemRows.map(mapItem),
  };
}

// ─── GET /api/catalog/export — Excel (todos los roles autenticados) ─
router.get('/export', async (req, res) => {
  try {
    const includeInactive = req.query.includeInactive === 'true' && canManageCatalog(req.user);
    const data = await fetchCatalogFromDb(includeInactive);
    const buf = buildCatalogXlsx(data);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="zgroup-catalogo.xlsx"');
    return res.send(buf);
  } catch (err) {
    console.error('[CATALOG] export:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// ─── POST /api/catalog/import/preview — ADMIN ───────────────────
router.post('/import/preview', requireRole('ADMIN', 'SUPERUSER'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({
        success: false,
        error: { code: 'NO_FILE', message: 'Adjunte un archivo .xlsx' },
      });
    }
    const { rows: parsed, parseError } = parseImportBuffer(req.file.buffer);
    if (parseError) {
      return res.status(400).json({ success: false, error: { code: 'PARSE_ERROR', message: parseError } });
    }
    if (parsed.length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'EMPTY', message: 'No hay filas de datos (solo encabezados).' },
      });
    }
    const { rows, canApply } = await validateImportRows(parsed);
    return res.json({
      success: true,
      data: { rows, canApply, total: rows.length },
    });
  } catch (err) {
    console.error('[CATALOG] import preview:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// ─── POST /api/catalog/import/apply — ADMIN ─────────────────────
router.post('/import/apply', requireRole('ADMIN', 'SUPERUSER'), async (req, res) => {
  try {
    const incoming = req.body?.rows;
    if (!Array.isArray(incoming) || incoming.length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Envíe rows[] con la previsualización validada' },
      });
    }
    const reparsed = incoming.map((r) => ({
      rowIndex: r.rowIndex,
      categoria: r.categoria,
      codigo: r.codigo,
      descripcion: r.descripcion,
      unidad: r.unidad,
      tipoRaw: r.tipo,
      precioRaw: r.precio,
    }));
    const { rows, canApply } = await validateImportRows(reparsed);
    if (!canApply) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'IMPORT_INVALID',
          message: 'La validación falló. Vuelva a previsualizar el archivo.',
          data: { rows },
        },
      });
    }
    const { inserted } = await applyImportRows(rows, req.user.id);
    await invalidateCatalogCache();
    return res.json({ success: true, data: { inserted } });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({
        success: false,
        error: { code: 'DUPLICATE_CODE', message: 'Código duplicado en categoría (conflicto al insertar)' },
      });
    }
    console.error('[CATALOG] import apply:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// ─── GET /api/catalog — lectura (Redis + fallback BD) ───────────
router.get('/', async (req, res) => {
  const includeInactive = req.query.includeInactive === 'true' && canManageCatalog(req.user);
  const fresh = req.query.fresh === 'true' && canManageCatalog(req.user);

  try {
    if (fresh) {
      await invalidateCatalogCache();
    }

    const cached = fresh ? null : await getCached(includeInactive);
    if (cached) {
      return res.json({ success: true, data: cached, cached: true });
    }

    const data = await fetchCatalogFromDb(includeInactive);
    await setCached(includeInactive, data);
    return res.json({ success: true, data, cached: false });
  } catch (err) {
    console.error('[CATALOG] GET:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// ─── POST /api/catalog/refresh-cache — ADMIN / SUPERUSER ────────
router.post('/refresh-cache', requireRole('ADMIN', 'SUPERUSER'), async (req, res) => {
  try {
    await invalidateCatalogCache();
    const act = await fetchCatalogFromDb(false);
    const all = await fetchCatalogFromDb(true);
    await setCached(false, act);
    await setCached(true, all);
    return res.json({
      success: true,
      data: { message: 'Caché del catálogo actualizada desde la base de datos' },
    });
  } catch (err) {
    console.error('[CATALOG] refresh-cache:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// ─── POST /api/catalog/regularize-active — normalizar active ───
router.post('/regularize-active', requireRole('ADMIN', 'SUPERUSER'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const stats = await regularizeCatalogActiveFlags(client);
    await client.query('COMMIT');
    await invalidateCatalogCache();
    return res.json({
      success: true,
      data: {
        message: `Regularizado: ${stats.categoriesFixed} categoría(s), ${stats.itemsFixed} ítem(s) corregidos, ${stats.itemsReactivated} ítem(s) reactivados en categorías activas.`,
        ...stats,
      },
    });
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      /* noop */
    }
    console.error('[CATALOG] regularize-active:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  } finally {
    client.release();
  }
});

const reorderValidation = [
  body('orderedIds')
    .custom((arr) => {
      if (!Array.isArray(arr) || arr.length < 1) return false;
      return arr.every((id) => typeof id === 'string' && uuidValidate(id));
    })
    .withMessage('orderedIds debe ser un array de UUIDs'),
];

// ─── PATCH /api/catalog/categories/reorder — ADMIN ───────────────
router.patch('/categories/reorder', requireRole('ADMIN', 'SUPERUSER'), reorderValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: errors.array()[0].msg },
    });
  }

  const { orderedIds } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < orderedIds.length; i++) {
      await client.query(`UPDATE catalog_categories SET sort_order = $1 WHERE id = $2`, [i, orderedIds[i]]);
    }
    await client.query('COMMIT');
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      /* noop */
    }
    client.release();
    console.error('[CATALOG] reorder:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
  client.release();
  await invalidateCatalogCache();
  return res.json({ success: true, data: { message: 'Orden actualizado' } });
});

const catBody = [
  body('nombre').notEmpty().withMessage('Nombre requerido'),
  body('codigoPrefix').optional().isString(),
  body('sortOrder').optional().isInt(),
  body('active').optional().isBoolean(),
  body('defaultApplyAdjustment').optional().isBoolean(),
];

// ─── POST /api/catalog/categories — ADMIN ───────────────────────
router.post('/categories', requireRole('ADMIN', 'SUPERUSER'), catBody, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: errors.array()[0].msg },
    });
  }

  const { nombre, codigoPrefix, sortOrder, active, defaultApplyAdjustment } = req.body;
  const prefix = normalizePrefix(codigoPrefix);
  const defaultAdj = defaultApplyAdjustment !== false;

  try {
    let so = sortOrder;
    if (so === undefined || so === null) {
      const { rows } = await pool.query(`SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM catalog_categories`);
      so = rows[0].n;
    }

    const { rows } = await pool.query(
      `INSERT INTO catalog_categories (nombre, codigo_prefix, sort_order, active, default_apply_adjustment)
       VALUES ($1, $2, $3, COALESCE($4, true), $5) RETURNING *`,
      [nombre.trim(), prefix, so, active, defaultAdj]
    );
    if (prefix) {
      await syncCategoryNextSeq(rows[0].id, prefix);
      const { rows: refreshed } = await pool.query(`SELECT * FROM catalog_categories WHERE id = $1`, [rows[0].id]);
      rows[0] = refreshed[0];
    }
    await logCatalogChanges({
      entityType: 'CATEGORY',
      entityId: rows[0].id,
      entityLabel: rows[0].nombre,
      actorId: req.user.id,
      changeSource: 'DIRECT',
      changes: [{ field: 'nombre', oldValue: null, newValue: rows[0].nombre }],
    });
    await invalidateCatalogCache();
    return res.status(201).json({ success: true, data: mapCategory(rows[0]) });
  } catch (err) {
    console.error('[CATALOG] create category:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

const catPutValidators = [
  param('id').isUUID(),
  body('nombre').optional().isString(),
  body('codigoPrefix').optional().isString(),
  body('sortOrder').optional().isInt(),
  body('active').optional().isBoolean(),
  body('defaultApplyAdjustment').optional().isBoolean(),
  body('confirmPassword').optional().isString(),
];

async function runCategoryDeactivate(req, res, categoryId) {
  const password = req.body?.confirmPassword || req.body?.password;
  if (!password) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'PASSWORD_REQUIRED',
        message: 'Ingrese su contraseña para desactivar la categoría',
      },
    });
  }
  const ok = await verifyUserPassword(req.user.id, password);
  if (!ok) {
    return res.status(403).json({
      success: false,
      error: { code: 'INVALID_PASSWORD', message: 'Contraseña incorrecta' },
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: before } = await client.query(`SELECT * FROM catalog_categories WHERE id = $1`, [categoryId]);
    if (!before[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Categoría no encontrada' },
      });
    }
    if (!before[0].active) {
      await client.query('ROLLBACK');
      return res.json({
        success: true,
        data: { message: 'La categoría ya estaba inactiva', movedItems: 0 },
      });
    }

    const { moved, categoryName } = await deactivateCatalogCategory(client, categoryId);
    await client.query('COMMIT');

    await logCatalogChanges({
      entityType: 'CATEGORY',
      entityId: categoryId,
      entityLabel: categoryName,
      actorId: req.user.id,
      changeSource: 'DIRECT',
      changes: [
        { field: 'active', oldValue: 'true', newValue: 'false' },
        {
          field: 'category_id',
          oldValue: categoryName,
          newValue: `${moved} ítem(s) → OTROS`,
        },
      ],
    });
    await invalidateCatalogCache();

    return res.json({
      success: true,
      data: {
        message: `Categoría desactivada. ${moved} ítem(s) reasignados a OTROS (no se eliminaron).`,
        movedItems: moved,
      },
    });
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      /* noop */
    }
    if (err.code === 'OTROS_PROTECTED') {
      return res.status(400).json({
        success: false,
        error: { code: 'OTROS_PROTECTED', message: err.message },
      });
    }
    console.error('[CATALOG] deactivate category:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  } finally {
    client.release();
  }
}

// ─── PUT /api/catalog/categories/:id — ADMIN ───────────────────
router.put('/categories/:id', requireRole('ADMIN', 'SUPERUSER'), catPutValidators, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: errors.array()[0].msg },
    });
  }

  const { nombre, codigoPrefix, sortOrder, active, defaultApplyAdjustment, confirmPassword } = req.body;
  try {
    const { rows: before } = await pool.query(`SELECT * FROM catalog_categories WHERE id = $1`, [req.params.id]);
    if (!before[0]) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Categoría no encontrada' } });
    }

    const deactivating = active === false && before[0].active !== false;
    const reactivating = active === true && before[0].active === false;
    if (deactivating) {
      if (isOtrosCategory(before[0])) {
        return res.status(400).json({
          success: false,
          error: { code: 'OTROS_PROTECTED', message: 'La categoría OTROS no puede desactivarse' },
        });
      }
      if (!confirmPassword) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'PASSWORD_REQUIRED',
            message: 'Ingrese su contraseña para desactivar la categoría',
          },
        });
      }
      const ok = await verifyUserPassword(req.user.id, confirmPassword);
      if (!ok) {
        return res.status(403).json({
          success: false,
          error: { code: 'INVALID_PASSWORD', message: 'Contraseña incorrecta' },
        });
      }
    }

    const client = await pool.connect();
    let movedItems = 0;
    try {
      await client.query('BEGIN');

      if (deactivating) {
        const r = await deactivateCatalogCategory(client, req.params.id);
        movedItems = r.moved;
      }

      const fields = [];
      const vals = [];
      let i = 1;
      if (nombre !== undefined && String(nombre).trim() !== '') {
        fields.push(`nombre = $${i++}`);
        vals.push(String(nombre).trim());
      }
      if (codigoPrefix !== undefined) {
        fields.push(`codigo_prefix = $${i++}`);
        vals.push(normalizePrefix(codigoPrefix));
      }
      if (sortOrder !== undefined) {
        fields.push(`sort_order = $${i++}`);
        vals.push(sortOrder);
      }
      if (active !== undefined && !deactivating) {
        fields.push(`active = $${i++}`);
        vals.push(normalizeBool(active, true));
      }
      if (defaultApplyAdjustment !== undefined) {
        fields.push(`default_apply_adjustment = $${i++}`);
        vals.push(!!defaultApplyAdjustment);
      }

      let after = before[0];
      if (fields.length > 0) {
        vals.push(req.params.id);
        const { rows } = await client.query(
          `UPDATE catalog_categories SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
          vals
        );
        after = rows[0];
      } else if (deactivating) {
        const { rows } = await client.query(`SELECT * FROM catalog_categories WHERE id = $1`, [req.params.id]);
        after = rows[0];
      }

      if (fields.length === 0 && !deactivating) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Sin cambios' },
        });
      }

      if (reactivating) {
        await client.query(
          `UPDATE catalog_items SET active = true, updated_at = NOW()
           WHERE category_id = $1 AND active IS NOT TRUE`,
          [req.params.id]
        );
      }

      await client.query('COMMIT');

      const changes = categoryUpdateChanges(before[0], after);
      if (deactivating && movedItems > 0) {
        changes.push({
          field: 'category_id',
          oldValue: before[0].nombre,
          newValue: `${movedItems} ítem(s) → OTROS`,
        });
      }
      if (changes.length) {
        await logCatalogChanges({
          entityType: 'CATEGORY',
          entityId: after.id,
          entityLabel: after.nombre,
          actorId: req.user.id,
          changeSource: 'DIRECT',
          changes,
        });
      }
      if (codigoPrefix !== undefined && after.codigo_prefix) {
        await syncCategoryNextSeq(after.id, after.codigo_prefix);
        const { rows: refreshed } = await pool.query(`SELECT * FROM catalog_categories WHERE id = $1`, [after.id]);
        after = refreshed[0];
      }
      await invalidateCatalogCache();
      return res.json({
        success: true,
        data: {
          ...mapCategory(after),
          movedItems: deactivating ? movedItems : undefined,
          deactivateMessage: deactivating
            ? `${movedItems} ítem(s) reasignados a OTROS (no eliminados).`
            : undefined,
        },
      });
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (_) {
        /* noop */
      }
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    if (err.code === 'OTROS_PROTECTED') {
      return res.status(400).json({
        success: false,
        error: { code: 'OTROS_PROTECTED', message: err.message },
      });
    }
    console.error('[CATALOG] update category:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// ─── POST /api/catalog/categories/:id/deactivate — ADMIN ─────────
router.post(
  '/categories/:id/deactivate',
  requireRole('ADMIN', 'SUPERUSER'),
  [param('id').isUUID(), body('confirmPassword').notEmpty().withMessage('Contraseña requerida')],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: errors.array()[0].msg },
      });
    }
    return runCategoryDeactivate(req, res, req.params.id);
  }
);

// ─── DELETE /api/catalog/categories/:id — desactivar (legacy) ───
router.delete('/categories/:id', requireRole('ADMIN', 'SUPERUSER'), [param('id').isUUID()], async (req, res) => {
  return res.status(400).json({
    success: false,
    error: {
      code: 'USE_DEACTIVATE_ENDPOINT',
      message: 'Use POST /api/catalog/categories/:id/deactivate con confirmPassword',
    },
  });
});

const itemBody = [
  body('categoryId').isUUID().withMessage('Categoría requerida'),
  body('codigo').notEmpty().withMessage('Código requerido'),
  body('descripcion').notEmpty().withMessage('Descripción requerida'),
  body('unidad').optional().isString(),
  body('tipo').isIn(['ACTIVO', 'CONSUMIBLE']).withMessage('Tipo inválido'),
  body('unitPrice').isFloat({ min: 0 }).withMessage('Precio inválido'),
  body('sortOrder').optional().isInt(),
  body('active').optional().isBoolean(),
];

// ─── POST /api/catalog/items — ADMIN ───────────────────────────
router.post('/items', requireRole('ADMIN', 'SUPERUSER'), itemBody, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: errors.array()[0].msg },
    });
  }

  const { categoryId, codigo, descripcion, unidad, tipo, unitPrice, sortOrder, active } = req.body;

  try {
    const { rows: catRows } = await pool.query(`SELECT * FROM catalog_categories WHERE id = $1`, [categoryId]);
    if (!catRows.length) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_CATEGORY', message: 'Categoría no existe' },
      });
    }
    const cat = catRows[0];
    if (cat.codigo_prefix) {
      const v = await validateCategoryCodigo({
        codigo: codigo.trim(),
        prefix: cat.codigo_prefix,
        categoryId,
        isNew: true,
      });
      if (!v.ok) {
        return res.status(400).json({ success: false, error: { code: v.code, message: v.message } });
      }
    }

    let so = sortOrder;
    if (so === undefined || so === null) {
      const { rows } = await pool.query(
        `SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM catalog_items WHERE category_id = $1`,
        [categoryId]
      );
      so = rows[0].n;
    }

    const descCheck = await assertUniqueDescription(descripcion);
    if (!descCheck.ok) {
      return res.status(409).json({ success: false, error: { code: descCheck.code, message: descCheck.message } });
    }

    const { rows } = await pool.query(
      `INSERT INTO catalog_items
        (category_id, codigo, descripcion, unidad, tipo, unit_price, sort_order, active, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, true), $9)
       RETURNING *`,
      [
        categoryId,
        codigo.trim(),
        descripcion.trim(),
        unidad || 'UND',
        tipo,
        unitPrice,
        so,
        active,
        req.user.id,
      ]
    );
    await logItemCreate(rows[0], req.user.id, 'DIRECT', null);
    if (Array.isArray(req.body.dependencies)) {
      try {
        await setItemDependencies(rows[0].id, req.body.dependencies);
      } catch (depErr) {
        await pool.query(`UPDATE catalog_items SET active = false WHERE id = $1`, [rows[0].id]);
        return res.status(400).json({
          success: false,
          error: { code: depErr.code || 'INVALID_DEPS', message: depErr.message },
        });
      }
    }
    if (cat.codigo_prefix) {
      await afterItemCodigoSaved(categoryId, cat.codigo_prefix, rows[0].codigo);
    }
    await invalidateCatalogCache();
    return res.status(201).json({ success: true, data: mapItem(rows[0]) });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({
        success: false,
        error: { code: 'DUPLICATE_CODE', message: 'Ya existe un ítem con ese código en esta categoría' },
      });
    }
    console.error('[CATALOG] create item:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// ─── PUT /api/catalog/items/:id — ADMIN ────────────────────────
router.put('/items/:id', requireRole('ADMIN', 'SUPERUSER'), [param('id').isUUID()], async (req, res) => {
  const verr = validationResult(req);
  if (!verr.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: verr.array()[0].msg },
    });
  }

  const {
    categoryId,
    codigo,
    descripcion,
    unidad,
    tipo,
    unitPrice,
    sortOrder,
    active,
  } = req.body;

  if (tipo !== undefined && !['ACTIVO', 'CONSUMIBLE'].includes(tipo)) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Tipo inválido' },
    });
  }

  try {
    const { rows: cur } = await pool.query(`SELECT * FROM catalog_items WHERE id = $1`, [req.params.id]);
    if (!cur[0]) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Ítem no encontrado' } });
    }

    const fields = [];
    const vals = [];
    let i = 1;

    if (categoryId !== undefined) {
      fields.push(`category_id = $${i++}`);
      vals.push(categoryId);
    }
    if (codigo !== undefined) {
      fields.push(`codigo = $${i++}`);
      vals.push(codigo.trim());
    }
    if (descripcion !== undefined) {
      fields.push(`descripcion = $${i++}`);
      vals.push(descripcion.trim());
    }
    if (unidad !== undefined) {
      fields.push(`unidad = $${i++}`);
      vals.push(unidad);
    }
    if (tipo !== undefined) {
      fields.push(`tipo = $${i++}`);
      vals.push(tipo);
    }
    if (unitPrice !== undefined) {
      fields.push(`unit_price = $${i++}`);
      vals.push(unitPrice);
    }
    if (sortOrder !== undefined) {
      fields.push(`sort_order = $${i++}`);
      vals.push(sortOrder);
    }
    if (active !== undefined) {
      fields.push(`active = $${i++}`);
      vals.push(active);
    }

    if (fields.length === 0 && req.body.dependencies === undefined) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Sin cambios' },
      });
    }

    let updatedRow = cur[0];
    if (fields.length > 0) {
      const targetCatId = categoryId !== undefined ? categoryId : cur[0].category_id;
      const targetCodigo = codigo !== undefined ? codigo.trim() : cur[0].codigo;
      const targetDesc = descripcion !== undefined ? descripcion.trim() : cur[0].descripcion;
      if (descripcion !== undefined) {
        const descCheck = await assertUniqueDescription(targetDesc, req.params.id);
        if (!descCheck.ok) {
          return res.status(409).json({ success: false, error: { code: descCheck.code, message: descCheck.message } });
        }
      }
      const { rows: catRows } = await pool.query(`SELECT * FROM catalog_categories WHERE id = $1`, [targetCatId]);
      const cat = catRows[0];
      if (cat?.codigo_prefix && (codigo !== undefined || categoryId !== undefined)) {
        const v = await validateCategoryCodigo({
          codigo: targetCodigo,
          prefix: cat.codigo_prefix,
          categoryId: targetCatId,
          excludeItemId: req.params.id,
          previousCodigo: cur[0].codigo,
          isNew: false,
        });
        if (!v.ok) {
          return res.status(400).json({ success: false, error: { code: v.code, message: v.message } });
        }
      }

      vals.push(req.params.id);
      const { rows } = await pool.query(
        `UPDATE catalog_items SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
        vals
      );
      updatedRow = rows[0];
      const changes = itemUpdateChanges(cur[0], rows[0]);
      if (changes.length) {
        await logCatalogChanges({
          entityType: 'ITEM',
          entityId: rows[0].id,
          entityLabel: rows[0].codigo,
          actorId: req.user.id,
          changeSource: 'DIRECT',
          changes,
        });
      }
      const { rows: catAfter } = await pool.query(`SELECT * FROM catalog_categories WHERE id = $1`, [
        rows[0].category_id,
      ]);
      if (catAfter[0]?.codigo_prefix) {
        await afterItemCodigoSaved(rows[0].category_id, catAfter[0].codigo_prefix, rows[0].codigo);
      }
    }

    if (req.body.dependencies !== undefined) {
      try {
        await setItemDependencies(req.params.id, req.body.dependencies);
      } catch (depErr) {
        return res.status(400).json({
          success: false,
          error: { code: depErr.code || 'INVALID_DEPS', message: depErr.message },
        });
      }
    }

    await invalidateCatalogCache();
    return res.json({ success: true, data: mapItem(updatedRow) });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({
        success: false,
        error: { code: 'DUPLICATE_CODE', message: 'Ya existe un ítem con ese código en esta categoría' },
      });
    }
    console.error('[CATALOG] update item:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// ─── GET /api/catalog/items/:id/dependencies ───────────────────
router.get('/items/:id/dependencies', requireRole('ADMIN', 'SUPERUSER'), [param('id').isUUID()], async (req, res) => {
  try {
    const { rows: item } = await pool.query(`SELECT id FROM catalog_items WHERE id = $1`, [req.params.id]);
    if (!item[0]) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Ítem no encontrado' } });
    }
    const deps = await fetchDirectDependencies(req.params.id);
    return res.json({ success: true, data: { dependencies: deps } });
  } catch (err) {
    console.error('[CATALOG] item dependencies get:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// ─── GET /api/catalog/items/:id/dependency-bundle — presupuesto
router.get('/items/:id/dependency-bundle', requireAuth, [param('id').isUUID()], async (req, res) => {
  try {
    const qty = req.query.qty != null ? Number(req.query.qty) : 1;
    const bundle = await resolveDependencyBundle(req.params.id, qty);
    if (!bundle) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Ítem no encontrado' } });
    }
    return res.json({ success: true, data: bundle });
  } catch (err) {
    console.error('[CATALOG] dependency bundle:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// ─── PUT /api/catalog/items/:id/dependencies ───────────────────
router.put(
  '/items/:id/dependencies',
  requireRole('ADMIN', 'SUPERUSER'),
  [
    param('id').isUUID(),
    body('dependencies').isArray(),
    body('dependencies.*.childItemId').isUUID(),
    body('dependencies.*.qty').isFloat({ min: 0.001 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: errors.array()[0].msg },
      });
    }
    try {
      const { rows: item } = await pool.query(`SELECT id FROM catalog_items WHERE id = $1`, [req.params.id]);
      if (!item[0]) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Ítem no encontrado' } });
      }
      const count = await setItemDependencies(req.params.id, req.body.dependencies);
      await invalidateCatalogCache();
      const deps = await fetchDirectDependencies(req.params.id);
      return res.json({ success: true, data: { count, dependencies: deps } });
    } catch (err) {
      if (err.code) {
        return res.status(400).json({ success: false, error: { code: err.code, message: err.message } });
      }
      console.error('[CATALOG] item dependencies put:', err);
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
    }
  }
);

// ─── DELETE /api/catalog/items/:id — desactivar — ADMIN ────────
router.delete('/items/:id', requireRole('ADMIN', 'SUPERUSER'), [param('id').isUUID()], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: errors.array()[0].msg },
    });
  }

  try {
    const { rows: before } = await pool.query(`SELECT * FROM catalog_items WHERE id = $1`, [req.params.id]);
    if (!before[0]) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Ítem no encontrado' } });
    }
    await pool.query(`UPDATE catalog_items SET active = false WHERE id = $1`, [req.params.id]);
    if (before[0].active) {
      await logCatalogChanges({
        entityType: 'ITEM',
        entityId: req.params.id,
        entityLabel: before[0].codigo,
        actorId: req.user.id,
        changeSource: 'DIRECT',
        changes: [{ field: 'active', oldValue: 'true', newValue: 'false' }],
      });
    }
    await invalidateCatalogCache();
    return res.json({ success: true, data: { message: 'Ítem desactivado' } });
  } catch (err) {
    console.error('[CATALOG] delete item:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// ─── GET /api/catalog/categories/:id/next-codigo — sugerencia ───
router.get('/categories/:id/next-codigo', requireRole('ADMIN', 'SUPERUSER', 'COMERCIAL'), [param('id').isUUID()], async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM catalog_categories WHERE id = $1`, [req.params.id]);
    if (!rows[0]) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Categoría no encontrada' } });
    }
    const suggestion = await suggestNextCodigo(rows[0]);
    return res.json({ success: true, data: suggestion });
  } catch (err) {
    console.error('[CATALOG] next-codigo:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// ─── POST /api/catalog/categories/:id/regularize-codigos ────────
router.post(
  '/categories/:id/regularize-codigos',
  requireRole('ADMIN', 'SUPERUSER'),
  [param('id').isUUID()],
  async (req, res) => {
    try {
      const { rows } = await pool.query(`SELECT * FROM catalog_categories WHERE id = $1`, [req.params.id]);
      if (!rows[0]) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Categoría no encontrada' } });
      }
      if (!rows[0].codigo_prefix) {
        return res.status(400).json({
          success: false,
          error: { code: 'NO_PREFIX', message: 'La categoría no tiene prefijo configurado' },
        });
      }
      const next = await syncCategoryNextSeq(rows[0].id, rows[0].codigo_prefix);
      const suggestion = await suggestNextCodigo(rows[0]);
      return res.json({
        success: true,
        data: { nextSeq: next, suggestedCodigo: suggestion.suggestedCodigo, maxSeq: suggestion.maxSeq },
      });
    } catch (err) {
      console.error('[CATALOG] regularize:', err);
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
    }
  }
);

// ─── Prefijos — regularización masiva (SUPERUSER) ───────────────
router.get('/prefix-regularization/preview', requireRole('SUPERUSER'), async (req, res) => {
  try {
    const data = await previewPrefixRegularization();
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[CATALOG] prefix preview:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

router.post(
  '/prefix-regularization/apply',
  requireRole('SUPERUSER'),
  [
    body('confirm').custom((v) => v === true || v === 'true').withMessage('Debe confirmar la operación'),
    body('fixInvalidCodigos').optional().isBoolean(),
    body('categoryIds').optional().isArray(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: errors.array()[0].msg },
      });
    }
    try {
      const result = await applyPrefixRegularization(
        {
          fixInvalidCodigos: req.body.fixInvalidCodigos !== false,
          categoryIds: req.body.categoryIds,
        },
        req.user.id
      );
      await invalidateCatalogCache();
      return res.json({ success: true, data: result });
    } catch (err) {
      console.error('[CATALOG] prefix apply:', err);
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
    }
  }
);

// ─── GET /api/catalog/categories/:id/history — ADMIN ────────────
router.get('/categories/:id/history', requireRole('ADMIN', 'SUPERUSER'), [param('id').isUUID()], async (req, res) => {
  try {
    const data = await fetchCatalogHistory('CATEGORY', req.params.id);
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[CATALOG] category history:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// ─── GET /api/catalog/items/:id/history — ADMIN ─────────────────
router.get('/items/:id/history', requireRole('ADMIN', 'SUPERUSER'), [param('id').isUUID()], async (req, res) => {
  try {
    const data = await fetchCatalogHistory('ITEM', req.params.id);
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[CATALOG] item history:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

module.exports = router;
