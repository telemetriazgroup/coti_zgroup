/**
 * Scheduler pull Odoo (15 min) + reconciliación diaria + bomba del outbox (etapa 5).
 * El cron de pull solo corre si ODOO_SYNC_ENABLED=1.
 * El outbox de create/write corre igual (pruebas en staging con cron OFF).
 */

const { loadOdooConfig, isOdooConfigured } = require('../lib/odoo/config');
const { runIncrementalPull, runReconcileDeletes } = require('../lib/odoo/pullPartners');
const { processOutboxBatch } = require('../lib/odoo/pushPartners');

const PULL_EVERY_MS = 15 * 60 * 1000;
const RECONCILE_CHECK_MS = 30 * 60 * 1000;
const OUTBOX_EVERY_MS = 5 * 1000;

let pullTimer = null;
let reconcileTimer = null;
let outboxTimer = null;
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

function startOdooSyncScheduler() {
  startOutboxPump();
  const cfg = loadOdooConfig();
  if (!cfg.syncEnabled) {
    console.log('[ODOO SYNC] cron desactivado (ODOO_SYNC_ENABLED=0). Outbox de escritura sí corre. Use POST /api/odoo/sync/partners a mano para el pull.');
    return { started: false, outbox: true };
  }
  if (pullTimer) return { started: true, already: true };

  pullTimer = setInterval(() => safePull('interval-15m'), PULL_EVERY_MS);
  if (pullTimer.unref) pullTimer.unref();
  reconcileTimer = setInterval(() => safeReconcile(), RECONCILE_CHECK_MS);
  if (reconcileTimer.unref) reconcileTimer.unref();

  setTimeout(() => safePull('startup'), 15 * 1000);
  console.log('[ODOO SYNC] cron cada 15 min + reconcile ≥05:00 America/Lima');
  return { started: true };
}

function stopOdooSyncScheduler() {
  if (pullTimer) clearInterval(pullTimer);
  if (reconcileTimer) clearInterval(reconcileTimer);
  if (outboxTimer) clearInterval(outboxTimer);
  pullTimer = null;
  reconcileTimer = null;
  outboxTimer = null;
}

module.exports = { startOdooSyncScheduler, stopOdooSyncScheduler, safePull, safeOutbox };
