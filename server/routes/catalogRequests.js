const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { pool } = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { isManagedCommercial } = require('../lib/adminTeam');
const { invalidateCatalogCache } = require('../lib/catalogRedis');
const { logItemCreate, itemUpdateChanges, logCatalogChanges } = require('../lib/catalogChangeLog');
const { validateCategoryCodigo, afterItemCodigoSaved } = require('../lib/catalogCodigo');
const { assertUniqueDescription } = require('../lib/catalogItemUniqueness');

const router = express.Router();
router.use(requireAuth);

function mapRequest(row) {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    requestedBy: row.requested_by,
    requestedByEmail: row.requested_by_email || null,
    requestedByName: row.requested_by_name || null,
    reviewedBy: row.reviewed_by,
    reviewedByEmail: row.reviewed_by_email || null,
    catalogItemId: row.catalog_item_id,
    categoryId: row.category_id,
    categoryNombre: row.category_nombre || null,
    codigo: row.codigo,
    descripcion: row.descripcion,
    unidad: row.unidad,
    tipo: row.tipo,
    unitPrice: row.unit_price != null ? Number(row.unit_price) : 0,
    prevDescripcion: row.prev_descripcion || null,
    prevUnitPrice: row.prev_unit_price != null ? Number(row.prev_unit_price) : null,
    requestNotes: row.request_notes || null,
    reviewNotes: row.review_notes || null,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
  };
}

async function canReviewRequest(user, requestRow) {
  if (user.role === 'SUPERUSER') return true;
  if (user.role === 'ADMIN') {
    return isManagedCommercial(user.id, requestRow.requested_by);
  }
  return false;
}

async function fetchRequestById(id) {
  const { rows } = await pool.query(
    `SELECT r.*,
            c.nombre AS category_nombre,
            ru.email AS requested_by_email,
            TRIM(CONCAT(re.nombres, ' ', re.apellidos)) AS requested_by_name,
            rv.email AS reviewed_by_email
     FROM catalog_item_requests r
     JOIN catalog_categories c ON c.id = r.category_id
     JOIN users ru ON ru.id = r.requested_by
     LEFT JOIN employees re ON re.user_id = r.requested_by
     LEFT JOIN users rv ON rv.id = r.reviewed_by
     WHERE r.id = $1`,
    [id]
  );
  return rows[0] || null;
}

// ─── GET /api/catalog/requests/pending-count ────────────────────
router.get('/pending-count', requireRole('ADMIN', 'SEMIADMIN', 'SUPERUSER'), async (req, res) => {
  try {
    let sql = `SELECT COUNT(*)::int AS n FROM catalog_item_requests r WHERE r.status = 'PENDING'`;
    const params = [];
    if (req.user.role === 'ADMIN') {
      params.push(req.user.id);
      sql += ` AND EXISTS (
        SELECT 1 FROM users u WHERE u.id = r.requested_by AND (
          u.created_by = $1::uuid OR EXISTS (
            SELECT 1 FROM admin_commercial_assignments a
            WHERE a.admin_id = $1::uuid AND a.commercial_id = u.id
          )
        )
      )`;
    }
    const { rows } = await pool.query(sql, params);
    return res.json({ success: true, data: { count: rows[0].n } });
  } catch (err) {
    console.error('[CATALOG_REQUESTS] pending-count:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// ─── GET /api/catalog/requests ──────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const statusFilter = (req.query.status || '').toUpperCase();
    let sql = `
      SELECT r.*,
             c.nombre AS category_nombre,
             ru.email AS requested_by_email,
             TRIM(CONCAT(re.nombres, ' ', re.apellidos)) AS requested_by_name,
             rv.email AS reviewed_by_email
      FROM catalog_item_requests r
      JOIN catalog_categories c ON c.id = r.category_id
      JOIN users ru ON ru.id = r.requested_by
      LEFT JOIN employees re ON re.user_id = r.requested_by
      LEFT JOIN users rv ON rv.id = r.reviewed_by
      WHERE 1=1`;
    const params = [];
    let idx = 1;

    if (req.user.role === 'COMERCIAL') {
      sql += ` AND r.requested_by = $${idx++}`;
      params.push(req.user.id);
    } else if (req.user.role === 'ADMIN') {
      sql += ` AND EXISTS (
        SELECT 1 FROM users u WHERE u.id = r.requested_by AND (
          u.created_by = $${idx}::uuid OR EXISTS (
            SELECT 1 FROM admin_commercial_assignments a
            WHERE a.admin_id = $${idx}::uuid AND a.commercial_id = u.id
          )
        )
      )`;
      params.push(req.user.id);
      idx++;
    } else if (req.user.role !== 'SUPERUSER') {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Acceso denegado' } });
    }

    if (statusFilter && ['PENDING', 'APPROVED', 'REJECTED'].includes(statusFilter)) {
      sql += ` AND r.status = $${idx++}`;
      params.push(statusFilter);
    }

    sql += ` ORDER BY r.created_at DESC LIMIT 200`;
    const { rows } = await pool.query(sql, params);
    return res.json({ success: true, data: rows.map(mapRequest) });
  } catch (err) {
    console.error('[CATALOG_REQUESTS] list:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

const createBody = [
  body('kind').isIn(['CREATE', 'UPDATE']).withMessage('Tipo inválido'),
  body('categoryId').optional().isUUID(),
  body('catalogItemId').optional().isUUID(),
  body('codigo').optional().isString(),
  body('descripcion').optional().isString(),
  body('unidad').optional().isString(),
  body('tipo').optional().isIn(['ACTIVO', 'CONSUMIBLE']),
  body('unitPrice').optional().isFloat({ min: 0 }),
  body('requestNotes').optional().isString(),
];

// ─── POST /api/catalog/requests — COMERCIAL solicita ────────────
router.post('/', requireRole('COMERCIAL'), createBody, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: errors.array()[0].msg },
    });
  }

  const { kind, categoryId, catalogItemId, codigo, descripcion, unidad, tipo, unitPrice, requestNotes } = req.body;

  try {
    if (kind === 'CREATE') {
      if (!categoryId || !codigo?.trim() || !descripcion?.trim()) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Categoría, código y descripción son obligatorios' },
        });
      }
      const { rows: cat } = await pool.query(
        `SELECT * FROM catalog_categories WHERE id = $1 AND active = true`,
        [categoryId]
      );
      if (!cat.length) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_CATEGORY', message: 'Categoría no encontrada' },
        });
      }
      if (cat[0].codigo_prefix) {
        const val = await validateCategoryCodigo({
          codigo: codigo.trim(),
          prefix: cat[0].codigo_prefix,
          categoryId,
          isNew: true,
        });
        if (!val.ok) {
          return res.status(400).json({
            success: false,
            error: { code: val.code, message: val.message },
          });
        }
      }
      const { rows: dup } = await pool.query(
        `SELECT id FROM catalog_items WHERE category_id = $1 AND LOWER(codigo) = LOWER($2) AND active = true`,
        [categoryId, codigo.trim()]
      );
      if (dup.length) {
        return res.status(409).json({
          success: false,
          error: { code: 'DUPLICATE_CODIGO', message: 'Ya existe un ítem con ese código en la categoría' },
        });
      }
      const descCheck = await assertUniqueDescription(descripcion);
      if (!descCheck.ok) {
        return res.status(409).json({
          success: false,
          error: { code: descCheck.code, message: descCheck.message },
        });
      }
      const { rows: pending } = await pool.query(
        `SELECT id FROM catalog_item_requests
         WHERE status = 'PENDING' AND kind = 'CREATE' AND category_id = $1 AND LOWER(codigo) = LOWER($2)`,
        [categoryId, codigo.trim()]
      );
      if (pending.length) {
        return res.status(409).json({
          success: false,
          error: { code: 'PENDING_EXISTS', message: 'Ya hay una solicitud pendiente para ese código' },
        });
      }

      const price = unitPrice != null ? Number(unitPrice) : 0;
      const { rows } = await pool.query(
        `INSERT INTO catalog_item_requests (
          kind, requested_by, category_id, codigo, descripcion, unidad, tipo, unit_price, request_notes
        ) VALUES ('CREATE', $1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [
          req.user.id,
          categoryId,
          codigo.trim(),
          descripcion.trim(),
          (unidad || 'UND').trim(),
          tipo || 'ACTIVO',
          price,
          requestNotes?.trim() || null,
        ]
      );
      const full = await fetchRequestById(rows[0].id);
      return res.status(201).json({ success: true, data: mapRequest(full) });
    }

    // UPDATE
    if (!catalogItemId) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'catalogItemId requerido para actualización' },
      });
    }
    const { rows: itemRows } = await pool.query(
      `SELECT i.*, c.nombre AS category_nombre FROM catalog_items i
       JOIN catalog_categories c ON c.id = i.category_id
       WHERE i.id = $1 AND i.active = true AND c.active = true`,
      [catalogItemId]
    );
    const item = itemRows[0];
    if (!item) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Ítem de catálogo no encontrado' },
      });
    }

    const nextDesc = descripcion?.trim() || item.descripcion;
    const nextPrice = unitPrice != null ? Number(unitPrice) : Number(item.unit_price);
    const descChanged = nextDesc !== item.descripcion;
    const priceChanged = Math.abs(nextPrice - Number(item.unit_price)) > 0.005;

    if (!descChanged && !priceChanged) {
      return res.status(400).json({
        success: false,
        error: { code: 'NO_CHANGES', message: 'Indique un nombre o precio distinto al actual' },
      });
    }

    if (descChanged) {
      const descCheck = await assertUniqueDescription(nextDesc, catalogItemId);
      if (!descCheck.ok) {
        return res.status(409).json({
          success: false,
          error: { code: descCheck.code, message: descCheck.message },
        });
      }
    }

    const { rows: pendingUpd } = await pool.query(
      `SELECT id FROM catalog_item_requests
       WHERE status = 'PENDING' AND kind = 'UPDATE' AND catalog_item_id = $1`,
      [catalogItemId]
    );
    if (pendingUpd.length) {
      return res.status(409).json({
        success: false,
        error: { code: 'PENDING_EXISTS', message: 'Ya hay una solicitud pendiente para este ítem' },
      });
    }

    const { rows } = await pool.query(
      `INSERT INTO catalog_item_requests (
        kind, requested_by, catalog_item_id, category_id, codigo, descripcion, unidad, tipo, unit_price,
        prev_descripcion, prev_unit_price, request_notes
      ) VALUES ('UPDATE', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
      [
        req.user.id,
        catalogItemId,
        item.category_id,
        item.codigo,
        nextDesc,
        item.unidad,
        item.tipo,
        nextPrice,
        item.descripcion,
        item.unit_price,
        requestNotes?.trim() || null,
      ]
    );
    const full = await fetchRequestById(rows[0].id);
    return res.status(201).json({ success: true, data: mapRequest(full) });
  } catch (err) {
    console.error('[CATALOG_REQUESTS] create:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// ─── GET /api/catalog/requests/:id ──────────────────────────────
router.get('/:id', param('id').isUUID(), async (req, res) => {
  try {
    const row = await fetchRequestById(req.params.id);
    if (!row) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Solicitud no encontrada' } });
    }
    if (req.user.role === 'COMERCIAL' && row.requested_by !== req.user.id) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Acceso denegado' } });
    }
    if (req.user.role === 'ADMIN' && !(await canReviewRequest(req.user, row))) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Acceso denegado' } });
    }
    return res.json({ success: true, data: mapRequest(row) });
  } catch (err) {
    console.error('[CATALOG_REQUESTS] get:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

const approveBody = [
  body('categoryId').optional().isUUID(),
  body('codigo').optional().isString(),
  body('descripcion').optional().isString(),
  body('unidad').optional().isString(),
  body('tipo').optional().isIn(['ACTIVO', 'CONSUMIBLE']),
  body('unitPrice').optional().isFloat({ min: 0 }),
  body('reviewNotes').optional().isString(),
];

// ─── PUT /api/catalog/requests/:id/approve ──────────────────────
router.put(
  '/:id/approve',
  requireRole('ADMIN', 'SEMIADMIN', 'SUPERUSER'),
  [param('id').isUUID(), ...approveBody],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: errors.array()[0].msg },
      });
    }

    try {
      const row = await fetchRequestById(req.params.id);
      if (!row) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Solicitud no encontrada' } });
      }
      if (row.status !== 'PENDING') {
        return res.status(400).json({
          success: false,
          error: { code: 'NOT_PENDING', message: 'La solicitud ya fue revisada' },
        });
      }
      if (!(await canReviewRequest(req.user, row))) {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Acceso denegado' } });
      }

      const categoryId = req.body.categoryId || row.category_id;
      const codigo = (req.body.codigo || row.codigo).trim();
      const descripcion = (req.body.descripcion || row.descripcion).trim();
      const unidad = (req.body.unidad || row.unidad).trim();
      const tipo = req.body.tipo || row.tipo;
      const unitPrice = req.body.unitPrice != null ? Number(req.body.unitPrice) : Number(row.unit_price);
      const reviewNotes = req.body.reviewNotes?.trim() || null;

      if (!codigo || !descripcion) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Código y descripción son obligatorios' },
        });
      }

      const client = await pool.connect();
      let catalogItemId = row.catalog_item_id;
      try {
        await client.query('BEGIN');

        if (row.kind === 'CREATE') {
          const { rows: catRows } = await client.query(`SELECT * FROM catalog_categories WHERE id = $1`, [categoryId]);
          if (catRows[0]?.codigo_prefix) {
            const val = await validateCategoryCodigo(
              {
                codigo,
                prefix: catRows[0].codigo_prefix,
                categoryId,
                isNew: true,
              },
              client
            );
            if (!val.ok) {
              await client.query('ROLLBACK');
              return res.status(400).json({
                success: false,
                error: { code: val.code, message: val.message },
              });
            }
          }
          const { rows: dup } = await client.query(
            `SELECT id FROM catalog_items WHERE category_id = $1 AND LOWER(codigo) = LOWER($2) AND active = true`,
            [categoryId, codigo]
          );
          if (dup.length) {
            await client.query('ROLLBACK');
            return res.status(409).json({
              success: false,
              error: { code: 'DUPLICATE_CODIGO', message: 'Ya existe un ítem con ese código' },
            });
          }
          const descCheck = await assertUniqueDescription(descripcion, null, client);
          if (!descCheck.ok) {
            await client.query('ROLLBACK');
            return res.status(409).json({
              success: false,
              error: { code: descCheck.code, message: descCheck.message },
            });
          }
          const { rows: ins } = await client.query(
            `INSERT INTO catalog_items (category_id, codigo, descripcion, unidad, tipo, unit_price, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [categoryId, codigo, descripcion, unidad, tipo, unitPrice, req.user.id]
          );
          catalogItemId = ins[0].id;
          await logItemCreate(ins[0], req.user.id, 'REQUEST_APPROVED', row.id, client);
          if (catRows[0]?.codigo_prefix) {
            await afterItemCodigoSaved(categoryId, catRows[0].codigo_prefix, codigo, client);
          }
        } else {
          const descCheck = await assertUniqueDescription(descripcion, row.catalog_item_id, client);
          if (!descCheck.ok) {
            await client.query('ROLLBACK');
            return res.status(409).json({
              success: false,
              error: { code: descCheck.code, message: descCheck.message },
            });
          }
          const { rows: itemBefore } = await client.query(`SELECT * FROM catalog_items WHERE id = $1`, [
            row.catalog_item_id,
          ]);
          await client.query(
            `UPDATE catalog_items SET
               descripcion = $1,
               unit_price = $2,
               category_id = $3,
               updated_at = NOW()
             WHERE id = $4`,
            [descripcion, unitPrice, categoryId, row.catalog_item_id]
          );
          const { rows: itemAfter } = await client.query(`SELECT * FROM catalog_items WHERE id = $1`, [
            row.catalog_item_id,
          ]);
          const changes = itemUpdateChanges(itemBefore[0], itemAfter[0]);
          if (changes.length) {
            await logCatalogChanges(
              {
                entityType: 'ITEM',
                entityId: itemAfter[0].id,
                entityLabel: itemAfter[0].codigo,
                actorId: req.user.id,
                changeSource: 'REQUEST_APPROVED',
                requestId: row.id,
                changes,
              },
              client
            );
          }
        }

        await client.query(
          `UPDATE catalog_item_requests SET
             status = 'APPROVED',
             reviewed_by = $1,
             reviewed_at = NOW(),
             category_id = $2,
             codigo = $3,
             descripcion = $4,
             unidad = $5,
             tipo = $6,
             unit_price = $7,
             review_notes = $8,
             catalog_item_id = COALESCE(catalog_item_id, $9),
             updated_at = NOW()
           WHERE id = $10`,
          [
            req.user.id,
            categoryId,
            codigo,
            descripcion,
            unidad,
            tipo,
            unitPrice,
            reviewNotes,
            catalogItemId,
            row.id,
          ]
        );

        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }

      await invalidateCatalogCache();
      const updated = await fetchRequestById(row.id);
      return res.json({
        success: true,
        data: { request: mapRequest(updated), catalogItemId },
      });
    } catch (err) {
      console.error('[CATALOG_REQUESTS] approve:', err);
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
    }
  }
);

// ─── PUT /api/catalog/requests/:id/reject ───────────────────────
router.put(
  '/:id/reject',
  requireRole('ADMIN', 'SEMIADMIN', 'SUPERUSER'),
  [param('id').isUUID(), body('reviewNotes').optional().isString()],
  async (req, res) => {
    try {
      const row = await fetchRequestById(req.params.id);
      if (!row) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Solicitud no encontrada' } });
      }
      if (row.status !== 'PENDING') {
        return res.status(400).json({
          success: false,
          error: { code: 'NOT_PENDING', message: 'La solicitud ya fue revisada' },
        });
      }
      if (!(await canReviewRequest(req.user, row))) {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Acceso denegado' } });
      }

      await pool.query(
        `UPDATE catalog_item_requests SET
           status = 'REJECTED',
           reviewed_by = $1,
           reviewed_at = NOW(),
           review_notes = $2,
           updated_at = NOW()
         WHERE id = $3`,
        [req.user.id, req.body.reviewNotes?.trim() || null, row.id]
      );

      const updated = await fetchRequestById(row.id);
      return res.json({ success: true, data: mapRequest(updated) });
    } catch (err) {
      console.error('[CATALOG_REQUESTS] reject:', err);
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
    }
  }
);

module.exports = router;
