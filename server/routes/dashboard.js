const express = require('express');
const { pool } = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { loadSuperuserAnalytics } = require('../lib/superuserAnalytics');
const { loadUserActivityDashboard } = require('../lib/userActivity');

const router = express.Router();
router.use(requireAuth);

// ─── GET /api/dashboard/summary — KPIs según rol ────────────────
router.get('/summary', async (req, res) => {
  const role = req.user.role;
  const uid = req.user.id;

  try {
    if (role === 'SUPERUSER') {
      const { rows: cRows } = await pool.query(`SELECT COUNT(*)::int AS n FROM clients`);
      const { rows: pRows } = await pool.query(
        `SELECT COUNT(*)::int AS n FROM projects p WHERE p.deleted_at IS NULL`
      );
      return res.json({
        success: true,
        data: {
          scope: 'all',
          clientsTotal: cRows[0].n,
          projectsActive: pRows[0].n,
        },
      });
    }

    if (role === 'ADMIN') {
      const { rows: cRows } = await pool.query(`SELECT COUNT(*)::int AS n FROM clients`);
      const { rows: pRows } = await pool.query(
        `SELECT COUNT(*)::int AS n FROM projects p WHERE p.deleted_at IS NULL`
      );
      return res.json({
        success: true,
        data: {
          scope: 'all',
          clientsTotal: cRows[0].n,
          projectsActive: pRows[0].n,
        },
      });
    }

    if (role === 'COMERCIAL') {
      const projectScope = `p.deleted_at IS NULL AND (
        p.created_by = $1::uuid OR
        EXISTS (SELECT 1 FROM project_shares ps WHERE ps.project_id = p.id AND ps.user_id = $1::uuid)
      )`;
      const { rows: pRows } = await pool.query(
        `SELECT COUNT(*)::int AS n FROM projects p WHERE ${projectScope}`,
        [uid]
      );
      const { rows: clRows } = await pool.query(
        `SELECT COUNT(DISTINCT p.client_id)::int AS n FROM projects p
         WHERE ${projectScope} AND p.client_id IS NOT NULL`,
        [uid]
      );
      const { rows: pipeRows } = await pool.query(
        `SELECT COALESCE(SUM(pi.subtotal), 0)::numeric AS v
         FROM project_items pi
         INNER JOIN projects p ON p.id = pi.project_id
         WHERE ${projectScope}`,
        [uid]
      );
      return res.json({
        success: true,
        data: {
          scope: 'mine',
          projectsActive: pRows[0].n,
          clientsInMyProjects: clRows[0].n,
          pipelineMy: Number(pipeRows[0]?.v || 0),
        },
      });
    }

    if (role === 'VIEWER') {
      const { rows: pRows } = await pool.query(
        `SELECT COUNT(*)::int AS n FROM projects p
         WHERE p.deleted_at IS NULL AND p.assigned_viewer = $1::uuid`,
        [uid]
      );
      const { rows: clRows } = await pool.query(
        `SELECT COUNT(DISTINCT p.client_id)::int AS n FROM projects p
         WHERE p.deleted_at IS NULL AND p.client_id IS NOT NULL AND p.assigned_viewer = $1::uuid`,
        [uid]
      );
      const { rows: pipeRows } = await pool.query(
        `SELECT COALESCE(SUM(pi.subtotal), 0)::numeric AS v
         FROM project_items pi
         INNER JOIN projects p ON p.id = pi.project_id
         WHERE p.deleted_at IS NULL AND p.assigned_viewer = $1::uuid`,
        [uid]
      );
      return res.json({
        success: true,
        data: {
          scope: 'assigned',
          projectsActive: pRows[0].n,
          clientsInMyProjects: clRows[0].n,
          pipelineMy: Number(pipeRows[0]?.v || 0),
        },
      });
    }

    return res.json({
      success: true,
      data: { scope: 'unknown', projectsActive: 0, clientsInMyProjects: 0, pipelineMy: 0 },
    });
  } catch (err) {
    console.error('[DASHBOARD] summary:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// ─── GET /api/dashboard/admin — KPIs gerenciales (solo ADMIN) ──
router.get('/admin', requireRole('ADMIN', 'SEMIADMIN', 'SUPERUSER'), async (req, res) => {
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

// ─── GET /api/dashboard/superuser-analytics — indicadores globales (SUPERUSER) ─
router.get('/superuser-analytics', requireRole('SUPERUSER'), async (req, res) => {
  try {
    const data = await loadSuperuserAnalytics();
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[DASHBOARD] superuser-analytics:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

router.get('/user-activity', requireRole('SUPERUSER'), async (req, res) => {
  try {
    const data = await loadUserActivityDashboard();
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[DASHBOARD] user-activity:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

module.exports = router;
