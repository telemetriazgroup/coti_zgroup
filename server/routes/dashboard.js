const express = require('express');
const { pool } = require('../config/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// ─── GET /api/dashboard/summary — KPIs según rol ────────────────
router.get('/summary', async (req, res) => {
  const role = req.user.role;
  const uid = req.user.id;

  try {
    const { rows: cRows } = await pool.query(`SELECT COUNT(*)::int AS n FROM clients`);
    const clientsTotal = cRows[0].n;

    let projectsSql = `
      SELECT COUNT(*)::int AS n FROM projects p
      WHERE p.deleted_at IS NULL AND (
        $1 = 'ADMIN' OR
        ($1 = 'COMERCIAL' AND p.created_by = $2::uuid) OR
        ($1 = 'VIEWER' AND p.assigned_viewer = $2::uuid)
      )`;
    const { rows: pRows } = await pool.query(projectsSql, [role, uid]);
    const projectsActive = pRows[0].n;

    return res.json({
      success: true,
      data: {
        clientsTotal,
        projectsActive,
      },
    });
  } catch (err) {
    console.error('[DASHBOARD] summary:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

module.exports = router;
