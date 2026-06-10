const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { pool } = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);
router.use(requireRole('SUPERUSER'));

async function fetchGroupsPayload() {
  const { rows: groups } = await pool.query(
    `SELECT g.id, g.nombre, g.created_by, g.created_at, g.updated_at,
            u.email AS created_by_email
     FROM admin_groups g
     LEFT JOIN users u ON u.id = g.created_by
     ORDER BY g.nombre ASC, g.created_at ASC`
  );

  const { rows: members } = await pool.query(
    `SELECT m.group_id, m.admin_id, m.assigned_by, m.created_at,
            u.email AS admin_email,
            TRIM(CONCAT(e.nombres, ' ', e.apellidos)) AS admin_nombre
     FROM admin_group_members m
     JOIN users u ON u.id = m.admin_id
     LEFT JOIN employees e ON e.user_id = m.admin_id
     ORDER BY u.email`
  );

  const { rows: admins } = await pool.query(
    `SELECT u.id, u.email, u.active,
            TRIM(CONCAT(e.nombres, ' ', e.apellidos)) AS nombre
     FROM users u
     LEFT JOIN employees e ON e.user_id = u.id
     WHERE u.role = 'ADMIN'
     ORDER BY u.email`
  );

  const byGroup = {};
  for (const m of members) {
    if (!byGroup[m.group_id]) byGroup[m.group_id] = [];
    byGroup[m.group_id].push({
      adminId: m.admin_id,
      adminEmail: m.admin_email,
      adminNombre: m.admin_nombre || m.admin_email,
      assignedBy: m.assigned_by,
      createdAt: m.created_at,
    });
  }

  return {
    groups: groups.map((g) => ({
      id: g.id,
      nombre: g.nombre,
      createdBy: g.created_by,
      createdByEmail: g.created_by_email,
      createdAt: g.created_at,
      updatedAt: g.updated_at,
      members: byGroup[g.id] || [],
    })),
    allAdmins: admins.map((a) => ({
      id: a.id,
      email: a.email,
      nombre: a.nombre || a.email,
      active: a.active,
    })),
  };
}

async function assertValidAdminIds(adminIds) {
  if (!adminIds.length) return true;
  const { rows } = await pool.query(
    `SELECT id FROM users WHERE id = ANY($1::uuid[]) AND role = 'ADMIN' AND active = true`,
    [adminIds]
  );
  return rows.length === adminIds.length;
}

// ─── GET /api/admin-groups ─────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const data = await fetchGroupsPayload();
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[ADMIN_GROUPS] list:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

const groupBody = [
  body('nombre').trim().notEmpty().withMessage('Nombre requerido').isLength({ max: 120 }),
  body('adminIds').isArray().withMessage('adminIds debe ser un arreglo'),
];

// ─── POST /api/admin-groups ─────────────────────────────────────
router.post('/', groupBody, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: errors.array()[0].msg },
    });
  }

  const nombre = req.body.nombre.trim();
  const adminIds = [...new Set((req.body.adminIds || []).filter(Boolean))];

  try {
    if (adminIds.length && !(await assertValidAdminIds(adminIds))) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_ADMIN', message: 'IDs de administrador inválidos' },
      });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO admin_groups (nombre, created_by) VALUES ($1, $2) RETURNING id`,
        [nombre, req.user.id]
      );
      const groupId = rows[0].id;
      for (const adminId of adminIds) {
        await client.query(
          `INSERT INTO admin_group_members (group_id, admin_id, assigned_by) VALUES ($1, $2, $3)`,
          [groupId, adminId, req.user.id]
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    const data = await fetchGroupsPayload();
    return res.status(201).json({ success: true, data });
  } catch (err) {
    console.error('[ADMIN_GROUPS] create:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// ─── PUT /api/admin-groups/:id ──────────────────────────────────
router.put('/:id', [param('id').isUUID(), ...groupBody], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: errors.array()[0].msg },
    });
  }

  const adminIds = [...new Set((req.body.adminIds || []).filter(Boolean))];
  const nombre = req.body.nombre.trim();

  try {
    const { rows: cur } = await pool.query(`SELECT id FROM admin_groups WHERE id = $1`, [req.params.id]);
    if (!cur[0]) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Grupo no encontrado' } });
    }

    if (adminIds.length && !(await assertValidAdminIds(adminIds))) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_ADMIN', message: 'IDs de administrador inválidos' },
      });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE admin_groups SET nombre = $1, updated_at = NOW() WHERE id = $2`, [
        nombre,
        req.params.id,
      ]);
      await client.query(`DELETE FROM admin_group_members WHERE group_id = $1`, [req.params.id]);
      for (const adminId of adminIds) {
        await client.query(
          `INSERT INTO admin_group_members (group_id, admin_id, assigned_by) VALUES ($1, $2, $3)`,
          [req.params.id, adminId, req.user.id]
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    const data = await fetchGroupsPayload();
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[ADMIN_GROUPS] update:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// ─── DELETE /api/admin-groups/:id ───────────────────────────────
router.delete('/:id', [param('id').isUUID()], async (req, res) => {
  try {
    const { rowCount } = await pool.query(`DELETE FROM admin_groups WHERE id = $1`, [req.params.id]);
    if (!rowCount) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Grupo no encontrado' } });
    }
    const data = await fetchGroupsPayload();
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[ADMIN_GROUPS] delete:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

module.exports = router;
