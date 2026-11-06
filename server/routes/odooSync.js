const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { loadOdooConfig, isOdooConfigured } = require('../lib/odoo/config');
const { createOdooClient } = require('../lib/odoo/xmlrpcClient');
const { getOdooSettingsView, saveOdooConnection, readStoredOdooConnection, isMaskedSecret } = require('../lib/odoo/settingsStore');
const { getSyncHealth, runIncrementalPull, runReconcileDeletes } = require('../lib/odoo/pullPartners');
const { projectEligibleClients, linkLocalClientsByRuc, projectionCounts } = require('../lib/odoo/projectClients');
const { CircuitOpenError } = require('../lib/odoo/circuitBreaker');
const { XmlrpcFault } = require('../lib/odoo/xmlrpcCodec');

const router = express.Router();
router.use(requireAuth);
router.use(requireRole('SUPERUSER'));

function mapErr(err) {
  if (err instanceof CircuitOpenError) {
    return { code: 'ODOO_CIRCUIT_OPEN', message: err.message, status: 503 };
  }
  if (err instanceof XmlrpcFault) {
    return { code: err.odooErrorKind || 'ODOO_FAULT', message: err.message.split('\n')[0], status: 502 };
  }
  return { code: 'ODOO_SYNC_ERROR', message: err.message || 'Error de sincronización', status: 500 };
}

router.get('/settings', async (req, res) => {
  try {
    const data = await getOdooSettingsView();
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[ODOO SYNC] settings get:', err);
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'No se pudo leer la configuración de Odoo' },
    });
  }
});

router.put('/settings', async (req, res) => {
  try {
    const data = await saveOdooConnection(req.body || {}, req.user.id);
    const { restartOdooPullScheduler } = require('../workers/odooSync.worker');
    restartOdooPullScheduler();
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[ODOO SYNC] settings put:', err);
    const badUrl = /ODOO_URL inválida/i.test(err.message || '');
    return res.status(badUrl ? 400 : 500).json({
      success: false,
      error: {
        code: badUrl ? 'ODOO_URL_INVALID' : 'SERVER_ERROR',
        message: badUrl ? err.message : 'No se pudo guardar la configuración de Odoo',
      },
    });
  }
});

router.post('/settings/test', async (req, res) => {
  try {
    const body = req.body || {};
    const stored = await readStoredOdooConnection();
    const current = loadOdooConfig();
    const apiKey = isMaskedSecret(body.apiKey) ? stored?.apiKey || current.apiKey : String(body.apiKey).trim();
    const cfg = loadOdooConfig({
      ODOO_URL: body.url != null ? String(body.url) : current.url,
      ODOO_DB: body.db != null ? String(body.db) : current.db,
      ODOO_USER: body.user != null ? String(body.user) : current.user,
      ODOO_API_KEY: apiKey,
      ODOO_TIMEOUT_MS: String(current.timeoutMs || 20000),
      ODOO_TLS_INSECURE: current.tlsInsecure ? '1' : '0',
    });
    if (!isOdooConfigured(cfg)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'ODOO_NOT_CONFIGURED',
          message: 'Indique URL, base de datos, usuario y clave API',
        },
      });
    }
    const client = createOdooClient(cfg);
    const ver = await client.version();
    const auth = await client.authenticate();
    const serverVersion =
      ver && ver.version && typeof ver.version === 'object' ? ver.version.server_version || null : null;
    return res.json({
      success: true,
      data: {
        ok: true,
        uid: auth.uid,
        serverVersion,
        host: cfg.url,
      },
    });
  } catch (err) {
    console.error('[ODOO SYNC] settings test:', err.message);
    const m = mapErr(err);
    return res.status(m.status).json({ success: false, error: { code: m.code, message: m.message } });
  }
});

router.get('/health', async (req, res) => {
  try {
    const data = await getSyncHealth();
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[ODOO SYNC] health:', err);
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'No se pudo leer el estado de sync' },
    });
  }
});

router.post('/partners', async (req, res) => {
  if (!isOdooConfigured(loadOdooConfig())) {
    return res.status(400).json({
      success: false,
      error: { code: 'ODOO_NOT_CONFIGURED', message: 'Faltan ODOO_URL / ODOO_DB / ODOO_USER / ODOO_API_KEY' },
    });
  }
  const force = req.body && req.body.force === true;
  const holder = `http-${req.user.id}`;
  setImmediate(() => {
    runIncrementalPull({ force, holder }).catch((err) => {
      console.error('[ODOO SYNC] pull async:', err.message);
    });
  });
  const health = await getSyncHealth();
  return res.json({
    success: true,
    data: {
      accepted: true,
      message: 'Sincronización encolada. Actualice el estado en unos segundos.',
      health,
    },
  });
});

router.post('/partners/reconcile', async (req, res) => {
  if (!isOdooConfigured(loadOdooConfig())) {
    return res.status(400).json({
      success: false,
      error: { code: 'ODOO_NOT_CONFIGURED', message: 'Odoo no configurado' },
    });
  }
  try {
    const data = await runReconcileDeletes({ holder: `http-reconcile-${req.user.id}` });
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[ODOO SYNC] reconcile:', err);
    const m = mapErr(err);
    return res.status(m.status).json({ success: false, error: { code: m.code, message: m.message } });
  }
});

router.post('/project-clients', async (req, res) => {
  try {
    const data = await projectEligibleClients();
    const health = await getSyncHealth();
    return res.json({ success: true, data: { ...data, health } });
  } catch (err) {
    console.error('[ODOO SYNC] project-clients:', err);
    return res.status(500).json({
      success: false,
      error: { code: 'PROJECT_ERROR', message: err.message || 'No se pudo proyectar a CRM' },
    });
  }
});

router.get('/clients-link', async (req, res) => {
  try {
    const report = await linkLocalClientsByRuc({ apply: false });
    const counts = await projectionCounts();
    return res.json({ success: true, data: { ...report, counts } });
  } catch (err) {
    console.error('[ODOO SYNC] clients-link:', err);
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'No se pudo leer el informe de RUC' },
    });
  }
});

module.exports = router;
