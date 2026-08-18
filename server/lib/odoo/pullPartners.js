/**
 * Pull incremental de res.partner → odoo_partners.
 * No llama a Odoo en el request HTTP: el worker / POST encola este job.
 */

const { pool } = require('../../config/db');
const { createOdooClient } = require('./xmlrpcClient');
const { loadOdooConfig, isOdooConfigured } = require('./config');
const { normalizePartner } = require('./normalizePartner');
const { PARTNER_FIELDS, PARTNER_FIELDS_OPTIONAL_PE } = require('./partnerFields');
const { SYNC_MODEL_PARTNER, SYNC_STATUS, mapSyncStateRow } = require('./syncStatus');
const { tryAcquireLock, releaseLock } = require('./syncLock');
const { projectEligibleClients, projectionCounts } = require('./projectClients');
const {
  BATCH_SIZE,
  toOdooNaiveUtc,
  parseOdooWriteDate,
  overlapWatermark,
  shouldSkipEcho,
  maxDate,
  isDebounced,
} = require('./pullHelpers');

const SEARCH_CONTEXT = Object.freeze({
  active_test: false,
  bin_size: true,
  lang: 'es_PE',
});

const SEARCH_FIELDS = [...PARTNER_FIELDS, ...PARTNER_FIELDS_OPTIONAL_PE];

let sharedClient = null;

function getClient() {
  if (!sharedClient) sharedClient = createOdooClient();
  return sharedClient;
}

async function loadSyncState() {
  const { rows } = await pool.query(`SELECT * FROM odoo_sync_state WHERE model = $1`, [SYNC_MODEL_PARTNER]);
  return rows[0] || null;
}

async function saveSyncState(patch) {
  await pool.query(
    `UPDATE odoo_sync_state SET
       watermark = COALESCE($2, watermark),
       last_run_at = COALESCE($3, last_run_at),
       last_ok_at = COALESCE($4, last_ok_at),
       duration_ms = COALESCE($5, duration_ms),
       created_n = COALESCE($6, created_n),
       updated_n = COALESCE($7, updated_n),
       error_n = COALESCE($8, error_n),
       last_error = $9
     WHERE model = $1`,
    [
      SYNC_MODEL_PARTNER,
      patch.watermark || null,
      patch.lastRunAt || null,
      patch.lastOkAt || null,
      patch.durationMs != null ? patch.durationMs : null,
      patch.createdN != null ? patch.createdN : null,
      patch.updatedN != null ? patch.updatedN : null,
      patch.errorN != null ? patch.errorN : null,
      patch.lastError !== undefined ? patch.lastError : null,
    ]
  );
}

function rowFromNormalized(norm, raw) {
  const writeDate = parseOdooWriteDate(raw.write_date) || (norm.writeDate ? new Date(norm.writeDate) : null);
  return {
    odooId: norm.odooId,
    name: norm.name,
    displayName: norm.displayName,
    vat: norm.vat,
    email: norm.email,
    phone: norm.phone,
    mobile: norm.mobile,
    city: norm.city,
    isCompany: norm.isCompany,
    parentOdooId: norm.parent ? norm.parent.id : null,
    type: norm.type,
    active: norm.active,
    customerRank: norm.customerRank,
    supplierRank: norm.supplierRank,
    categoryIds: norm.categoryIds,
    writeDate,
    raw,
  };
}

async function upsertBatch(rows, echoById) {
  let created = 0;
  let updated = 0;
  let skippedEcho = 0;
  for (const row of rows) {
    if (!row.odooId || !row.writeDate) continue;
    const pushed = echoById.get(row.odooId);
    if (shouldSkipEcho(row.writeDate, pushed)) {
      skippedEcho += 1;
      continue;
    }
    const existed = echoById.has(`id:${row.odooId}`);
    await pool.query(
      `INSERT INTO odoo_partners (
         odoo_id, raw, name, display_name, vat, email, phone, mobile, city,
         is_company, parent_odoo_id, type, active, customer_rank, supplier_rank,
         category_ids, odoo_write_date, sync_status
       ) VALUES (
         $1, $2::jsonb, $3, $4, $5, $6, $7, $8, $9,
         $10, $11, $12, $13, $14, $15,
         $16::int[], $17, $18
       )
       ON CONFLICT (odoo_id) DO UPDATE SET
         raw = EXCLUDED.raw,
         name = EXCLUDED.name,
         display_name = EXCLUDED.display_name,
         vat = EXCLUDED.vat,
         email = EXCLUDED.email,
         phone = EXCLUDED.phone,
         mobile = EXCLUDED.mobile,
         city = EXCLUDED.city,
         is_company = EXCLUDED.is_company,
         parent_odoo_id = EXCLUDED.parent_odoo_id,
         type = EXCLUDED.type,
         active = EXCLUDED.active,
         customer_rank = EXCLUDED.customer_rank,
         supplier_rank = EXCLUDED.supplier_rank,
         category_ids = EXCLUDED.category_ids,
         odoo_write_date = EXCLUDED.odoo_write_date,
         sync_status = CASE
           WHEN odoo_partners.sync_status = 'borrado_en_odoo' THEN 'sincronizado'
           ELSE 'sincronizado'
         END`,
      [
        row.odooId,
        JSON.stringify(row.raw),
        row.name,
        row.displayName,
        row.vat,
        row.email,
        row.phone,
        row.mobile,
        row.city,
        row.isCompany,
        row.parentOdooId,
        row.type,
        row.active,
        row.customerRank,
        row.supplierRank,
        row.categoryIds,
        row.writeDate.toISOString(),
        SYNC_STATUS.SINCRONIZADO,
      ]
    );
    if (existed) updated += 1;
    else created += 1;
  }
  return { created, updated, skippedEcho };
}

async function loadExistingMeta(ids) {
  const echoById = new Map();
  if (!ids.length) return echoById;
  const { rows } = await pool.query(
    `SELECT odoo_id, last_pushed_write_date FROM odoo_partners WHERE odoo_id = ANY($1::int[])`,
    [ids]
  );
  for (const r of rows) {
    echoById.set(r.odoo_id, r.last_pushed_write_date);
    echoById.set(`id:${r.odoo_id}`, true);
  }
  return echoById;
}

/**
 * @param {{ force?: boolean, holder?: string }} opts
 */
async function runIncrementalPull(opts = {}) {
  const cfg = loadOdooConfig();
  if (!isOdooConfigured(cfg)) {
    return { ok: false, skipped: 'not_configured', message: 'Odoo no configurado' };
  }

  const state = await loadSyncState();
  if (!opts.force && isDebounced(state?.last_run_at)) {
    return { ok: true, skipped: 'debounce', message: 'Sync reciente (< 60s)', state: mapSyncStateRow(state) };
  }

  const holder = opts.holder || `pull-${process.pid}-${Date.now()}`;
  const lock = await tryAcquireLock(undefined, holder);
  if (!lock) {
    return { ok: false, skipped: 'locked', message: 'Hay una sincronización en curso' };
  }

  const started = Date.now();
  let createdN = 0;
  let updatedN = 0;
  let skippedEcho = 0;
  let batches = 0;
  let fetched = 0;
  let maxWd = state?.watermark ? new Date(state.watermark) : null;

  try {
    await saveSyncState({ lastRunAt: new Date(), lastError: null });

    const client = getClient();
    const { uid } = await client.authenticate();
    const since = overlapWatermark(state?.watermark);
    const domain = [['write_date', '>=', toOdooNaiveUtc(since)]];

    let offset = 0;
    for (;;) {
      const { result } = await client.executeKw(uid, 'res.partner', 'search_read', [domain], {
        fields: SEARCH_FIELDS,
        limit: BATCH_SIZE,
        offset,
        order: 'write_date asc, id asc',
        context: SEARCH_CONTEXT,
      });
      const lote = Array.isArray(result) ? result : [];
      batches += 1;
      if (!lote.length) break;

      const ids = lote.map((r) => Number(r.id)).filter((id) => Number.isFinite(id));
      const echoById = await loadExistingMeta(ids);
      const mapped = [];
      for (const raw of lote) {
        const norm = normalizePartner(raw);
        const row = rowFromNormalized(norm, raw);
        if (row.writeDate) maxWd = maxDate(maxWd, row.writeDate);
        mapped.push(row);
      }
      const stats = await upsertBatch(mapped, echoById);
      createdN += stats.created;
      updatedN += stats.updated;
      skippedEcho += stats.skippedEcho;
      fetched += lote.length;

      console.log(
        `[ODOO PULL] lote ${batches} offset=${offset} n=${lote.length} created=${stats.created} updated=${stats.updated}`
      );

      offset += lote.length;
      if (lote.length < BATCH_SIZE) break;
    }

    const durationMs = Date.now() - started;
    await saveSyncState({
      watermark: maxWd,
      lastRunAt: new Date(),
      lastOkAt: new Date(),
      durationMs,
      createdN,
      updatedN,
      errorN: 0,
      lastError: null,
    });

    let projection = null;
    try {
      projection = await projectEligibleClients();
      console.log(
        `[ODOO PROJECT] upserted=${projection.upserted} deactivated=${projection.deactivated} linked=${projection.link?.linked || 0} ambiguous=${projection.link?.ambiguousN || 0}`
      );
    } catch (projErr) {
      console.error('[ODOO PROJECT]', projErr.message);
      projection = { ok: false, error: projErr.message };
    }

    return {
      ok: true,
      createdN,
      updatedN,
      skippedEcho,
      fetched,
      batches,
      durationMs,
      watermark: maxWd ? maxWd.toISOString() : null,
      projection,
    };
  } catch (err) {
    const durationMs = Date.now() - started;
    const prevErrors = Number(state?.error_n) || 0;
    await saveSyncState({
      lastRunAt: new Date(),
      durationMs,
      errorN: prevErrors + 1,
      lastError: err.message || String(err),
    });
    throw err;
  } finally {
    await releaseLock('sync_partners', holder);
  }
}

async function runReconcileDeletes(opts = {}) {
  const cfg = loadOdooConfig();
  if (!isOdooConfigured(cfg)) {
    return { ok: false, skipped: 'not_configured' };
  }
  const holder = opts.holder || `reconcile-${process.pid}-${Date.now()}`;
  const lock = await tryAcquireLock('reconcile_partners', holder, 10 * 60 * 1000);
  if (!lock) return { ok: false, skipped: 'locked' };

  try {
    const client = getClient();
    const { uid } = await client.authenticate();
    const { result } = await client.executeKw(uid, 'res.partner', 'search', [[]], {
      context: { active_test: false },
    });
    const ids = Array.isArray(result) ? result.map(Number).filter((n) => Number.isFinite(n)) : [];
    if (!ids.length) {
      return { ok: true, marked: 0, odooCount: 0 };
    }
    const { rowCount } = await pool.query(
      `UPDATE odoo_partners
       SET sync_status = $2
       WHERE odoo_id <> ALL($1::int[])
         AND sync_status IS DISTINCT FROM $2`,
      [ids, SYNC_STATUS.BORRADO_EN_ODOO]
    );
    console.log(`[ODOO RECONCILE] odoo_ids=${ids.length} marcados_borrados=${rowCount}`);
    return { ok: true, marked: rowCount, odooCount: ids.length };
  } finally {
    await releaseLock('reconcile_partners', holder);
  }
}

async function partnerCounts() {
  const { rows } = await pool.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE sync_status = 'borrado_en_odoo')::int AS deleted,
       COUNT(*) FILTER (WHERE active)::int AS active
     FROM odoo_partners`
  );
  return rows[0] || { total: 0, deleted: 0, active: 0 };
}

async function getSyncHealth() {
  const cfg = loadOdooConfig();
  const state = mapSyncStateRow(await loadSyncState());
  const counts = await partnerCounts();
  const crm = await projectionCounts();
  const client = isOdooConfigured(cfg) ? getClient() : null;
  const circuit = client ? client.circuitSnapshot() : null;
  let watermarkAgeMs = null;
  if (state?.lastOkAt) {
    watermarkAgeMs = Date.now() - new Date(state.lastOkAt).getTime();
  }
  return {
    configured: isOdooConfigured(cfg),
    syncEnabled: Boolean(cfg.syncEnabled),
    https: Boolean(cfg.url && cfg.url.startsWith('https://')),
    urlHost: cfg.url ? new URL(cfg.url).host : null,
    circuit,
    state,
    counts: {
      total: counts.total,
      active: counts.active,
      deletedInOdoo: counts.deleted,
    },
    crm: {
      odoo: Number(crm.odoo_n) || 0,
      linked: Number(crm.linked_n) || 0,
      local: Number(crm.local_n) || 0,
      total: Number(crm.total) || 0,
    },
    watermarkAgeMs,
    stale: watermarkAgeMs != null && watermarkAgeMs > 45 * 60 * 1000,
  };
}

module.exports = {
  runIncrementalPull,
  runReconcileDeletes,
  getSyncHealth,
  loadSyncState,
  getClient,
};
