const express = require('express');
const { body, query, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const { Queue, Worker } = require('bullmq');
const { pool } = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { canReadProject } = require('../utils/projectAccess');
const { processPdfJob } = require('../workers/pdf.worker');
const jobStore = require('../lib/pdfJobsStore');
const pdfService = require('../services/pdf.service');

const router = express.Router();
router.use(requireAuth);

const jobStates = new Map();
/** jobId -> { projectId, userId } para validar descarga */
const jobOwners = new Map();

function redisConn() {
  const u = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
  try {
    const parsed = new URL(u);
    return {
      host: parsed.hostname,
      port: parseInt(parsed.port || '6379', 10),
      password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
      maxRetriesPerRequest: null,
    };
  } catch {
    return { host: '127.0.0.1', port: 6379, maxRetriesPerRequest: null };
  }
}

/** Cola BullMQ solo si hay Redis y no se desactiva con PDF_USE_QUEUE=0|false */
function shouldUsePdfQueue() {
  if (!process.env.REDIS_URL) return false;
  const v = String(process.env.PDF_USE_QUEUE || '').toLowerCase();
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
  return true;
}

function bullmqFailedReason(job) {
  if (!job) return 'Fallo en cola';
  if (job.failedReason && String(job.failedReason).trim()) return String(job.failedReason);
  if (Array.isArray(job.stacktrace) && job.stacktrace[0]) return String(job.stacktrace[0]);
  return 'Fallo en cola';
}

let pdfQueue = null;
let pdfWorker = null;

function getQueue() {
  if (!shouldUsePdfQueue()) return null;
  if (!pdfQueue) {
    try {
      pdfQueue = new Queue('pdf-export', { connection: redisConn() });
    } catch (e) {
      console.warn('[EXPORT] Redis queue:', e.message);
      return null;
    }
  }
  return pdfQueue;
}

function startWorkerIfNeeded() {
  if (!shouldUsePdfQueue() || pdfWorker) return;
  pdfWorker = new Worker(
    'pdf-export',
    async (job) => {
      if (job?.data?.jobId) {
        jobStates.set(job.data.jobId, { state: 'processing' });
      }
      const r = await processPdfJob(job);
      jobStates.set(job.data.jobId, { state: 'completed' });
      return r;
    },
    { connection: redisConn() }
  );
  pdfWorker.on('failed', (job, err) => {
    const jid = job?.data?.jobId;
    if (jid) {
      const msg = err?.message || bullmqFailedReason(job);
      console.error('[EXPORT PDF worker]', jid, msg);
      jobStates.set(jid, { state: 'failed', error: msg });
    }
  });
}

async function loadProjectRow(id) {
  const { rows } = await pool.query(`SELECT * FROM projects WHERE id = $1`, [id]);
  return rows[0] || null;
}

// ─── GET /api/export/pdf/preview-html — HTML mismo layout que el PDF (sin Puppeteer) ─
router.get(
  '/pdf/preview-html',
  requireRole('ADMIN', 'COMERCIAL'),
  query('projectId').isUUID(),
  query('kind').isIn(['GERENCIA', 'CLIENTE']),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: errors.array()[0].msg },
      });
    }

    const { projectId, kind } = req.query;
    const row = await loadProjectRow(projectId);
    if (!row) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Proyecto no encontrado' } });
    }
    if (!canReadProject(req.user, row)) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Acceso denegado' } });
    }
    if (row.deleted_at) {
      return res.status(400).json({ success: false, error: { code: 'DELETED', message: 'Proyecto archivado' } });
    }

    try {
      const payload = await pdfService.loadExportPayload(projectId);
      const html =
        kind === 'CLIENTE'
          ? pdfService.buildHtmlCliente(payload)
          : pdfService.buildHtmlGerencia(payload);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.send(html);
    } catch (e) {
      console.error('[EXPORT preview-html]', e);
      res.status(500).json({
        success: false,
        error: { code: 'PREVIEW_ERROR', message: e.message || 'Error generando vista previa' },
      });
    }
  }
);

// ─── POST /api/export/pdf ──────────────────────────────────────
router.post(
  '/pdf',
  requireRole('ADMIN', 'COMERCIAL'),
  body('projectId').isUUID(),
  body('kind').isIn(['GERENCIA', 'CLIENTE']),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: errors.array()[0].msg },
      });
    }

    const { projectId, kind } = req.body;
    const row = await loadProjectRow(projectId);
    if (!row) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Proyecto no encontrado' } });
    }
    if (!canReadProject(req.user, row)) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Acceso denegado' } });
    }
    if (row.deleted_at) {
      return res.status(400).json({ success: false, error: { code: 'DELETED', message: 'Proyecto archivado' } });
    }

    const jobId = uuidv4();
    jobStates.set(jobId, { state: 'queued' });
    jobOwners.set(jobId, { projectId, userId: req.user.id });

    const payload = { jobId, projectId, kind, userId: req.user.id };

    const runLocal = async () => {
      jobStates.set(jobId, { state: 'processing' });
      try {
        await processPdfJob({ data: payload });
        jobStates.set(jobId, { state: 'completed' });
      } catch (e) {
        console.error('[EXPORT PDF]', e);
        jobStates.set(jobId, { state: 'failed', error: e.message || 'Error generando PDF' });
      }
    };

    const q = getQueue();
    if (q) {
      try {
        await q.add('render', payload, { jobId });
        jobStates.set(jobId, { state: 'queued' });
      } catch (e) {
        console.warn('[EXPORT] Cola Redis, fallback local:', e.message);
        setImmediate(runLocal);
      }
    } else {
      setImmediate(runLocal);
    }

    return res.json({ success: true, data: { jobId } });
  }
);

// ─── GET /api/export/pdf/status/:jobId ─────────────────────────
router.get('/pdf/status/:jobId', async (req, res) => {
  const { jobId } = req.params;
  const own = jobOwners.get(jobId);
  if (!own || (own.userId !== req.user.id && req.user.role !== 'ADMIN')) {
    return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Acceso denegado' } });
  }
  const st = jobStates.get(jobId);
  if (!st) {
    return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Job no encontrado' } });
  }

  const q = getQueue();
  if (q && (st.state === 'queued' || st.state === 'processing')) {
    try {
      const job = await q.getJob(jobId);
      if (job) {
        const state = await job.getState();
        if (state === 'completed') {
          jobStates.set(jobId, { state: 'completed' });
        } else if (state === 'failed') {
          jobStates.set(jobId, { state: 'failed', error: bullmqFailedReason(job) });
        } else if (state === 'active') {
          jobStates.set(jobId, { state: 'processing' });
        }
      }
    } catch {
      /* ignore */
    }
  }

  const latest = jobStates.get(jobId);
  const ready = latest?.state === 'completed' && jobStore.hasResult(jobId);

  return res.json({
    success: true,
    data: {
      state: latest?.state || 'unknown',
      error: latest?.error || null,
      ready,
    },
  });
});

// ─── GET /api/export/pdf/download/:jobId ───────────────────────
router.get('/pdf/download/:jobId', async (req, res) => {
  const { jobId } = req.params;
  const own = jobOwners.get(jobId);
  if (!own) {
    return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Job no encontrado' } });
  }
  if (own.userId !== req.user.id && req.user.role !== 'ADMIN') {
    return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Acceso denegado' } });
  }
  const row = await loadProjectRow(own.projectId);
  if (!row || !canReadProject(req.user, row)) {
    return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Acceso denegado' } });
  }

  const st = jobStates.get(jobId);
  if (!st || st.state !== 'completed') {
    return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'PDF no listo' } });
  }
  const buf = jobStore.takeResult(jobId);
  if (!buf) {
    return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'PDF expirado o ya descargado' } });
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="zgroup-${jobId.slice(0, 8)}.pdf"`);
  jobOwners.delete(jobId);
  jobStates.delete(jobId);
  res.send(buf);
});

module.exports = router;
module.exports.startExportWorker = startWorkerIfNeeded;
module.exports.shouldUsePdfQueue = shouldUsePdfQueue;
