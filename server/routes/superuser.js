const express = require('express');
const multer = require('multer');
const { pool } = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { exportSystemData, importSystemData } = require('../lib/systemExport');
const { invalidateCatalogCache } = require('../lib/catalogRedis');
const {
  listTables,
  getTableSchema,
  fetchTableRows,
  updateTableRow,
} = require('../lib/dbBrowser');
const { verifyUserPassword: verifySuperPassword } = require('../lib/verifyUserPassword');
const {
  listLoginLockouts,
  clearLoginLockout,
  clearLoginLockoutByUserId,
} = require('../lib/loginLockout');

const router = express.Router();
router.use(requireAuth);
router.use(requireRole('SUPERUSER'));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

router.get('/export', async (req, res) => {
  try {
    const data = await exportSystemData();
    const filename = `zgroup-export-${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[SUPERUSER] export:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error al exportar' } });
  }
});

router.get('/audit', async (req, res) => {
  const limit = Math.min(1000, Math.max(1, parseInt(req.query.limit || '500', 10) || 500));
  const projectId = req.query.projectId || null;

  try {
    let sql = `
      SELECT a.id, a.project_id, a.event_type, a.actor_id, a.prev_data, a.new_data, a.ip_address, a.created_at,
             u.email AS actor_email,
             TRIM(CONCAT(e.nombres, ' ', e.apellidos)) AS actor_name,
             p.nombre AS project_nombre,
             cu.email AS project_creator_email
      FROM project_audit_log a
      LEFT JOIN users u ON u.id = a.actor_id
      LEFT JOIN employees e ON e.user_id = a.actor_id
      LEFT JOIN projects p ON p.id = a.project_id
      LEFT JOIN users cu ON cu.id = p.created_by
      WHERE 1=1`;
    const params = [];
    if (projectId) {
      params.push(projectId);
      sql += ` AND a.project_id = $${params.length}`;
    }
    params.push(limit);
    sql += ` ORDER BY a.created_at DESC LIMIT $${params.length}`;

    const { rows } = await pool.query(sql, params);
    return res.json({
      success: true,
      data: rows.map((r) => ({
        id: r.id,
        projectId: r.project_id,
        projectNombre: r.project_nombre,
        projectCreatorEmail: r.project_creator_email,
        eventType: r.event_type,
        actorId: r.actor_id,
        actorEmail: r.actor_email,
        actorName: r.actor_name,
        prevData: r.prev_data,
        newData: r.new_data,
        ipAddress: r.ip_address,
        createdAt: r.created_at,
      })),
    });
  } catch (err) {
    console.error('[SUPERUSER] audit:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

router.post('/import/preview', upload.single('file'), async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ success: false, error: { code: 'NO_FILE', message: 'Archivo requerido' } });
    }
    const parsed = JSON.parse(req.file.buffer.toString('utf8'));
    const mods = parsed.modules || {};
    return res.json({
      success: true,
      data: {
        version: parsed.version,
        exportedAt: parsed.exportedAt,
        counts: {
          users: (mods.users || []).length,
          employees: (mods.employees || []).length,
          clients: (mods.clients || []).length,
          catalogCategories: (mods.catalogCategories || []).length,
          catalogItems: (mods.catalogItems || []).length,
          projects: (mods.projects || []).length,
          projectItems: (mods.projectItems || []).length,
          projectShares: (mods.projectShares || []).length,
          projectAuditLog: (mods.projectAuditLog || []).length,
        },
      },
    });
  } catch (err) {
    return res.status(400).json({ success: false, error: { code: 'INVALID_JSON', message: err.message } });
  }
});

router.post('/import/apply', upload.single('file'), async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ success: false, error: { code: 'NO_FILE', message: 'Archivo requerido' } });
    }
    const mode = req.body.mode === 'replace' ? 'replace' : 'merge';
    const parsed = JSON.parse(req.file.buffer.toString('utf8'));
    const stats = await importSystemData(parsed, { mode });
    await invalidateCatalogCache().catch(() => {});
    return res.json({ success: true, data: { mode, stats } });
  } catch (err) {
    console.error('[SUPERUSER] import:', err);
    return res.status(400).json({ success: false, error: { code: 'IMPORT_FAILED', message: err.message } });
  }
});

// ─── Explorador de datos (solo lectura + UPDATE, sin DELETE) ────
router.get('/db/tables', async (req, res) => {
  try {
    const tables = await listTables();
    return res.json({ success: true, data: { tables } });
  } catch (err) {
    console.error('[SUPERUSER] db tables:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

router.get('/db/tables/:table/schema', async (req, res) => {
  try {
    const schema = await getTableSchema(req.params.table);
    return res.json({ success: true, data: schema });
  } catch (err) {
    if (err.code === 'TABLE_NOT_ALLOWED') {
      return res.status(400).json({ success: false, error: { code: err.code, message: err.message } });
    }
    console.error('[SUPERUSER] db schema:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

router.get('/db/tables/:table/rows', async (req, res) => {
  try {
    const data = await fetchTableRows(req.params.table, {
      limit: req.query.limit,
      offset: req.query.offset,
      orderBy: req.query.orderBy,
    });
    return res.json({ success: true, data });
  } catch (err) {
    if (err.code === 'TABLE_NOT_ALLOWED') {
      return res.status(400).json({ success: false, error: { code: err.code, message: err.message } });
    }
    console.error('[SUPERUSER] db rows:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

router.put('/db/tables/:table/rows', async (req, res) => {
  try {
    const { primaryKey, updates, confirmPassword } = req.body || {};
    if (!confirmPassword) {
      return res.status(400).json({
        success: false,
        error: { code: 'PASSWORD_REQUIRED', message: 'Confirme su contraseña para modificar datos' },
      });
    }
    const ok = await verifySuperPassword(req.user.id, confirmPassword);
    if (!ok) {
      return res.status(403).json({
        success: false,
        error: { code: 'INVALID_PASSWORD', message: 'Contraseña incorrecta' },
      });
    }
    const row = await updateTableRow(req.params.table, primaryKey || {}, updates || {});
    if (req.params.table === 'catalog_categories' || req.params.table === 'catalog_items') {
      await invalidateCatalogCache();
    }
    return res.json({ success: true, data: { row } });
  } catch (err) {
    if (['TABLE_NOT_ALLOWED', 'READONLY_TABLE', 'NO_PRIMARY_KEY', 'INVALID_PK', 'NO_UPDATES', 'NOT_FOUND'].includes(err.code)) {
      return res.status(400).json({ success: false, error: { code: err.code, message: err.message } });
    }
    console.error('[SUPERUSER] db update:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message || 'Error interno' } });
  }
});

// ─── GET /api/superuser/login-lockouts — cuentas bloqueadas por intentos ─
router.get('/login-lockouts', async (req, res) => {
  try {
    const activeOnly = req.query.all !== 'true';
    const rows = await listLoginLockouts({ activeOnly });
    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error('[SUPERUSER] login-lockouts list:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// ─── POST /api/superuser/login-lockouts/reset — desbloquear cuenta ─
router.post('/login-lockouts/reset', async (req, res) => {
  const { email, userId } = req.body || {};
  try {
    let cleared = false;
    if (userId) {
      cleared = await clearLoginLockoutByUserId(userId);
    } else if (email) {
      cleared = await clearLoginLockout(email);
    } else {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Indique email o userId' },
      });
    }
    if (!cleared) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'No hay bloqueo registrado para esa cuenta' },
      });
    }
    return res.json({
      success: true,
      data: { message: 'Contador de intentos reiniciado. La cuenta puede iniciar sesión.' },
    });
  } catch (err) {
    console.error('[SUPERUSER] login-lockouts reset:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

module.exports = router;
