const express = require('express');
const { pool } = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');

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

// ─── GET /api/dashboard/admin — KPIs gerenciales (solo ADMIN) ──
router.get('/admin', requireRole('ADMIN'), async (req, res) => {
  try {
    const { rows: statusRows } = await pool.query(
      `SELECT status, COUNT(*)::int AS n FROM projects WHERE deleted_at IS NULL GROUP BY status ORDER BY status`
    );
    const { rows: pipeRow } = await pool.query(
      `SELECT COALESCE(SUM(pi.subtotal), 0)::numeric AS pipeline
       FROM project_items pi
       INNER JOIN projects p ON p.id = pi.project_id
       WHERE p.deleted_at IS NULL`
    );
    const { rows: totProj } = await pool.query(`SELECT COUNT(*)::int AS n FROM projects WHERE deleted_at IS NULL`);
    const { rows: accepted } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM projects WHERE deleted_at IS NULL AND status = 'ACEPTADA'`
    );

    const pipelineTotal = Number(pipeRow[0]?.pipeline || 0);
    const projectsTotal = totProj[0]?.n || 0;
    const acceptedTotal = accepted[0]?.n || 0;
    const ratioCierre = projectsTotal > 0 ? acceptedTotal / projectsTotal : 0;

    const { rows: commercial } = await pool.query(
      `SELECT
         u.id,
         u.email,
         e.nombres,
         e.apellidos,
         (SELECT COUNT(*)::int FROM projects p WHERE p.created_by = u.id AND p.deleted_at IS NULL) AS projects_n,
         (SELECT COALESCE(SUM(pi.subtotal), 0)::numeric FROM project_items pi
            INNER JOIN projects p ON p.id = pi.project_id
            WHERE p.created_by = u.id AND p.deleted_at IS NULL) AS pipeline_value,
         (SELECT COUNT(*)::int FROM projects p WHERE p.created_by = u.id AND p.deleted_at IS NULL AND p.status = 'ACEPTADA') AS accepted_n
       FROM users u
       LEFT JOIN employees e ON e.user_id = u.id
       WHERE u.role = 'COMERCIAL'
       ORDER BY u.email`
    );

    return res.json({
      success: true,
      data: {
        projectsByStatus: statusRows.map((r) => ({ status: r.status, count: r.n })),
        pipelineTotal,
        projectsTotal,
        acceptedTotal,
        ratioCierre,
        commercial: commercial.map((r) => ({
          id: r.id,
          email: r.email,
          nombres: r.nombres,
          apellidos: r.apellidos,
          projectsN: r.projects_n,
          pipelineValue: r.pipeline_value != null ? Number(r.pipeline_value) : 0,
          acceptedN: r.accepted_n,
        })),
      },
    });
  } catch (err) {
    console.error('[DASHBOARD] admin:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

module.exports = router;
