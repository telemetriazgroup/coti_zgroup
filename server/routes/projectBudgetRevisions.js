const express = require('express');
const { pool } = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { getClientIp } = require('../utils/ip');
const { canReadProject, canWriteProject } = require('../utils/projectAccess');
const { loadShareContext } = require('../utils/projectShare');
const {
  listBudgetRevisions,
  getBudgetRevision,
  restoreBudgetRevision,
} = require('../lib/budgetRevisions');

const router = express.Router();
router.use(requireAuth);
router.use(requireRole('SUPERUSER'));

async function loadProjectOr404(req, res) {
  const { rows } = await pool.query(`SELECT * FROM projects WHERE id = $1`, [req.params.id]);
  if (!rows[0]) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Proyecto no encontrado' } });
    return null;
  }
  const project = rows[0];
  const shareCtx = await loadShareContext(req.user, project);
  if (!canReadProject(req.user, project, shareCtx)) {
    res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Acceso denegado' } });
    return null;
  }
  return project;
}

// ─── GET /api/projects/:id/budget-revisions ────────────────────
router.get('/:id/budget-revisions', async (req, res) => {
  try {
    const project = await loadProjectOr404(req, res);
    if (!project) return;
    const revisions = await listBudgetRevisions(req.params.id);
    return res.json({ success: true, data: { revisions } });
  } catch (err) {
    console.error('[BUDGET_REV] list:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// ─── GET /api/projects/:id/budget-revisions/:revId ─────────────
router.get('/:id/budget-revisions/:revId', async (req, res) => {
  try {
    const project = await loadProjectOr404(req, res);
    if (!project) return;
    const data = await getBudgetRevision(req.params.id, req.params.revId);
    if (!data) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Revisión no encontrada' } });
    }
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[BUDGET_REV] get:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// ─── POST /api/projects/:id/budget-revisions/:revId/restore ────
router.post('/:id/budget-revisions/:revId/restore', async (req, res) => {
  try {
    const project = await loadProjectOr404(req, res);
    if (!project) return;
    const shareCtx = await loadShareContext(req.user, project);
    if (!canWriteProject(req.user, project, shareCtx)) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Acceso denegado' } });
    }
    if (project.deleted_at) {
      return res.status(400).json({ success: false, error: { code: 'PROJECT_ARCHIVED', message: 'Proyecto archivado' } });
    }

    const result = await restoreBudgetRevision(req.params.id, req.params.revId, {
      actorId: req.user.id,
      ip: getClientIp(req),
    });
    return res.json({ success: true, data: result });
  } catch (err) {
    if (err.code === 'NOT_FOUND') {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: err.message } });
    }
    if (err.code === 'ALREADY_CURRENT') {
      return res.status(400).json({ success: false, error: { code: 'ALREADY_CURRENT', message: err.message } });
    }
    console.error('[BUDGET_REV] restore:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message || 'Error interno' } });
  }
});

module.exports = router;
