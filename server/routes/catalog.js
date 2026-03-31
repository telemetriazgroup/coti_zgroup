const express = require('express');
const multer = require('multer');
const { body, param, validationResult } = require('express-validator');
const { validate: uuidValidate } = require('uuid');
const { pool } = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { getCached, setCached, invalidateCatalogCache } = require('../lib/catalogRedis');
const { buildCatalogXlsx, parseImportBuffer, validateImportRows, applyImportRows } = require('../lib/catalogExcel');

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
    sortOrder: row.sort_order,
    active: row.active,
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
    active: row.active,
    sortOrder: row.sort_order,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function fetchCatalogFromDb(includeInactive) {
  const { rows: catRows } = await pool.query(
    includeInactive
      ? `SELECT * FROM catalog_categories ORDER BY sort_order ASC, nombre ASC`
      : `SELECT * FROM catalog_categories WHERE active = true ORDER BY sort_order ASC, nombre ASC`
  );

  let itemSql;
  if (includeInactive) {
    itemSql = `
      SELECT i.*, c.nombre AS category_nombre FROM catalog_items i
      JOIN catalog_categories c ON c.id = i.category_id
      ORDER BY c.sort_order ASC, i.sort_order ASC, i.codigo ASC`;
  } else {
    itemSql = `
      SELECT i.*, c.nombre AS category_nombre FROM catalog_items i
      INNER JOIN catalog_categories c ON c.id = i.category_id
      WHERE i.active = true AND c.active = true
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
    const includeInactive = req.query.includeInactive === 'true' && req.user.role === 'ADMIN';
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
router.post('/import/preview', requireRole('ADMIN'), upload.single('file'), async (req, res) => {
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
router.post('/import/apply', requireRole('ADMIN'), async (req, res) => {
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
  const includeInactive = req.query.includeInactive === 'true' && req.user.role === 'ADMIN';

  try {
    const cached = await getCached(includeInactive);
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

const reorderValidation = [
  body('orderedIds')
    .custom((arr) => {
      if (!Array.isArray(arr) || arr.length < 1) return false;
      return arr.every((id) => typeof id === 'string' && uuidValidate(id));
    })
    .withMessage('orderedIds debe ser un array de UUIDs'),
];

// ─── PATCH /api/catalog/categories/reorder — ADMIN ───────────────
router.patch('/categories/reorder', requireRole('ADMIN'), reorderValidation, async (req, res) => {
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
  body('sortOrder').optional().isInt(),
  body('active').optional().isBoolean(),
];

// ─── POST /api/catalog/categories — ADMIN ───────────────────────
router.post('/categories', requireRole('ADMIN'), catBody, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: errors.array()[0].msg },
    });
  }

  const { nombre, sortOrder, active } = req.body;

  try {
    let so = sortOrder;
    if (so === undefined || so === null) {
      const { rows } = await pool.query(`SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM catalog_categories`);
      so = rows[0].n;
    }

    const { rows } = await pool.query(
      `INSERT INTO catalog_categories (nombre, sort_order, active) VALUES ($1, $2, COALESCE($3, true)) RETURNING *`,
      [nombre.trim(), so, active]
    );
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
  body('sortOrder').optional().isInt(),
  body('active').optional().isBoolean(),
];

// ─── PUT /api/catalog/categories/:id — ADMIN ───────────────────
router.put('/categories/:id', requireRole('ADMIN'), catPutValidators, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: errors.array()[0].msg },
    });
  }

  const { nombre, sortOrder, active } = req.body;
  try {
    const fields = [];
    const vals = [];
    let i = 1;
    if (nombre !== undefined && String(nombre).trim() !== '') {
      fields.push(`nombre = $${i++}`);
      vals.push(String(nombre).trim());
    }
    if (sortOrder !== undefined) {
      fields.push(`sort_order = $${i++}`);
      vals.push(sortOrder);
    }
    if (active !== undefined) {
      fields.push(`active = $${i++}`);
      vals.push(active);
    }
    if (fields.length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Sin cambios' },
      });
    }
    vals.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE catalog_categories SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
      vals
    );
    if (!rows[0]) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Categoría no encontrada' } });
    }
    await invalidateCatalogCache();
    return res.json({ success: true, data: mapCategory(rows[0]) });
  } catch (err) {
    console.error('[CATALOG] update category:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// ─── DELETE /api/catalog/categories/:id — desactivar — ADMIN ───
router.delete('/categories/:id', requireRole('ADMIN'), [param('id').isUUID()], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: errors.array()[0].msg },
    });
  }

  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE catalog_categories SET active = false WHERE id = $1`, [req.params.id]);
      await client.query(`UPDATE catalog_items SET active = false WHERE category_id = $1`, [req.params.id]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    await invalidateCatalogCache();
    return res.json({ success: true, data: { message: 'Categoría desactivada' } });
  } catch (err) {
    console.error('[CATALOG] delete category:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
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
router.post('/items', requireRole('ADMIN'), itemBody, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: errors.array()[0].msg },
    });
  }

  const { categoryId, codigo, descripcion, unidad, tipo, unitPrice, sortOrder, active } = req.body;

  try {
    const { rows: cat } = await pool.query(`SELECT id FROM catalog_categories WHERE id = $1`, [categoryId]);
    if (!cat.length) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_CATEGORY', message: 'Categoría no existe' },
      });
    }

    let so = sortOrder;
    if (so === undefined || so === null) {
      const { rows } = await pool.query(
        `SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM catalog_items WHERE category_id = $1`,
        [categoryId]
      );
      so = rows[0].n;
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
router.put('/items/:id', requireRole('ADMIN'), [param('id').isUUID()], async (req, res) => {
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

    if (fields.length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Sin cambios' },
      });
    }

    vals.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE catalog_items SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
      vals
    );
    await invalidateCatalogCache();
    return res.json({ success: true, data: mapItem(rows[0]) });
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

// ─── DELETE /api/catalog/items/:id — desactivar — ADMIN ────────
router.delete('/items/:id', requireRole('ADMIN'), [param('id').isUUID()], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: errors.array()[0].msg },
    });
  }

  try {
    await pool.query(`UPDATE catalog_items SET active = false WHERE id = $1`, [req.params.id]);
    await invalidateCatalogCache();
    return res.json({ success: true, data: { message: 'Ítem desactivado' } });
  } catch (err) {
    console.error('[CATALOG] delete item:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

module.exports = router;
