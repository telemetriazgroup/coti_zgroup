const express = require('express');
const { body, validationResult } = require('express-validator');
const { pool } = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logAuditEvent } = require('../middleware/audit');
const { getClientIp } = require('../utils/ip');

const router = express.Router();
router.use(requireAuth);

function mapProject(row) {
  return {
    id: row.id,
    nombre: row.nombre,
    odooRef: row.odoo_ref,
    clientId: row.client_id,
    clientRazonSocial: row.client_razon_social,
    status: row.status,
    createdBy: row.created_by,
    assignedViewer: row.assigned_viewer,
    currency: row.currency,
    tc: row.tc != null ? Number(row.tc) : null,
    financeParams: row.finance_params,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function canWriteProject(user, row) {
  if (user.role === 'ADMIN') return true;
  if (user.role === 'COMERCIAL' && row.created_by === user.id) return true;
  return false;
}

function canReadProject(user, row) {
  if (user.role === 'ADMIN') return true;
  if (user.role === 'COMERCIAL' && row.created_by === user.id) return true;
  if (user.role === 'VIEWER' && row.assigned_viewer === user.id) return true;
  return false;
}

// ─── GET /api/projects — listado filtrado por rol ───────────────
router.get('/', async (req, res) => {
  const includeDeleted = req.query.includeDeleted === 'true' && req.user.role === 'ADMIN';

  try {
    const role = req.user.role;
    const uid = req.user.id;

    let sql = `
      SELECT p.*, c.razon_social AS client_razon_social
      FROM projects p
      LEFT JOIN clients c ON c.id = p.client_id
      WHERE (
        p.deleted_at IS NULL OR ($1 = 'ADMIN' AND $2 = true)
      )
      AND (
        $1 = 'ADMIN' OR
        ($1 = 'COMERCIAL' AND p.created_by = $3::uuid) OR
        ($1 = 'VIEWER' AND p.assigned_viewer = $3::uuid)
      )
      ORDER BY p.updated_at DESC`;

    const { rows } = await pool.query(sql, [role, includeDeleted, uid]);
    return res.json({ success: true, data: rows.map(mapProject) });
  } catch (err) {
    console.error('[PROJECTS] list:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// ─── GET /api/projects/:id/audit ───────────────────────────────
router.get('/:id/audit', async (req, res) => {
  try {
    const { rows: pr } = await pool.query(`SELECT * FROM projects WHERE id = $1`, [req.params.id]);
    if (!pr[0]) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Proyecto no encontrado' } });
    }
    if (!canReadProject(req.user, pr[0])) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Acceso denegado' } });
    }

    const { rows } = await pool.query(
      `SELECT id, project_id, event_type, actor_id, prev_data, new_data, ip_address, created_at
       FROM project_audit_log
       WHERE project_id = $1
       ORDER BY created_at DESC
       LIMIT 200`,
      [req.params.id]
    );

    return res.json({
      success: true,
      data: rows.map((r) => ({
        id: r.id,
        projectId: r.project_id,
        eventType: r.event_type,
        actorId: r.actor_id,
        prevData: r.prev_data,
        newData: r.new_data,
        ipAddress: r.ip_address,
        createdAt: r.created_at,
      })),
    });
  } catch (err) {
    console.error('[PROJECTS] audit:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// ─── POST /api/projects/:id/clone ──────────────────────────────
router.post(
  '/:id/clone',
  requireRole('ADMIN', 'COMERCIAL'),
  [body('nombre').optional().isString()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: errors.array()[0].msg },
      });
    }

    const client = await pool.connect();
    try {
      const { rows: srcRows } = await client.query(`SELECT * FROM projects WHERE id = $1`, [req.params.id]);
      const src = srcRows[0];
      if (!src) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Proyecto no encontrado' } });
      }
      if (!canWriteProject(req.user, src)) {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Acceso denegado' } });
      }

      const nombre = (req.body.nombre && String(req.body.nombre).trim()) || `Copia de ${src.nombre}`;

      await client.query('BEGIN');

      const fp =
        src.finance_params && typeof src.finance_params === 'object'
          ? src.finance_params
          : {};

      const { rows: ins } = await client.query(
        `INSERT INTO projects
          (nombre, odoo_ref, client_id, status, created_by, assigned_viewer, currency, tc, finance_params)
         VALUES ($1, $2, $3, 'BORRADOR', $4, NULL, $5, $6, $7::jsonb)
         RETURNING *`,
        [nombre, src.odoo_ref, src.client_id, req.user.id, src.currency, src.tc, JSON.stringify(fp)]
      );
      const newId = ins[0].id;

      const { rows: items } = await client.query(
        `SELECT catalog_item_id, codigo, descripcion, unidad, tipo, unit_price, qty, is_custom, sort_order
         FROM project_items WHERE project_id = $1 ORDER BY sort_order, created_at`,
        [req.params.id]
      );

      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        await client.query(
          `INSERT INTO project_items
            (project_id, catalog_item_id, codigo, descripcion, unidad, tipo, unit_price, qty, is_custom, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            newId,
            it.catalog_item_id,
            it.codigo,
            it.descripcion,
            it.unidad,
            it.tipo,
            it.unit_price,
            it.qty,
            it.is_custom,
            i,
          ]
        );
      }

      await client.query('COMMIT');

      const ip = getClientIp(req);
      logAuditEvent({
        projectId: newId,
        eventType: 'PROJECT_CLONE',
        actorId: req.user.id,
        prevData: { sourceProjectId: req.params.id },
        newData: { id: newId, nombre },
        ip,
      });

      const { rows: full } = await pool.query(
        `SELECT p.*, c.razon_social AS client_razon_social FROM projects p
         LEFT JOIN clients c ON c.id = p.client_id WHERE p.id = $1`,
        [newId]
      );

      return res.status(201).json({ success: true, data: mapProject(full[0]) });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[PROJECTS] clone:', err);
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
    } finally {
      client.release();
    }
  }
);

// ─── PATCH /api/projects/:id/viewer — asignar VIEWER ─────────────
router.patch(
  '/:id/viewer',
  requireRole('ADMIN', 'COMERCIAL'),
  [body('assignedViewerId').optional({ nullable: true }).isUUID()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: errors.array()[0].msg },
      });
    }

    const { assignedViewerId } = req.body;

    try {
      const { rows: pr } = await pool.query(`SELECT * FROM projects WHERE id = $1`, [req.params.id]);
      if (!pr[0]) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Proyecto no encontrado' } });
      }
      if (!canWriteProject(req.user, pr[0])) {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Acceso denegado' } });
      }

      if (assignedViewerId) {
        const { rows: vu } = await pool.query(
          `SELECT id, role FROM users WHERE id = $1 AND active = true`,
          [assignedViewerId]
        );
        if (!vu[0] || vu[0].role !== 'VIEWER') {
          return res.status(400).json({
            success: false,
            error: { code: 'INVALID_VIEWER', message: 'Debe ser un usuario VIEWER activo' },
          });
        }
      }

      const prev = { assignedViewer: pr[0].assigned_viewer };
      const { rows: up } = await pool.query(
        `UPDATE projects SET assigned_viewer = $1 WHERE id = $2 RETURNING *`,
        [assignedViewerId || null, req.params.id]
      );

      const ip = getClientIp(req);
      logAuditEvent({
        projectId: req.params.id,
        eventType: 'CLIENT_ASSIGN',
        actorId: req.user.id,
        prevData: prev,
        newData: { assignedViewer: up[0].assigned_viewer },
        ip,
      });

      const { rows: full } = await pool.query(
        `SELECT p.*, c.razon_social AS client_razon_social FROM projects p
         LEFT JOIN clients c ON c.id = p.client_id WHERE p.id = $1`,
        [req.params.id]
      );
      return res.json({ success: true, data: mapProject(full[0]) });
    } catch (err) {
      console.error('[PROJECTS] viewer:', err);
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
    }
  }
);

const createValidation = [
  body('nombre').notEmpty().withMessage('Nombre requerido'),
  body('odooRef').optional().isString(),
  body('clientId').optional({ nullable: true }).isUUID(),
  body('status').optional().isIn([
    'BORRADOR',
    'EN_SEGUIMIENTO',
    'PRESENTADA',
    'ACEPTADA',
    'RECHAZADA',
    'EN_NEGOCIACION',
  ]),
];

// ─── POST /api/projects ────────────────────────────────────────
router.post('/', requireRole('ADMIN', 'COMERCIAL'), createValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: errors.array()[0].msg },
    });
  }

  const { nombre, odooRef, clientId, status } = req.body;

  try {
    if (clientId) {
      const { rows: c } = await pool.query(`SELECT id FROM clients WHERE id = $1`, [clientId]);
      if (!c.length) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_CLIENT', message: 'Cliente no existe' },
        });
      }
    }

    const { rows } = await pool.query(
      `INSERT INTO projects (nombre, odoo_ref, client_id, status, created_by)
       VALUES ($1, $2, $3, COALESCE($4, 'BORRADOR'), $5)
       RETURNING *`,
      [nombre.trim(), odooRef || null, clientId || null, status || null, req.user.id]
    );

    const ip = getClientIp(req);
    logAuditEvent({
      projectId: rows[0].id,
      eventType: 'PROJECT_CREATE',
      actorId: req.user.id,
      prevData: null,
      newData: mapProject(rows[0]),
      ip,
    });

    const { rows: full } = await pool.query(
      `SELECT p.*, c.razon_social AS client_razon_social FROM projects p
       LEFT JOIN clients c ON c.id = p.client_id WHERE p.id = $1`,
      [rows[0].id]
    );
    return res.status(201).json({ success: true, data: mapProject(full[0]) });
  } catch (err) {
    console.error('[PROJECTS] create:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

const updateValidation = [
  body('nombre').optional().isString(),
  body('odooRef').optional().isString(),
  body('clientId').optional({ nullable: true }).isUUID(),
  body('status').optional().isIn([
    'BORRADOR',
    'EN_SEGUIMIENTO',
    'PRESENTADA',
    'ACEPTADA',
    'RECHAZADA',
    'EN_NEGOCIACION',
  ]),
  body('currency').optional().isString(),
  body('tc').optional().isNumeric(),
  body('financeParams').optional().isObject(),
];

// ─── PUT /api/projects/:id ─────────────────────────────────────
router.put('/:id', requireRole('ADMIN', 'COMERCIAL'), updateValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: errors.array()[0].msg },
    });
  }

  try {
    const { rows: pr } = await pool.query(`SELECT * FROM projects WHERE id = $1`, [req.params.id]);
    if (!pr[0]) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Proyecto no encontrado' } });
    }
    if (!canWriteProject(req.user, pr[0])) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Acceso denegado' } });
    }
    if (pr[0].deleted_at) {
      return res.status(400).json({
        success: false,
        error: { code: 'DELETED', message: 'El proyecto está eliminado' },
      });
    }

    const { nombre, odooRef, clientId, status, currency, tc, financeParams } = req.body;

    if (clientId) {
      const { rows: c } = await pool.query(`SELECT id FROM clients WHERE id = $1`, [clientId]);
      if (!c.length) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_CLIENT', message: 'Cliente no existe' },
        });
      }
    }

    const prevSnapshot = mapProject(pr[0]);

    const fields = [];
    const vals = [];
    let i = 1;

    if (nombre !== undefined) {
      fields.push(`nombre = $${i++}`);
      vals.push(nombre.trim());
    }
    if (odooRef !== undefined) {
      fields.push(`odoo_ref = $${i++}`);
      vals.push(odooRef || null);
    }
    if (clientId !== undefined) {
      fields.push(`client_id = $${i++}`);
      vals.push(clientId || null);
    }
    if (status !== undefined) {
      fields.push(`status = $${i++}`);
      vals.push(status);
    }
    if (currency !== undefined) {
      fields.push(`currency = $${i++}`);
      vals.push(currency);
    }
    if (tc !== undefined) {
      fields.push(`tc = $${i++}`);
      vals.push(tc);
    }
    if (financeParams !== undefined) {
      fields.push(`finance_params = $${i++}`);
      vals.push(JSON.stringify(financeParams));
    }

    if (fields.length === 0) {
      const { rows: full } = await pool.query(
        `SELECT p.*, c.razon_social AS client_razon_social FROM projects p
         LEFT JOIN clients c ON c.id = p.client_id WHERE p.id = $1`,
        [req.params.id]
      );
      return res.json({ success: true, data: mapProject(full[0]) });
    }

    vals.push(req.params.id);
    await pool.query(`UPDATE projects SET ${fields.join(', ')} WHERE id = $${i}`, vals);

    const { rows: newRows } = await pool.query(`SELECT * FROM projects WHERE id = $1`, [req.params.id]);
    const ip = getClientIp(req);
    logAuditEvent({
      projectId: req.params.id,
      eventType: 'PROJECT_UPDATE',
      actorId: req.user.id,
      prevData: prevSnapshot,
      newData: mapProject(newRows[0]),
      ip,
    });

    const { rows: full } = await pool.query(
      `SELECT p.*, c.razon_social AS client_razon_social FROM projects p
       LEFT JOIN clients c ON c.id = p.client_id WHERE p.id = $1`,
      [req.params.id]
    );
    return res.json({ success: true, data: mapProject(full[0]) });
  } catch (err) {
    console.error('[PROJECTS] update:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// ─── DELETE /api/projects/:id — soft delete ───────────────────
router.delete('/:id', requireRole('ADMIN', 'COMERCIAL'), async (req, res) => {
  try {
    const { rows: pr } = await pool.query(`SELECT * FROM projects WHERE id = $1`, [req.params.id]);
    if (!pr[0]) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Proyecto no encontrado' } });
    }
    if (!canWriteProject(req.user, pr[0])) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Acceso denegado' } });
    }
    if (pr[0].deleted_at) {
      return res.json({ success: true, data: { message: 'Ya estaba eliminado' } });
    }

    await pool.query(`UPDATE projects SET deleted_at = NOW() WHERE id = $1`, [req.params.id]);

    const ip = getClientIp(req);
    logAuditEvent({
      projectId: req.params.id,
      eventType: 'PROJECT_DELETE',
      actorId: req.user.id,
      prevData: mapProject(pr[0]),
      newData: { deletedAt: new Date().toISOString() },
      ip,
    });

    return res.json({ success: true, data: { message: 'Proyecto archivado' } });
  } catch (err) {
    console.error('[PROJECTS] delete:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// ─── GET /api/projects/:id ─────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.*, c.razon_social AS client_razon_social FROM projects p
       LEFT JOIN clients c ON c.id = p.client_id WHERE p.id = $1`,
      [req.params.id]
    );
    if (!rows[0]) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Proyecto no encontrado' } });
    }
    if (!canReadProject(req.user, rows[0])) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Acceso denegado' } });
    }
    if (rows[0].deleted_at && req.user.role !== 'ADMIN') {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Proyecto no encontrado' } });
    }
    if (rows[0].deleted_at && req.user.role === 'ADMIN' && req.query.includeDeleted !== 'true') {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Proyecto no encontrado' } });
    }

    return res.json({ success: true, data: mapProject(rows[0]) });
  } catch (err) {
    console.error('[PROJECTS] get:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

module.exports = router;
