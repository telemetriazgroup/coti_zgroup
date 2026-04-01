const express = require('express');
const { body, validationResult } = require('express-validator');
const { pool } = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logAuditEvent } = require('../middleware/audit');
const { getClientIp } = require('../utils/ip');
const { canReadProject, canWriteProject } = require('../utils/projectAccess');

const router = express.Router();
router.use(requireAuth);

/** Lista ítems con nombre de categoría (LEFT JOIN). */
const ITEMS_SELECT = `
  SELECT pi.*, cc.nombre AS category_nombre
  FROM project_items pi
  LEFT JOIN catalog_categories cc ON cc.id = pi.category_id
`;

function mapItem(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    catalogItemId: row.catalog_item_id,
    codigo: row.codigo,
    descripcion: row.descripcion,
    unidad: row.unidad,
    tipo: row.tipo,
    unitPrice: row.unit_price != null ? Number(row.unit_price) : 0,
    qty: row.qty != null ? Number(row.qty) : 0,
    subtotal: row.subtotal != null ? Number(row.subtotal) : 0,
    isCustom: row.is_custom,
    categoryId: row.category_id ?? null,
    categoryNombre: row.category_nombre ?? null,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function totalsFromRows(rows) {
  let activos = 0;
  let consumibles = 0;
  for (const r of rows) {
    const st = r.subtotal != null ? Number(r.subtotal) : 0;
    if (r.tipo === 'ACTIVO') activos += st;
    else if (r.tipo === 'CONSUMIBLE') consumibles += st;
  }
  return {
    activos: Math.round(activos * 100) / 100,
    consumibles: Math.round(consumibles * 100) / 100,
    lista: Math.round((activos + consumibles) * 100) / 100,
  };
}

async function loadProject(req, res, id) {
  const { rows } = await pool.query(`SELECT * FROM projects WHERE id = $1`, [id]);
  if (!rows[0]) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Proyecto no encontrado' } });
    return null;
  }
  const p = rows[0];
  if (!canReadProject(req.user, p)) {
    res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Acceso denegado' } });
    return null;
  }
  if (p.deleted_at && req.user.role !== 'ADMIN') {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Proyecto no encontrado' } });
    return null;
  }
  if (p.deleted_at && req.user.role === 'ADMIN' && req.query.includeDeleted !== 'true') {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Proyecto no encontrado' } });
    return null;
  }
  return p;
}

async function touchProjectUpdated(projectId, client = pool) {
  await client.query(`UPDATE projects SET updated_at = NOW() WHERE id = $1`, [projectId]);
}

async function fetchItemRow(client, id) {
  const { rows } = await client.query(`${ITEMS_SELECT} WHERE pi.id = $1`, [id]);
  return rows[0];
}

// ─── GET /api/projects/:id/items ───────────────────────────────
router.get('/:id/items', async (req, res) => {
  try {
    const project = await loadProject(req, res, req.params.id);
    if (!project) return;

    const { rows } = await pool.query(
      `${ITEMS_SELECT} WHERE pi.project_id = $1 ORDER BY pi.sort_order ASC, pi.created_at ASC`,
      [req.params.id]
    );

    return res.json({
      success: true,
      data: {
        items: rows.map(mapItem),
        totals: totalsFromRows(rows),
        projectStatus: project.status,
      },
    });
  } catch (err) {
    console.error('[PROJECT_ITEMS] list:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

const postItemValidation = [
  body('catalogItemId').optional().isUUID(),
  body('qty').optional().isFloat({ min: 0.001 }),
  body('unitPrice').optional().isFloat({ min: 0 }),
  body('custom').optional().isObject(),
];

// ─── POST /api/projects/:id/items ──────────────────────────────
router.post('/:id/items', requireRole('ADMIN', 'COMERCIAL'), postItemValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: errors.array()[0].msg },
    });
  }

  const { catalogItemId, custom } = req.body;
  const hasCatalog = Boolean(catalogItemId);
  const hasCustom = custom && typeof custom === 'object';

  if (!hasCatalog && !hasCustom) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Envíe catalogItemId o el objeto custom' },
    });
  }
  if (hasCatalog && hasCustom) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Envíe solo catalogItemId o solo custom' },
    });
  }

  const client = await pool.connect();
  const ip = getClientIp(req);

  try {
    await client.query('BEGIN');

    const { rows: pr } = await client.query(`SELECT * FROM projects WHERE id = $1`, [req.params.id]);
    if (!pr[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Proyecto no encontrado' } });
    }
    const project = pr[0];
    if (!canWriteProject(req.user, project)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Acceso denegado' } });
    }
    if (project.deleted_at) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: { code: 'PROJECT_ARCHIVED', message: 'Proyecto archivado' } });
    }

    const { rows: cntRows } = await client.query(
      `SELECT COUNT(*)::int AS n FROM project_items WHERE project_id = $1`,
      [req.params.id]
    );
    const wasEmpty = cntRows[0].n === 0;

    let merged = false;
    let outRow;

    if (hasCatalog) {
      const qty = req.body.qty != null ? Number(req.body.qty) : 1;
      const overridePrice = req.body.unitPrice != null ? Number(req.body.unitPrice) : null;

      const { rows: catRows } = await client.query(
        `SELECT * FROM catalog_items WHERE id = $1 AND active = true`,
        [catalogItemId]
      );
      if (!catRows[0]) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, error: { code: 'INVALID_CATALOG', message: 'Ítem de catálogo no válido' } });
      }
      const cat = catRows[0];
      const unitPrice = overridePrice != null ? overridePrice : Number(cat.unit_price);

      const { rows: exist } = await client.query(
        `SELECT id, qty FROM project_items
         WHERE project_id = $1 AND catalog_item_id = $2 AND unit_price = $3
         LIMIT 1`,
        [req.params.id, catalogItemId, unitPrice]
      );

      if (exist[0]) {
        merged = true;
        const prevQty = Number(exist[0].qty);
        const newQty = prevQty + qty;
        await client.query(`UPDATE project_items SET qty = $1, updated_at = NOW() WHERE id = $2`, [
          newQty,
          exist[0].id,
        ]);
        outRow = await fetchItemRow(client, exist[0].id);
        logAuditEvent({
          projectId: req.params.id,
          eventType: 'BUDGET_ITEM_UPDATE',
          actorId: req.user.id,
          prevData: { id: exist[0].id, qty: prevQty },
          newData: { id: exist[0].id, qty: newQty, mergedFromCatalog: catalogItemId },
          ip,
        });
      } else {
        const { rows: so } = await client.query(
          `SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM project_items WHERE project_id = $1`,
          [req.params.id]
        );
        const sortOrder = so[0].n;
        const { rows: ins } = await client.query(
          `INSERT INTO project_items
            (project_id, catalog_item_id, codigo, descripcion, unidad, tipo, unit_price, qty, is_custom, sort_order, category_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, $9, $10)
           RETURNING id`,
          [
            req.params.id,
            catalogItemId,
            cat.codigo,
            cat.descripcion,
            cat.unidad,
            cat.tipo,
            unitPrice,
            qty,
            sortOrder,
            cat.category_id,
          ]
        );
        outRow = await fetchItemRow(client, ins[0].id);
        logAuditEvent({
          projectId: req.params.id,
          eventType: 'BUDGET_ITEM_ADD',
          actorId: req.user.id,
          prevData: null,
          newData: mapItem(outRow),
          ip,
        });
      }
    } else {
      const c = custom;
      const codigo = String(c.codigo || '').trim().slice(0, 50);
      const descripcion = String(c.descripcion || '').trim().slice(0, 300);
      const unidad = String(c.unidad || 'UND').trim().slice(0, 30);
      const tipo = c.tipo === 'CONSUMIBLE' ? 'CONSUMIBLE' : 'ACTIVO';
      const unitPrice = c.unitPrice != null ? Number(c.unitPrice) : 0;
      const qty = c.qty != null ? Number(c.qty) : 1;

      let categoryId = null;
      if (c.categoryId != null && String(c.categoryId).trim() !== '') {
        const rawCat = String(c.categoryId).trim();
        const { rows: ccRows } = await client.query(`SELECT id FROM catalog_categories WHERE id = $1`, [
          rawCat,
        ]);
        if (!ccRows.length) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            error: { code: 'INVALID_CATEGORY', message: 'Categoría no válida' },
          });
        }
        categoryId = rawCat;
      }

      if (!codigo || !descripcion) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Código y descripción son obligatorios' },
        });
      }
      if (Number.isNaN(unitPrice) || unitPrice < 0 || Number.isNaN(qty) || qty < 0.001) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Cantidad y precio inválidos' },
        });
      }

      const { rows: exist } = await client.query(
        `SELECT id, qty FROM project_items
         WHERE project_id = $1 AND is_custom = true AND catalog_item_id IS NULL
           AND codigo = $2 AND unit_price = $3
           AND (category_id IS NOT DISTINCT FROM $4::uuid)
         LIMIT 1`,
        [req.params.id, codigo, unitPrice, categoryId]
      );

      if (exist[0]) {
        merged = true;
        const prevQty = Number(exist[0].qty);
        const newQty = prevQty + qty;
        await client.query(`UPDATE project_items SET qty = $1, updated_at = NOW() WHERE id = $2`, [
          newQty,
          exist[0].id,
        ]);
        outRow = await fetchItemRow(client, exist[0].id);
        logAuditEvent({
          projectId: req.params.id,
          eventType: 'BUDGET_ITEM_UPDATE',
          actorId: req.user.id,
          prevData: { id: exist[0].id, qty: prevQty },
          newData: { id: exist[0].id, qty: newQty, customCodigo: codigo },
          ip,
        });
      } else {
        const { rows: so } = await client.query(
          `SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM project_items WHERE project_id = $1`,
          [req.params.id]
        );
        const sortOrder = so[0].n;
        const { rows: ins } = await client.query(
          `INSERT INTO project_items
            (project_id, catalog_item_id, codigo, descripcion, unidad, tipo, unit_price, qty, is_custom, sort_order, category_id)
           VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, true, $8, $9)
           RETURNING id`,
          [req.params.id, codigo, descripcion, unidad, tipo, unitPrice, qty, sortOrder, categoryId]
        );
        outRow = await fetchItemRow(client, ins[0].id);
        logAuditEvent({
          projectId: req.params.id,
          eventType: 'BUDGET_ITEM_ADD',
          actorId: req.user.id,
          prevData: null,
          newData: mapItem(outRow),
          ip,
        });
      }
    }

    if (wasEmpty && !merged) {
      await client.query(
        `UPDATE projects SET status = 'EN_SEGUIMIENTO', updated_at = NOW() WHERE id = $1 AND status = 'BORRADOR'`,
        [req.params.id]
      );
    } else {
      await touchProjectUpdated(req.params.id, client);
    }

    await client.query('COMMIT');

    const { rows: all } = await pool.query(
      `${ITEMS_SELECT} WHERE pi.project_id = $1 ORDER BY pi.sort_order ASC, pi.created_at ASC`,
      [req.params.id]
    );
    const { rows: st } = await pool.query(`SELECT status FROM projects WHERE id = $1`, [req.params.id]);

    return res.status(merged ? 200 : 201).json({
      success: true,
      data: {
        item: mapItem(outRow),
        merged,
        items: all.map(mapItem),
        totals: totalsFromRows(all),
        projectStatus: st[0]?.status,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[PROJECT_ITEMS] post:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  } finally {
    client.release();
  }
});

const putItemValidation = [
  body('qty').optional().isFloat({ min: 0.001 }),
  body('unitPrice').optional().isFloat({ min: 0 }),
];

// ─── PUT /api/projects/:id/items/:itemId ───────────────────────
router.put(
  '/:id/items/:itemId',
  requireRole('ADMIN', 'COMERCIAL'),
  putItemValidation,
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: errors.array()[0].msg },
      });
    }

    const { qty, unitPrice } = req.body;
    if (qty == null && unitPrice == null) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Indique qty o unitPrice' },
      });
    }

    const ip = getClientIp(req);

    try {
      const project = await loadProject(req, res, req.params.id);
      if (!project) return;
      if (!canWriteProject(req.user, project)) {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Acceso denegado' } });
      }
      if (project.deleted_at) {
        return res.status(400).json({ success: false, error: { code: 'PROJECT_ARCHIVED', message: 'Proyecto archivado' } });
      }

      const { rows: cur } = await pool.query(
        `${ITEMS_SELECT} WHERE pi.id = $1 AND pi.project_id = $2`,
        [req.params.itemId, req.params.id]
      );
      if (!cur[0]) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Ítem no encontrado' } });
      }

      const prevSnap = mapItem(cur[0]);
      const nextQty = qty != null ? Number(qty) : Number(cur[0].qty);
      const nextPrice = unitPrice != null ? Number(unitPrice) : Number(cur[0].unit_price);

      await pool.query(
        `UPDATE project_items SET qty = $1, unit_price = $2, updated_at = NOW()
         WHERE id = $3 AND project_id = $4`,
        [nextQty, nextPrice, req.params.itemId, req.params.id]
      );

      const { rows: upRows } = await pool.query(`${ITEMS_SELECT} WHERE pi.id = $1`, [req.params.itemId]);

      await touchProjectUpdated(req.params.id);

      logAuditEvent({
        projectId: req.params.id,
        eventType: 'BUDGET_ITEM_UPDATE',
        actorId: req.user.id,
        prevData: prevSnap,
        newData: mapItem(upRows[0]),
        ip,
      });

      const { rows: all } = await pool.query(
        `${ITEMS_SELECT} WHERE pi.project_id = $1 ORDER BY pi.sort_order ASC, pi.created_at ASC`,
        [req.params.id]
      );

      return res.json({
        success: true,
        data: {
          item: mapItem(upRows[0]),
          items: all.map(mapItem),
          totals: totalsFromRows(all),
          projectStatus: project.status,
        },
      });
    } catch (err) {
      console.error('[PROJECT_ITEMS] put:', err);
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
    }
  }
);

// ─── DELETE /api/projects/:id/items/:itemId ────────────────────
router.delete('/:id/items/:itemId', requireRole('ADMIN', 'COMERCIAL'), async (req, res) => {
  const ip = getClientIp(req);
  try {
    const project = await loadProject(req, res, req.params.id);
    if (!project) return;
    if (!canWriteProject(req.user, project)) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Acceso denegado' } });
    }
    if (project.deleted_at) {
      return res.status(400).json({ success: false, error: { code: 'PROJECT_ARCHIVED', message: 'Proyecto archivado' } });
    }

    const { rows: cur } = await pool.query(
      `${ITEMS_SELECT} WHERE pi.id = $1 AND pi.project_id = $2`,
      [req.params.itemId, req.params.id]
    );
    if (!cur[0]) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Ítem no encontrado' } });
    }

    await pool.query(`DELETE FROM project_items WHERE id = $1`, [req.params.itemId]);
    await touchProjectUpdated(req.params.id);

    logAuditEvent({
      projectId: req.params.id,
      eventType: 'BUDGET_ITEM_DELETE',
      actorId: req.user.id,
      prevData: mapItem(cur[0]),
      newData: null,
      ip,
    });

    const { rows: all } = await pool.query(
      `${ITEMS_SELECT} WHERE pi.project_id = $1 ORDER BY pi.sort_order ASC, pi.created_at ASC`,
      [req.params.id]
    );

    return res.json({
      success: true,
      data: {
        items: all.map(mapItem),
        totals: totalsFromRows(all),
        projectStatus: project.status,
      },
    });
  } catch (err) {
    console.error('[PROJECT_ITEMS] delete one:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// ─── DELETE /api/projects/:id/items — vaciar presupuesto ───────
router.delete('/:id/items', requireRole('ADMIN', 'COMERCIAL'), async (req, res) => {
  const ip = getClientIp(req);
  try {
    const project = await loadProject(req, res, req.params.id);
    if (!project) return;
    if (!canWriteProject(req.user, project)) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Acceso denegado' } });
    }
    if (project.deleted_at) {
      return res.status(400).json({ success: false, error: { code: 'PROJECT_ARCHIVED', message: 'Proyecto archivado' } });
    }

    const { rowCount } = await pool.query(`DELETE FROM project_items WHERE project_id = $1`, [req.params.id]);
    await touchProjectUpdated(req.params.id);

    logAuditEvent({
      projectId: req.params.id,
      eventType: 'BUDGET_CLEAR',
      actorId: req.user.id,
      prevData: { removedCount: rowCount },
      newData: null,
      ip,
    });

    return res.json({
      success: true,
      data: {
        items: [],
        totals: { activos: 0, consumibles: 0, lista: 0 },
        cleared: rowCount,
        projectStatus: project.status,
      },
    });
  } catch (err) {
    console.error('[PROJECT_ITEMS] clear:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

module.exports = router;
