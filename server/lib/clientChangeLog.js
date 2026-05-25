const { pool } = require('../config/db');

const FIELD_LABELS = {
  razon_social: 'Razón social',
  ruc: 'RUC',
  contacto_nombre: 'Contacto',
  contacto_email: 'Email contacto',
  contacto_telefono: 'Teléfono',
  direccion: 'Dirección',
  ciudad: 'Ciudad',
  notas: 'Notas',
  active: 'Estado',
};

function formatFieldValue(field, value) {
  if (value == null || value === '') return '—';
  if (field === 'active') {
    return value === 'true' || value === true ? 'Activo' : 'Archivado';
  }
  return String(value);
}

function diffRow(before, after, field, toStr = (v) => (v == null ? null : String(v))) {
  const oldV = toStr(before[field]);
  const newV = toStr(after[field]);
  if (oldV === newV) return null;
  return { field, oldValue: oldV, newValue: newV };
}

async function logClientChanges(
  { clientId, clientLabel, actorId, changeSource = 'DIRECT', changes = [] },
  client = null
) {
  const q = client ? client.query.bind(client) : pool.query.bind(pool);
  for (const ch of changes) {
    if (!ch || ch.oldValue === ch.newValue) continue;
    await q(
      `INSERT INTO client_change_log
        (client_id, client_label, field_name, old_value, new_value, change_source, actor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        clientId,
        clientLabel || null,
        ch.field,
        ch.oldValue ?? null,
        ch.newValue ?? null,
        changeSource,
        actorId,
      ]
    );
  }
}

async function logClientCreate(row, actorId, changeSource = 'DIRECT', client = null) {
  const label = row.razon_social;
  const changes = [
    'razon_social',
    'ruc',
    'contacto_nombre',
    'contacto_email',
    'contacto_telefono',
    'direccion',
    'ciudad',
    'notas',
  ]
    .filter((f) => row[f] != null && row[f] !== '')
    .map((f) => ({ field: f, oldValue: null, newValue: String(row[f]) }));
  changes.push({ field: 'active', oldValue: null, newValue: 'true' });
  await logClientChanges({ clientId: row.id, clientLabel: label, actorId, changeSource, changes }, client);
}

function clientUpdateChanges(before, after) {
  const pairs = [
    ['razon_social', (v) => String(v).trim()],
    ['ruc', (v) => (v == null ? null : String(v))],
    ['contacto_nombre', (v) => (v == null ? null : String(v))],
    ['contacto_email', (v) => (v == null ? null : String(v))],
    ['contacto_telefono', (v) => (v == null ? null : String(v))],
    ['direccion', (v) => (v == null ? null : String(v))],
    ['ciudad', (v) => (v == null ? null : String(v))],
    ['notas', (v) => (v == null ? null : String(v))],
    ['active', (v) => String(Boolean(v))],
  ];
  const changes = [];
  for (const [field, fmt] of pairs) {
    if (after[field] === undefined) continue;
    const d = diffRow(before, after, field, fmt);
    if (d) changes.push(d);
  }
  return changes;
}

async function fetchClientHistory(clientId) {
  const { rows } = await pool.query(
    `SELECT l.*, u.email AS actor_email,
            TRIM(CONCAT(e.nombres, ' ', e.apellidos)) AS actor_name
     FROM client_change_log l
     LEFT JOIN users u ON u.id = l.actor_id
     LEFT JOIN employees e ON e.user_id = l.actor_id
     WHERE l.client_id = $1
     ORDER BY l.created_at ASC`,
    [clientId]
  );

  const timeline = rows.map((r) => ({
    id: r.id,
    field: r.field_name,
    fieldLabel: FIELD_LABELS[r.field_name] || r.field_name,
    oldValue: r.old_value,
    newValue: r.new_value,
    oldDisplay: formatFieldValue(r.field_name, r.old_value),
    newDisplay: formatFieldValue(r.field_name, r.new_value),
    changeSource: r.change_source,
    actorId: r.actor_id,
    actorEmail: r.actor_email,
    actorName: r.actor_name || r.actor_email,
    createdAt: r.created_at,
  }));

  const byField = {};
  for (const entry of timeline) {
    if (!byField[entry.field]) byField[entry.field] = [];
    byField[entry.field].push(entry);
  }

  return {
    clientId,
    clientLabel: rows[0]?.client_label || null,
    timeline,
    byField: Object.entries(byField).map(([field, entries]) => ({
      field,
      fieldLabel: FIELD_LABELS[field] || field,
      entries,
    })),
  };
}

module.exports = {
  FIELD_LABELS,
  formatFieldValue,
  logClientChanges,
  logClientCreate,
  clientUpdateChanges,
  fetchClientHistory,
};
