const { randomUUID } = require('crypto');
const { pool } = require('../../config/db');
const { createOdooClient } = require('./xmlrpcClient');
const { loadOdooConfig, isOdooConfigured, isOdooWriteAllowed } = require('./config');
const { parseOdooWriteDate, isRemoteWriteNewer, formatOdooWriteDateForUser, maxDate } = require('./pullHelpers');
const { X_ZTRACK_UID_FIELD } = require('./partnerFields');
const { SYNC_MODEL_PARTNER, SYNC_STATUS } = require('./syncStatus');
const { XmlrpcFault } = require('./xmlrpcCodec');
const { CircuitOpenError } = require('./circuitBreaker');
const {
  buildCreateVals,
  buildWriteVals,
  validatePartnerWrite,
  nextAttemptAt,
  shouldRetryFault,
  shouldConsultSunat,
  userMessageFromOdooFault,
  normalizeOdooText,
} = require('./partnerValidate');

const MAX_ATTEMPTS = 8;
const SUNAT_TIMEOUT_MS = 120_000;
const READ_FIELDS = Object.freeze([
  'id',
  'name',
  'vat',
  'write_date',
  X_ZTRACK_UID_FIELD,
  'street',
  'street2',
  'city',
  'zip',
  'state_id',
  'country_id',
  'email',
  'phone',
  'mobile',
  'website',
  'comment',
  'lang',
]);
const SUNAT_READ_FIELDS = Object.freeze([
  ...READ_FIELDS,
  'l10n_pe_district',
  'taxpayer_state',
  'taxpayer_condition',
  'agent_retention',
  'affection_new_rus',
  'agent_perception',
  'hydrocarbon_perception_agent',
  'good_taxpayer',
  'foreign_trade_activity',
]);
const UTC_CTX = Object.freeze({ tz: 'UTC', lang: 'es_PE', active_test: false });

let sharedClient = null;
let pumping = false;

function getClient() {
  if (!sharedClient) sharedClient = createOdooClient();
  return sharedClient;
}

async function loadCategoryClienteId() {
  const { rows } = await pool.query(
    `SELECT category_cliente_id FROM odoo_sync_state WHERE model = $1`,
    [SYNC_MODEL_PARTNER]
  );
  return rows[0]?.category_cliente_id != null ? Number(rows[0].category_cliente_id) : 3;
}

async function resolveRucTypeId(uid, client) {
  try {
    const { result } = await client.executeKw(
      uid,
      'l10n_latam.identification.type',
      'search_read',
      [[['name', 'ilike', 'RUC']]],
      { fields: ['id', 'name'], limit: 5 }
    );
    const rows = Array.isArray(result) ? result : [];
    const exact = rows.find((r) => String(r.name || '').trim().toUpperCase() === 'RUC');
    const id = Number((exact || rows[0] || {}).id);
    return Number.isFinite(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

async function enqueueOutbox({ op, clientId, odooId, xZtrackUid, payload, expectedWriteDate, actorId }) {
  const { rows } = await pool.query(
    `INSERT INTO odoo_outbox (
       op, client_id, odoo_id, x_ztrack_uid, payload, expected_write_date, actor_id, status, next_attempt_at
     ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, 'pendiente', NOW())
     RETURNING *`,
    [
      op,
      clientId,
      odooId || null,
      xZtrackUid,
      JSON.stringify(payload || {}),
      expectedWriteDate || null,
      actorId || null,
    ]
  );
  return rows[0];
}

async function latestOutboxForClient(clientId) {
  const { rows } = await pool.query(
    `SELECT id, op, status, last_error, attempts, created_at, updated_at
       FROM odoo_outbox
      WHERE client_id = $1
      ORDER BY created_at DESC
      LIMIT 1`,
    [clientId]
  );
  return rows[0] || null;
}

async function outboxCounts() {
  const { rows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'pendiente')::int AS pending,
       COUNT(*) FILTER (WHERE status = 'fallido')::int AS failed,
       COUNT(*) FILTER (WHERE status = 'conflicto')::int AS conflict
     FROM odoo_outbox`
  );
  return rows[0] || { pending: 0, failed: 0, conflict: 0 };
}

async function searchByUid(uid, client, xZtrackUid) {
  const { result } = await client.executeKw(
    uid,
    'res.partner',
    'search_read',
    [[[X_ZTRACK_UID_FIELD, '=', String(xZtrackUid)]]],
    { fields: READ_FIELDS, limit: 2, context: UTC_CTX }
  );
  const rows = Array.isArray(result) ? result : [];
  return rows[0] || null;
}

async function readPartner(uid, client, odooId, fields = READ_FIELDS) {
  try {
    const { result } = await client.executeKw(
      uid,
      'res.partner',
      'read',
      [[odooId], fields],
      { context: UTC_CTX }
    );
    const rows = Array.isArray(result) ? result : [];
    return rows[0] || null;
  } catch (err) {
    if (fields !== READ_FIELDS) return readPartner(uid, client, odooId, READ_FIELDS);
    throw err;
  }
}

async function consultSunat(uid, client, odooId) {
  try {
    await client.executeKw(
      uid,
      'res.partner',
      'action_ruc_validation_sunat',
      [[odooId]],
      { context: UTC_CTX },
      { timeoutMs: SUNAT_TIMEOUT_MS, skipCircuit: true }
    );
  } catch (err) {
    console.warn('[ODOO SUNAT]', odooId, err.message || err);
  }
  return readPartnerSafe(uid, client, odooId, null, SUNAT_READ_FIELDS);
}

async function applySunatIfNeeded(uid, client, odooId, payload, partner) {
  if (!odooId || !shouldConsultSunat({ ...(payload || {}), ruc: (payload && payload.ruc) || (partner && partner.vat) })) {
    return partner;
  }
  const filled = await consultSunat(uid, client, odooId);
  return filled || partner;
}

function odooScalar(v) {
  return normalizeOdooText(v);
}

function partnerFieldSnapshot(partner, extraRaw) {
  const raw = extraRaw && typeof extraRaw === 'object' ? extraRaw : {};
  const src = partner || {};
  const street = src.street !== undefined ? src.street : raw.street;
  return {
    name: odooScalar(src.name),
    vat: odooScalar(src.vat),
    street: odooScalar(street),
    city: odooScalar(src.city !== undefined ? src.city : raw.city),
    email: odooScalar(src.email !== undefined ? src.email : raw.email),
    phone: odooScalar(src.phone !== undefined ? src.phone : raw.phone),
    comment: odooScalar(src.comment !== undefined ? src.comment : raw.comment),
  };
}

function snapshotsDiffer(a, b) {
  if (!a || !b) return true;
  return ['name', 'vat', 'street', 'city', 'email', 'phone', 'comment'].some((k) => a[k] !== b[k]);
}

function payloadSnapshot(payload, base) {
  const next = { ...(base || {}) };
  if (!payload) return next;
  if (payload.razonSocial !== undefined) next.name = odooScalar(payload.razonSocial);
  if (payload.ruc !== undefined) next.vat = odooScalar(payload.ruc);
  if (payload.direccion !== undefined) next.street = odooScalar(payload.direccion);
  if (payload.ciudad !== undefined) next.city = odooScalar(payload.ciudad);
  if (payload.contactoEmail !== undefined) next.email = odooScalar(payload.contactoEmail);
  if (payload.contactoTelefono !== undefined) next.phone = odooScalar(payload.contactoTelefono);
  if (payload.notas !== undefined) next.comment = odooScalar(payload.notas);
  return next;
}

async function remoteMatchesPriorOutbox(clientId, currentId, remoteSnap) {
  const { rows } = await pool.query(
    `SELECT payload FROM odoo_outbox
      WHERE client_id = $1 AND id <> $2
      ORDER BY created_at DESC
      LIMIT 8`,
    [clientId, currentId]
  );
  return rows.some((r) => !snapshotsDiffer(remoteSnap, payloadSnapshot(r.payload, remoteSnap)));
}

async function readPartnerSafe(uid, client, odooId, fallback, fields = READ_FIELDS) {
  try {
    return (await readPartner(uid, client, odooId, fields)) || fallback;
  } catch (err) {
    console.warn('[ODOO OUTBOX] read de confirmación omitido:', err.message);
    return fallback;
  }
}

async function finalizePushed(row, partner) {
  const odooId = Number(partner.id);
  const wd = parseOdooWriteDate(partner.write_date) || new Date();
  await upsertLocalFromOdoo(partner, { xZtrackUid: row.x_ztrack_uid, lastPushed: wd });
  if (row.client_id) {
    await pool.query(`UPDATE clients SET x_ztrack_uid = COALESCE(x_ztrack_uid, $2) WHERE id = $1`, [
      row.client_id,
      row.x_ztrack_uid,
    ]);
    await applyRemoteToClient(row.client_id, partner);
  }
  await markOutbox(row.id, {
    status: 'enviado',
    lastError: null,
    odooId,
    attempts: Number(row.attempts) + 1,
  });
  return { ok: true, odooId };
}

async function upsertLocalFromOdoo(partner, { xZtrackUid, lastPushed }) {
  if (!partner || partner.id == null) return;
  const odooId = Number(partner.id);
  const wd = parseOdooWriteDate(partner.write_date);
  await pool.query(
    `INSERT INTO odoo_partners (
       odoo_id, x_ztrack_uid, raw, name, display_name, vat, email, phone, city,
       is_company, active, odoo_write_date, last_pushed_write_date, sync_status, category_ids
     ) VALUES (
       $1, $2, $3::jsonb, $4, $4, $5, $6, $7, $8,
       true, true, $9, $10, $11, '{}'::int[]
     )
     ON CONFLICT (odoo_id) DO UPDATE SET
       x_ztrack_uid = COALESCE(EXCLUDED.x_ztrack_uid, odoo_partners.x_ztrack_uid),
       name = EXCLUDED.name,
       display_name = COALESCE(EXCLUDED.display_name, odoo_partners.display_name),
       vat = EXCLUDED.vat,
       email = EXCLUDED.email,
       phone = EXCLUDED.phone,
       city = EXCLUDED.city,
       raw = odoo_partners.raw || EXCLUDED.raw,
       odoo_write_date = EXCLUDED.odoo_write_date,
       last_pushed_write_date = EXCLUDED.last_pushed_write_date,
       sync_status = 'sincronizado'`,
    [
      odooId,
      xZtrackUid || null,
      JSON.stringify(partner),
      partner.name || null,
      partner.vat && partner.vat !== false ? String(partner.vat) : null,
      partner.email && partner.email !== false ? String(partner.email) : null,
      partner.phone && partner.phone !== false ? String(partner.phone) : null,
      partner.city && partner.city !== false ? String(partner.city) : null,
      wd ? wd.toISOString() : new Date().toISOString(),
      lastPushed ? lastPushed.toISOString() : wd ? wd.toISOString() : null,
      SYNC_STATUS.SINCRONIZADO,
    ]
  );
}

async function markOutbox(id, patch) {
  await pool.query(
    `UPDATE odoo_outbox SET
       status = COALESCE($2, status),
       last_error = $3,
       attempts = COALESCE($4, attempts),
       next_attempt_at = COALESCE($5, next_attempt_at),
       odoo_id = COALESCE($6, odoo_id),
       updated_at = NOW()
     WHERE id = $1`,
    [
      id,
      patch.status || null,
      patch.lastError !== undefined ? patch.lastError : null,
      patch.attempts != null ? patch.attempts : null,
      patch.nextAttemptAt || null,
      patch.odooId != null ? patch.odooId : null,
    ]
  );
}

async function processCreate(row, uid, client) {
  const payload = row.payload || {};
  const categoryClienteId = await loadCategoryClienteId();
  const identificationTypeId = payload.vat || payload.ruc ? await resolveRucTypeId(uid, client) : null;
  const vals = buildCreateVals(
    { ...payload, xZtrackUid: row.x_ztrack_uid },
    { categoryClienteId, identificationTypeId }
  );

  let partner = await searchByUid(uid, client, row.x_ztrack_uid);
  if (!partner) {
    const created = await client.executeKw(uid, 'res.partner', 'create', [vals], { context: UTC_CTX });
    const newId = Number(created.result);
    if (!Number.isFinite(newId) || newId <= 0) {
      throw new Error('Odoo create no devolvió id');
    }
    partner = await readPartnerSafe(uid, client, newId, {
      id: newId,
      name: vals.name,
      vat: vals.vat || false,
      street: vals.street || false,
      city: vals.city || false,
      email: vals.email || false,
      phone: vals.phone || false,
      write_date: new Date().toISOString().slice(0, 19).replace('T', ' '),
    });
  }
  const odooId = Number((partner && partner.id) || 0);
  partner = (await applySunatIfNeeded(uid, client, odooId, payload, partner)) || partner;
  return finalizePushed(row, partner);
}

async function applyRemoteToClient(clientId, partner) {
  if (!clientId || !partner) return;
  const wd = parseOdooWriteDate(partner.write_date);
  const scalar = (v) => (v && v !== false ? String(v) : null);
  await pool.query(
    `UPDATE clients SET
       razon_social = COALESCE($2, razon_social),
       ruc = COALESCE($3, ruc),
       direccion = COALESCE($4, direccion),
       ciudad = COALESCE($5, ciudad),
       contacto_email = COALESCE($6, contacto_email),
       contacto_telefono = COALESCE($7, contacto_telefono),
       odoo_write_date = COALESCE($8, odoo_write_date),
       odoo_id = COALESCE($9, odoo_id),
       sync_origin = CASE WHEN sync_origin = 'local' THEN 'odoo' ELSE sync_origin END,
       updated_at = NOW()
     WHERE id = $1`,
    [
      clientId,
      scalar(partner.name),
      scalar(partner.vat),
      scalar(partner.street),
      scalar(partner.city),
      scalar(partner.email),
      scalar(partner.phone),
      wd ? wd.toISOString() : null,
      partner.id != null ? Number(partner.id) : null,
    ]
  );
}

async function processWrite(row, uid, client) {
  const odooId = Number(row.odoo_id);
  if (!Number.isFinite(odooId) || odooId <= 0) {
    const err = new Error('write sin odoo_id');
    err.code = 'VALIDATION_ERROR';
    throw err;
  }
  const remote = await readPartner(uid, client, odooId);
  if (!remote) {
    const err = new XmlrpcFault(0, 'MissingError: partner no encontrado');
    err.odooErrorKind = 'MissingError';
    throw err;
  }
  const remoteWd = parseOdooWriteDate(remote.write_date);
  const expected = parseOdooWriteDate(row.expected_write_date);
  const { rows: meta } = await pool.query(
    `SELECT last_pushed_write_date, odoo_write_date, name, vat, city, email, phone, raw
       FROM odoo_partners WHERE odoo_id = $1`,
    [odooId]
  );
  const cached = meta[0] || {};
  const lastPushed = parseOdooWriteDate(cached.last_pushed_write_date);
  const cachedWd = parseOdooWriteDate(cached.odoo_write_date);
  const known = maxDate(maxDate(expected, lastPushed), cachedWd);
  const ownEcho =
    lastPushed && remoteWd && Math.abs(remoteWd.getTime() - lastPushed.getTime()) <= 2000;
  const writeDateLooksNewer = isRemoteWriteNewer(remoteWd, known) && !ownEcho;
  const remoteSnap = partnerFieldSnapshot(remote);
  const cacheSnap = partnerFieldSnapshot(cached, cached.raw);
  const intendedSnap = payloadSnapshot(row.payload, cacheSnap);
  const odooChangedData = snapshotsDiffer(remoteSnap, cacheSnap);
  const weWouldOverwriteOdoo = snapshotsDiffer(remoteSnap, intendedSnap);
  if (writeDateLooksNewer && odooChangedData && weWouldOverwriteOdoo) {
    const ownPriorEcho = row.client_id
      ? await remoteMatchesPriorOutbox(row.client_id, row.id, remoteSnap)
      : false;
    if (!ownPriorEcho) {
      await upsertLocalFromOdoo(remote, { xZtrackUid: row.x_ztrack_uid, lastPushed: lastPushed || null });
      await pool.query(`UPDATE odoo_partners SET sync_status = $2 WHERE odoo_id = $1`, [
        odooId,
        SYNC_STATUS.CONFLICTO,
      ]);
      await applyRemoteToClient(row.client_id, remote);
      await markOutbox(row.id, {
        status: 'conflicto',
        lastError: `Odoo cambió el contacto (${formatOdooWriteDateForUser(remote.write_date)}). Gana Odoo; no se fusionó.`,
        attempts: Number(row.attempts) + 1,
        odooId,
      });
      return { ok: false, conflict: true };
    }
  }

  const alreadyApplied = !snapshotsDiffer(remoteSnap, payloadSnapshot(row.payload, remoteSnap));
  const wantSunat = shouldConsultSunat({ ...(row.payload || {}), ruc: (row.payload && row.payload.ruc) || remote.vat });
  if (alreadyApplied && !wantSunat) {
    return finalizePushed(row, remote);
  }

  const vals = buildWriteVals(row.payload || {});
  if (!alreadyApplied && Object.keys(vals).length) {
    await client.executeKw(uid, 'res.partner', 'write', [[odooId], vals], { context: UTC_CTX });
  }
  const fallback = {
    ...remote,
    name: vals.name !== undefined ? vals.name : remote.name,
    vat: vals.vat !== undefined ? vals.vat : remote.vat,
    street: vals.street !== undefined ? vals.street : remote.street,
    city: vals.city !== undefined ? vals.city : remote.city,
    email: vals.email !== undefined ? vals.email : remote.email,
    phone: vals.phone !== undefined ? vals.phone : remote.phone,
    comment: vals.comment !== undefined ? vals.comment : remote.comment,
  };
  const after = alreadyApplied
    ? remote
    : await readPartnerSafe(uid, client, odooId, fallback);
  const filled = await applySunatIfNeeded(uid, client, odooId, row.payload || {}, after || fallback);
  return finalizePushed(row, filled || after || fallback);
}

async function processOne(row) {
  const cfg = loadOdooConfig();
  if (!isOdooConfigured(cfg)) {
    throw new Error('Odoo no configurado');
  }
  const gate = isOdooWriteAllowed(cfg);
  if (!gate.ok) {
    const err = new Error(gate.message);
    err.code = gate.code;
    throw err;
  }
  const client = getClient();
  const { uid } = await client.authenticate();
  if (row.op === 'create') return processCreate(row, uid, client);
  if (row.op === 'write') return processWrite(row, uid, client);
  throw new Error(`op desconocida ${row.op}`);
}

async function processOutboxBatch(limit = 10) {
  if (pumping) return { skipped: 'busy' };
  pumping = true;
  const results = [];
  try {
    const snap = getClient().circuitSnapshot();
    if (snap.open) {
      return { processed: 0, skipped: 'circuit_open', remainingMs: snap.remainingMs };
    }
    await pool.query(
      `UPDATE odoo_outbox o
          SET status = 'enviado',
              last_error = 'Reemplazado por una edición posterior',
              updated_at = NOW()
        WHERE o.status = 'pendiente' AND o.op = 'write'
          AND EXISTS (
            SELECT 1 FROM odoo_outbox n
             WHERE n.client_id IS NOT NULL
               AND n.client_id = o.client_id
               AND n.op = 'write'
               AND n.status = 'pendiente'
               AND n.created_at > o.created_at
          )`
    );
    const { rows } = await pool.query(
      `WITH due AS (
         SELECT id FROM odoo_outbox
          WHERE status = 'pendiente' AND next_attempt_at <= NOW()
          ORDER BY created_at ASC
          LIMIT $1
          FOR UPDATE SKIP LOCKED
       )
       UPDATE odoo_outbox o
          SET next_attempt_at = NOW() + interval '10 minutes',
              updated_at = NOW()
         FROM due
        WHERE o.id = due.id
       RETURNING o.*`,
      [limit]
    );
    for (const row of rows) {
      const attempts = Number(row.attempts) + 1;
      try {
        const r = await processOne(row);
        results.push({ id: row.id, ...r });
      } catch (err) {
        const kind = err instanceof XmlrpcFault ? err.odooErrorKind : err.code;
        const msg =
          err instanceof XmlrpcFault || err instanceof CircuitOpenError
            ? userMessageFromOdooFault(err)
            : err.message || 'Error al enviar a Odoo';
        if (err instanceof CircuitOpenError) {
          await markOutbox(row.id, {
            status: 'pendiente',
            lastError: msg,
            attempts: Number(row.attempts),
            nextAttemptAt: new Date(err.openUntil || Date.now() + 15_000),
          });
          results.push({ id: row.id, ok: false, error: msg, retry: true });
          break;
        }
        const retryable = attempts < MAX_ATTEMPTS && shouldRetryFault(kind);
        await markOutbox(row.id, {
          status: retryable ? 'pendiente' : 'fallido',
          lastError: msg,
          attempts,
          nextAttemptAt: retryable ? nextAttemptAt(attempts) : new Date(),
        });
        console.error('[ODOO OUTBOX]', row.op, row.id, msg);
        results.push({ id: row.id, ok: false, error: msg, retry: retryable });
      }
    }
    return { processed: rows.length, results };
  } finally {
    pumping = false;
  }
}

function kickOutbox() {
  setImmediate(() => {
    processOutboxBatch().catch((err) => console.error('[ODOO OUTBOX]', err.message));
  });
}

async function enqueueCreate({ clientId, payload, actorId }) {
  const checked = validatePartnerWrite(payload);
  if (!checked.ok) {
    const err = new Error(checked.errors[0]);
    err.code = 'VALIDATION_ERROR';
    err.details = checked.errors;
    throw err;
  }
  const xZtrackUid = payload.xZtrackUid || randomUUID();
  const row = await enqueueOutbox({
    op: 'create',
    clientId,
    xZtrackUid,
    payload: { ...payload, xZtrackUid, consultarSunat: shouldConsultSunat(payload) },
    actorId,
  });
  kickOutbox();
  return row;
}

async function enqueueWrite({ clientId, odooId, xZtrackUid, payload, expectedWriteDate, actorId }) {
  if (payload.razonSocial != null || payload.ruc != null || payload.contactoEmail != null) {
    const checked = validatePartnerWrite({
      razonSocial: payload.razonSocial != null ? payload.razonSocial : 'ok',
      ruc: payload.ruc,
      contactoEmail: payload.contactoEmail,
    });
    if (!checked.ok) {
      const err = new Error(checked.errors[0]);
      err.code = 'VALIDATION_ERROR';
      err.details = checked.errors;
      throw err;
    }
  }
  if (clientId) {
    const { rows: pending } = await pool.query(
      `SELECT id, payload FROM odoo_outbox
        WHERE client_id = $1 AND op = 'write' AND status = 'pendiente'
        ORDER BY created_at DESC LIMIT 1`,
      [clientId]
    );
    if (pending[0]) {
      const merged = { ...(pending[0].payload || {}), ...payload };
      await pool.query(
        `UPDATE odoo_outbox SET payload = $2::jsonb, expected_write_date = COALESCE($3, expected_write_date),
                next_attempt_at = NOW(), last_error = NULL, updated_at = NOW()
          WHERE id = $1`,
        [pending[0].id, JSON.stringify(merged), expectedWriteDate || null]
      );
      kickOutbox();
      return { id: pending[0].id, merged: true };
    }
  }
  const row = await enqueueOutbox({
    op: 'write',
    clientId,
    odooId,
    xZtrackUid: xZtrackUid || randomUUID(),
    payload,
    expectedWriteDate,
    actorId,
  });
  kickOutbox();
  return row;
}

module.exports = {
  enqueueCreate,
  enqueueWrite,
  processOutboxBatch,
  kickOutbox,
  latestOutboxForClient,
  outboxCounts,
  MAX_ATTEMPTS,
};
