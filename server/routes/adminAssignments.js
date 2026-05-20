const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { pool } = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);
router.use(requireRole('SUPERUSER'));

// ─── GET /api/admin-assignments — admins con sus comerciales ────
router.get('/', async (req, res) => {
  try {
    const { rows: admins } = await pool.query(
      `SELECT u.id, u.email, u.active,
              TRIM(CONCAT(e.nombres, ' ', e.apellidos)) AS nombre
       FROM users u
       LEFT JOIN employees e ON e.user_id = u.id
       WHERE u.role = 'ADMIN'
       ORDER BY u.email`
    );

    const { rows: assignments } = await pool.query(
      `SELECT a.admin_id, a.commercial_id, a.assigned_by, a.created_at,
              cu.email AS commercial_email,
              TRIM(CONCAT(ce.nombres, ' ', ce.apellidos)) AS commercial_nombre
       FROM admin_commercial_assignments a
       JOIN users cu ON cu.id = a.commercial_id
       LEFT JOIN employees ce ON ce.user_id = a.commercial_id
       ORDER BY cu.email`
    );

    const { rows: commercials } = await pool.query(
      `SELECT u.id, u.email, u.created_by,
              TRIM(CONCAT(e.nombres, ' ', e.apellidos)) AS nombre,
              creator.email AS created_by_email
       FROM users u
       LEFT JOIN employees e ON e.user_id = u.id
       LEFT JOIN users creator ON creator.id = u.created_by
       WHERE u.role = 'COMERCIAL' AND u.active = true
       ORDER BY u.email`
    );

    const byAdmin = {};
    for (const a of assignments) {
      if (!byAdmin[a.admin_id]) byAdmin[a.admin_id] = [];
      byAdmin[a.admin_id].push({
        commercialId: a.commercial_id,
        commercialEmail: a.commercial_email,
        commercialNombre: a.commercial_nombre,
        assignedBy: a.assigned_by,
        createdAt: a.created_at,
      });
    }

    return res.json({
      success: true,
      data: {
        admins: admins.map((a) => ({
          id: a.id,
          email: a.email,
          nombre: a.nombre || a.email,
          active: a.active,
          assignedCommercials: byAdmin[a.id] || [],
        })),
        allCommercials: commercials.map((c) => ({
          id: c.id,
          email: c.email,
          nombre: c.nombre || c.email,
          createdBy: c.created_by,
          createdByEmail: c.created_by_email,
        })),
      },
    });
  } catch (err) {
    console.error('[ADMIN_ASSIGNMENTS] list:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// ─── PUT /api/admin-assignments/:adminId — reemplaza comerciales ─
router.put(
  '/:adminId',
  [param('adminId').isUUID(), body('commercialIds').isArray()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: errors.array()[0].msg },
      });
    }

    const adminId = req.params.adminId;
    const commercialIds = [...new Set((req.body.commercialIds || []).filter(Boolean))];

    try {
      const { rows: ad } = await pool.query(
        `SELECT id FROM users WHERE id = $1 AND role = 'ADMIN' AND active = true`,
        [adminId]
      );
      if (!ad.length) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Administrador no encontrado' },
        });
      }

      if (commercialIds.length) {
        const { rows: valid } = await pool.query(
          `SELECT id FROM users WHERE id = ANY($1::uuid[]) AND role = 'COMERCIAL' AND active = true`,
          [commercialIds]
        );
        if (valid.length !== commercialIds.length) {
          return res.status(400).json({
            success: false,
            error: { code: 'INVALID_COMMERCIAL', message: 'IDs comerciales inválidos' },
          });
        }
      }

      await pool.query(`DELETE FROM admin_commercial_assignments WHERE admin_id = $1`, [adminId]);
      for (const cid of commercialIds) {
        await pool.query(
          `INSERT INTO admin_commercial_assignments (admin_id, commercial_id, assigned_by)
           VALUES ($1, $2, $3)`,
          [adminId, cid, req.user.id]
        );
      }

      const { rows: out } = await pool.query(
        `SELECT a.commercial_id, u.email
         FROM admin_commercial_assignments a
         JOIN users u ON u.id = a.commercial_id
         WHERE a.admin_id = $1 ORDER BY u.email`,
        [adminId]
      );

      return res.json({
        success: true,
        data: out.map((r) => ({ commercialId: r.commercial_id, email: r.email })),
      });
    } catch (err) {
      console.error('[ADMIN_ASSIGNMENTS] put:', err);
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
    }
  }
);

module.exports = router;
