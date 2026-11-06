/**
 * Scheduler pull Odoo (5 min) + reconciliación diaria + bomba del outbox (etapa 5).
 * El cron de pull corre si la config efectiva (pantalla o ODOO_SYNC_ENABLED) está activa.
 * El outbox de create/write corre igual (pruebas en staging con cron OFF).
 */

const { loadOdooConfig, isOdooConfigured } = require('../lib/odoo/config');
const { runIncrementalPull, runReconcileDeletes } = require('../lib/odoo/pullPartners');
const { processOutboxBatch } = require('../lib/odoo/pushPartners');

const RECONCILE_CHECK_MS = 30 * 60 * 1000;
const OUTBOX_EVERY_MS = 5 * 1000;

let pullTimer = null;
let reconcileTimer = null;
let outboxTimer = null;
let pullKickTimer = null;
let lastReconcileDay = null;
let running = false;

function limaYmd(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function limaHour(d = new Date()) {
  return Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'America/Lima',
      hour: '2-digit',
      hour12: false,
    }).format(d)
  );
}

async function safePull(reason) {
  if (running) {
    console.log(`[ODOO SYNC] omitido (${reason}): ya hay un job`);
    return;
  }
  running = true;
  try {
    console.log(`[ODOO SYNC] pull start (${reason})`);
    const r = await runIncrementalPull({ holder: `cron-pull-${reason}` });
    console.log('[ODOO SYNC] pull end', r.skipped || `${r.fetched || 0} fetched`);
  } catch (err) {
    console.error('[ODOO SYNC] pull error:', err.message);
  } finally {
    running = false;
  }
}

async function safeReconcile() {
  const day = limaYmd();
  const hour = limaHour();
  if (hour < 5 || lastReconcileDay === day) return;
  try {
    console.log('[ODOO SYNC] reconcile start');
    const r = await runReconcileDeletes({ holder: 'cron-reconcile' });
    lastReconcileDay = day;
    console.log('[ODOO SYNC] reconcile end', r);
  } catch (err) {
    console.error('[ODOO SYNC] reconcile error:', err.message);
  }
}

async function safeOutbox() {
  const cfg = loadOdooConfig();
  if (!isOdooConfigured(cfg)) return;
  try {
    const r = await processOutboxBatch();
    if (r && r.processed) {
      console.log('[ODOO OUTBOX]', r.processed, 'fila(s)');
    }
  } catch (err) {
    console.error('[ODOO OUTBOX]', err.message);
  }
}

function startOutboxPump() {
  if (outboxTimer) return;
  outboxTimer = setInterval(() => safeOutbox(), OUTBOX_EVERY_MS);
  if (outboxTimer.unref) outboxTimer.unref();
  setTimeout(() => safeOutbox(), 2 * 1000);
}

function armPullSchedule(reason) {
  if (pullTimer) clearInterval(pullTimer);
  if (reconcileTimer) clearInterval(reconcileTimer);
  if (pullKickTimer) clearTimeout(pullKickTimer);
  pullTimer = null;
  reconcileTimer = null;
  pullKickTimer = null;

  const cfg = loadOdooConfig();
  if (!cfg.syncEnabled || !isOdooConfigured(cfg)) {
    const why = !isOdooConfigured(cfg) ? 'Odoo sin vínculo' : 'sync apagada';
    console.log(
      `[ODOO SYNC] cron desactivado (${why}, ${reason}). Outbox de escritura sí corre. Configure el vínculo en Superusuario o use POST /api/odoo/sync/partners.`
    );
    return { started: false, outbox: true, configured: isOdooConfigured(cfg) };
  }

  const every = cfg.syncIntervalMs || 5 * 60 * 1000;
  pullTimer = setInterval(() => safePull('interval-5m'), every);
  if (pullTimer.unref) pullTimer.unref();
  reconcileTimer = setInterval(() => safeReconcile(), RECONCILE_CHECK_MS);
  if (reconcileTimer.unref) reconcileTimer.unref();

  const delay = reason === 'startup' ? 15 * 1000 : 2 * 1000;
  pullKickTimer = setTimeout(() => safePull(reason), delay);
  if (pullKickTimer.unref) pullKickTimer.unref();
  console.log(`[ODOO SYNC] cron cada ${Math.round(every / 60000)} min + reconcile ≥05:00 America/Lima (${reason})`);
  return { started: true, intervalMs: every };
}

function startOdooSyncScheduler() {
  startOutboxPump();
  return armPullSchedule('startup');
}

function restartOdooPullScheduler() {
  return armPullSchedule('settings');
}

function stopOdooSyncScheduler() {
  if (pullTimer) clearInterval(pullTimer);
  if (reconcileTimer) clearInterval(reconcileTimer);
  if (outboxTimer) clearInterval(outboxTimer);
  if (pullKickTimer) clearTimeout(pullKickTimer);
  pullTimer = null;
  reconcileTimer = null;
  outboxTimer = null;
  pullKickTimer = null;
}

module.exports = {
  startOdooSyncScheduler,
  restartOdooPullScheduler,
  stopOdooSyncScheduler,
  safePull,
  safeOutbox,
};
