const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { loadOdooConfig, isOdooConfigured } = require('../lib/odoo/config');
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
