const { pool } = require('../config/db');
const { normalizeBool } = require('./catalogNormalize');

/** Tablas consultables por superusuario (sin DELETE en API). */
const ALLOWED_TABLES = [
  'users',
  'admin_commercial_assignments',
  'employees',
  'clients',
  'projects',
  'project_shares',
  'catalog_categories',
  'catalog_items',
  'catalog_item_dependencies',
  'measure_units',
  'catalog_item_requests',
  'catalog_change_log',
  'project_items',
  'project_plans',
  'project_budget_snapshots',
  'project_audit_log',
  'refresh_tokens',
];

/** Tablas solo lectura (auditoría / tokens). */
const READONLY_TABLES = new Set(['catalog_change_log', 'project_audit_log', 'refresh_tokens']);

const BLOCKED_UPDATE_COLUMNS = {
  users: new Set(['password_hash']),
  refresh_tokens: new Set(['token_hash']),
};

function assertAllowedTable(tableName) {
  if (!ALLOWED_TABLES.includes(tableName)) {
    const err = new Error('Tabla no permitida');
    err.code = 'TABLE_NOT_ALLOWED';
    throw err;
  }
}

async function listTables() {
  const out = [];
  for (const name of ALLOWED_TABLES) {
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM ${name}`);
    out.push({
      name,
      rowCount: rows[0]?.n ?? 0,
      readOnly: READONLY_TABLES.has(name),
    });
  }
  return out;
}

async function getTableSchema(tableName) {
  assertAllowedTable(tableName);
  const { rows: cols } = await pool.query(
    `SELECT column_name, data_type, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [tableName]
  );
  const { rows: pk } = await pool.query(
    `SELECT kcu.column_name
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
     WHERE tc.table_schema = 'public' AND tc.table_name = $1 AND tc.constraint_type = 'PRIMARY KEY'
     ORDER BY kcu.ordinal_position`,
    [tableName]
  );
  const primaryKey = pk.map((r) => r.column_name);
  const blocked = BLOCKED_UPDATE_COLUMNS[tableName] || new Set();
  return {
    table: tableName,
    readOnly: READONLY_TABLES.has(tableName),
    primaryKey,
    columns: cols.map((c) => ({
      name: c.column_name,
      dataType: c.data_type,
      nullable: c.is_nullable === 'YES',
      default: c.column_default,
      editable: !READONLY_TABLES.has(tableName) && !primaryKey.includes(c.column_name) && !blocked.has(c.column_name),
    })),
  };
}

async function fetchTableRows(tableName, { limit = 50, offset = 0, orderBy = null } = {}) {
  assertAllowedTable(tableName);
  const schema = await getTableSchema(tableName);
  const lim = Math.min(200, Math.max(1, Number(limit) || 50));
  const off = Math.max(0, Number(offset) || 0);
  let orderClause = '';
  if (orderBy && schema.columns.some((c) => c.name === orderBy)) {
    orderClause = ` ORDER BY "${orderBy}" ASC`;
  } else if (schema.primaryKey[0]) {
    orderClause = ` ORDER BY "${schema.primaryKey[0]}" ASC`;
  }
  const { rows } = await pool.query(
    `SELECT * FROM ${tableName}${orderClause} LIMIT $1 OFFSET $2`,
    [lim, off]
  );
  const { rows: cnt } = await pool.query(`SELECT COUNT(*)::int AS n FROM ${tableName}`);
  return {
    rows,
    total: cnt[0]?.n ?? 0,
    limit: lim,
    offset: off,
  };
}

async function updateTableRow(tableName, primaryKeyValues, updates) {
  assertAllowedTable(tableName);
  if (READONLY_TABLES.has(tableName)) {
    const err = new Error('Tabla de solo lectura');
    err.code = 'READONLY_TABLE';
    throw err;
  }
  const schema = await getTableSchema(tableName);
  if (!schema.primaryKey.length) {
    const err = new Error('Tabla sin clave primaria');
    err.code = 'NO_PRIMARY_KEY';
    throw err;
  }
  for (const pk of schema.primaryKey) {
    if (primaryKeyValues[pk] == null || primaryKeyValues[pk] === '') {
      const err = new Error(`Clave primaria incompleta: ${pk}`);
      err.code = 'INVALID_PK';
      throw err;
    }
  }

  const blocked = BLOCKED_UPDATE_COLUMNS[tableName] || new Set();
  const editable = new Set(schema.columns.filter((c) => c.editable).map((c) => c.name));
  const colTypes = new Map(schema.columns.map((c) => [c.name, c.dataType]));
  const fields = [];
  const vals = [];
  let i = 1;
  for (const [key, val] of Object.entries(updates || {})) {
    if (!editable.has(key) || blocked.has(key)) continue;
    let v = val === '' ? null : val;
    if (colTypes.get(key) === 'boolean') {
      v = normalizeBool(v, true);
    }
    fields.push(`"${key}" = $${i++}`);
    vals.push(v);
  }
  if (fields.length === 0) {
    const err = new Error('Sin campos editables para actualizar');
    err.code = 'NO_UPDATES';
    throw err;
  }

  const where = schema.primaryKey.map((pk) => `"${pk}" = $${i++}`).join(' AND ');
  for (const pk of schema.primaryKey) {
    vals.push(primaryKeyValues[pk]);
  }

  const sql = `UPDATE ${tableName} SET ${fields.join(', ')} WHERE ${where} RETURNING *`;
  const { rows } = await pool.query(sql, vals);
  if (!rows[0]) {
    const err = new Error('Registro no encontrado');
    err.code = 'NOT_FOUND';
    throw err;
  }
  return rows[0];
}

module.exports = {
  ALLOWED_TABLES,
  listTables,
  getTableSchema,
  fetchTableRows,
  updateTableRow,
};
