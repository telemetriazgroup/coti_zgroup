const { pool } = require('../config/db');
const { resolveAuditActorId } = require('./requestContext');

const FIELD_LABELS = {
  nombre: 'Nombre',
  descripcion: 'Descripción / nombre',
  unit_price: 'Precio unitario (USD)',
  codigo: 'Código',
  unidad: 'Unidad',
  tipo: 'Tipo',
  category_id: 'Categoría',
  sort_order: 'Orden',
  active: 'Estado activo',
  default_apply_adjustment: 'Ajuste M1 por defecto',
};

function formatFieldValue(field, value) {
  if (value == null || value === '') return '—';
  if (field === 'unit_price') {
    const n = Number(value);
    return Number.isNaN(n) ? String(value) : n.toFixed(2);
  }
  if (field === 'active') return value === 'true' || value === true ? 'Activo' : 'Inactivo';
  if (field === 'default_apply_adjustment') {
    return value === 'true' || value === true ? 'Activo (aplica margen/descuento)' : 'Inactivo (exento M1)';
  }
  return String(value);
}

function diffRow(before, after, field, toStr = (v) => (v == null ? null : String(v))) {
  const oldV = toStr(before[field]);
  const newV = toStr(after[field]);
  if (oldV === newV) return null;
  return { field, oldValue: oldV, newValue: newV };
}

async function logCatalogChanges(
  {
    entityType,
    entityId,
    entityLabel,
    actorId,
    changeSource = 'DIRECT',
    requestId = null,
    changes = [],
  },
  client = null
) {
  const q = client ? client.query.bind(client) : pool.query.bind(pool);
  for (const ch of changes) {
    if (!ch || ch.oldValue === ch.newValue) continue;
    await q(
      `INSERT INTO catalog_change_log
        (entity_type, entity_id, entity_label, field_name, old_value, new_value, change_source, actor_id, request_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        entityType,
        entityId,
        entityLabel || null,
        ch.field,
        ch.oldValue ?? null,
        ch.newValue ?? null,
        changeSource,
        resolveAuditActorId(actorId),
        requestId,
      ]
    );
  }
}

async function logItemCreate(itemRow, actorId, changeSource = 'DIRECT', requestId = null, client = null) {
  const label = itemRow.codigo;
  const changes = [
    { field: 'codigo', oldValue: null, newValue: itemRow.codigo },
    { field: 'descripcion', oldValue: null, newValue: itemRow.descripcion },
    { field: 'unit_price', oldValue: null, newValue: String(itemRow.unit_price) },
    { field: 'unidad', oldValue: null, newValue: itemRow.unidad },
    { field: 'tipo', oldValue: null, newValue: itemRow.tipo },
    { field: 'category_id', oldValue: null, newValue: String(itemRow.category_id) },
  ];
  await logCatalogChanges(
    {
      entityType: 'ITEM',
      entityId: itemRow.id,
      entityLabel: label,
      actorId,
      changeSource,
      requestId,
      changes,
    },
    client
  );
}

function itemUpdateChanges(before, after) {
  const pairs = [
    ['category_id', (v) => String(v)],
    ['codigo', (v) => String(v).trim()],
    ['descripcion', (v) => String(v).trim()],
    ['unidad', (v) => String(v)],
    ['tipo', (v) => String(v)],
    ['unit_price', (v) => String(v)],
    ['sort_order', (v) => String(v)],
    ['active', (v) => String(v)],
  ];
  const changes = [];
  for (const [field, fmt] of pairs) {
    if (after[field] === undefined) continue;
    const d = diffRow(before, after, field, fmt);
    if (d) changes.push(d);
  }
  return changes;
}

function categoryUpdateChanges(before, after) {
  const changes = [];
  for (const field of ['nombre', 'sort_order', 'active', 'default_apply_adjustment']) {
    if (after[field] === undefined) continue;
    const d = diffRow(before, after, field, (v) => (field === 'nombre' ? String(v).trim() : String(v)));
    if (d) changes.push(d);
  }
  return changes;
}

async function fetchCatalogHistory(entityType, entityId) {
  const { rows } = await pool.query(
    `SELECT l.*, u.email AS actor_email,
            TRIM(CONCAT(e.nombres, ' ', e.apellidos)) AS actor_name
     FROM catalog_change_log l
     LEFT JOIN users u ON u.id = l.actor_id
     LEFT JOIN employees e ON e.user_id = l.actor_id
     WHERE l.entity_type = $1 AND l.entity_id = $2
     ORDER BY l.created_at ASC`,
    [entityType, entityId]
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
    requestId: r.request_id,
    createdAt: r.created_at,
  }));

  const byField = {};
  for (const entry of timeline) {
    if (!byField[entry.field]) byField[entry.field] = [];
    byField[entry.field].push(entry);
  }

  return {
    entityType,
    entityId,
    entityLabel: rows[0]?.entity_label || null,
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
  logCatalogChanges,
  logItemCreate,
  itemUpdateChanges,
  categoryUpdateChanges,
  fetchCatalogHistory,
};
