const express = require('express');
const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logAuditEvent } = require('../middleware/audit');
const { getClientIp } = require('../utils/ip');
const { canReadProject, canWriteProject } = require('../utils/projectAccess');
const storage = require('../services/storage.service');

const router = express.Router();
router.use(requireAuth);

const ALLOWED_EXT = new Set(['pdf', 'dwg', 'dxf', 'png', 'jpg', 'jpeg', 'svg']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 25 },
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname || '').replace(/^\./, '').toLowerCase();
    if (!ext || !ALLOWED_EXT.has(ext)) {
      return cb(new Error('Formato no permitido (PDF, DWG, DXF, PNG, JPG, JPEG, SVG)'));
    }
    cb(null, true);
  },
});

function mapPlan(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    nombreOriginal: row.nombre_original,
    s3Key: row.s3_key,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes != null ? Number(row.size_bytes) : null,
    version: row.version,
    isCurrent: row.is_current,
    uploadedBy: row.uploaded_by,
    uploadedByEmail: row.uploaded_by_email || null,
    uploadedAt: row.uploaded_at,
    notasRevision: row.notas_revision,
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

function safeBasename(name) {
  const b = path.basename(name || 'file').replace(/[/\\]/g, '_');
  return b.slice(0, 200) || 'file';
}

// ─── GET /api/projects/:id/plans ───────────────────────────────
router.get('/:id/plans', async (req, res) => {
  try {
    const project = await loadProject(req, res, req.params.id);
    if (!project) return;

    const viewer = req.user.role === 'VIEWER';
    const sql = viewer
      ? `SELECT p.*, u.email AS uploaded_by_email
         FROM project_plans p
         LEFT JOIN users u ON u.id = p.uploaded_by
         WHERE p.project_id = $1 AND p.is_current = true
         ORDER BY p.nombre_original ASC`
      : `SELECT p.*, u.email AS uploaded_by_email
         FROM project_plans p
         LEFT JOIN users u ON u.id = p.uploaded_by
         WHERE p.project_id = $1
         ORDER BY p.nombre_original ASC, p.version DESC`;

    const { rows } = await pool.query(sql, [req.params.id]);
    const plans = rows.map(mapPlan);

    const { rows: cc } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM project_plans WHERE project_id = $1 AND is_current = true`,
      [req.params.id]
    );
    const countCurrent = cc[0].n;

    res.json({
      success: true,
      data: {
        plans,
        count: countCurrent,
        countVersions: viewer ? countCurrent : rows.length,
      },
    });
  } catch (err) {
    console.error('[PLANS] list:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

function runUpload(req, res, next) {
  upload.array('files', 25)(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Archivo supera 25MB' : err.message || 'Error de subida';
      return res.status(400).json({ success: false, error: { code: 'UPLOAD_ERROR', message: msg } });
    }
    next();
  });
}

// ─── POST /api/projects/:id/plans ──────────────────────────────
router.post('/:id/plans', requireRole('ADMIN', 'COMERCIAL'), runUpload, async (req, res) => {
  if (!storage.isStorageConfigured()) {
    return res.status(503).json({
      success: false,
      error: { code: 'STORAGE_UNAVAILABLE', message: 'Almacenamiento no configurado (S3_ENDPOINT)' },
    });
  }

  try {
    const project = await loadProject(req, res, req.params.id);
    if (!project) return;
    if (!canWriteProject(req.user, project)) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Acceso denegado' } });
    }

    const files = req.files || [];
    if (!files.length) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Sin archivos' } });
    }

    const notasRevision = (req.body && String(req.body.notasRevision || '').trim()) || null;
    const created = [];
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      for (const file of files) {
        const nombreOriginal = safeBasename(file.originalname);
        const mimeType = file.mimetype || 'application/octet-stream';

        const { rows: verRows } = await client.query(
          `SELECT COALESCE(MAX(version), 0) AS mv FROM project_plans WHERE project_id = $1 AND nombre_original = $2`,
          [req.params.id, nombreOriginal]
        );
        const nextVer = Number(verRows[0].mv) + 1;

        await client.query(
          `UPDATE project_plans SET is_current = false WHERE project_id = $1 AND nombre_original = $2`,
          [req.params.id, nombreOriginal]
        );

        const fileId = uuidv4();
        const s3Key = `${req.params.id}/${fileId}/${nombreOriginal}`;

        await storage.uploadObject(s3Key, file.buffer, mimeType);

        const { rows: ins } = await client.query(
          `INSERT INTO project_plans
            (project_id, nombre_original, s3_key, s3_bucket, mime_type, size_bytes, version, is_current, uploaded_by, notas_revision)
           VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, $9)
           RETURNING *`,
          [
            req.params.id,
            nombreOriginal,
            s3Key,
            process.env.S3_BUCKET || 'zgroup-plans',
            mimeType,
            file.size,
            nextVer,
            req.user.id,
            notasRevision,
          ]
        );

        const row = ins[0];
        const { rows: urow } = await client.query(`SELECT email FROM users WHERE id = $1`, [req.user.id]);
        row.uploaded_by_email = urow[0]?.email || null;
        created.push(mapPlan(row));
      }

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    for (const p of created) {
      logAuditEvent({
        projectId: req.params.id,
        eventType: 'PLAN_UPLOAD',
        actorId: req.user.id,
        newData: { planId: p.id, nombreOriginal: p.nombreOriginal, version: p.version },
        ip: getClientIp(req),
      });
    }

    res.status(201).json({ success: true, data: { plans: created } });
  } catch (err) {
    console.error('[PLANS] upload:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// ─── GET /api/projects/:id/plans/:planId/preview ───────────────
router.get('/:id/plans/:planId/preview', async (req, res) => {
  if (!storage.isStorageConfigured()) {
    return res.status(503).json({
      success: false,
      error: { code: 'STORAGE_UNAVAILABLE', message: 'Almacenamiento no configurado' },
    });
  }

  try {
    const project = await loadProject(req, res, req.params.id);
    if (!project) return;

    const { rows } = await pool.query(`SELECT * FROM project_plans WHERE id = $1 AND project_id = $2`, [
      req.params.planId,
      req.params.id,
    ]);
    if (!rows[0]) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Plano no encontrado' } });
    }
    const plan = rows[0];

    if (req.user.role === 'VIEWER' && !plan.is_current) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Solo versión actual' } });
    }

    const url = await storage.getSignedGetUrl(plan.s3_key, 900);
    res.json({
      success: true,
      data: { url, expiresIn: 900, mimeType: plan.mime_type, nombreOriginal: plan.nombre_original },
    });
  } catch (err) {
    console.error('[PLANS] preview:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// ─── DELETE /api/projects/:id/plans/:planId ──────────────────
router.delete('/:id/plans/:planId', requireRole('ADMIN', 'COMERCIAL'), async (req, res) => {
  if (!storage.isStorageConfigured()) {
    return res.status(503).json({
      success: false,
      error: { code: 'STORAGE_UNAVAILABLE', message: 'Almacenamiento no configurado' },
    });
  }

  try {
    const project = await loadProject(req, res, req.params.id);
    if (!project) return;
    if (!canWriteProject(req.user, project)) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Acceso denegado' } });
    }

    const { rows } = await pool.query(`SELECT * FROM project_plans WHERE id = $1 AND project_id = $2`, [
      req.params.planId,
      req.params.id,
    ]);
    if (!rows[0]) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Plano no encontrado' } });
    }
    const plan = rows[0];
    const nombreOriginal = plan.nombre_original;
    const wasCurrent = plan.is_current;

    await storage.deleteObject(plan.s3_key);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM project_plans WHERE id = $1`, [plan.id]);

      if (wasCurrent) {
        const { rows: rest } = await client.query(
          `SELECT id FROM project_plans WHERE project_id = $1 AND nombre_original = $2 ORDER BY version DESC LIMIT 1`,
          [req.params.id, nombreOriginal]
        );
        if (rest[0]) {
          await client.query(`UPDATE project_plans SET is_current = true WHERE id = $1`, [rest[0].id]);
        }
      }

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    logAuditEvent({
      projectId: req.params.id,
      eventType: 'PLAN_DELETE',
      actorId: req.user.id,
      prevData: { planId: plan.id, nombreOriginal, version: plan.version },
      ip: getClientIp(req),
    });

    res.json({ success: true, data: { deleted: true } });
  } catch (err) {
    console.error('[PLANS] delete:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

module.exports = router;
