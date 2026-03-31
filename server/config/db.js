const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME     || 'zgroup_cotizaciones',
  user:     process.env.DB_USER     || 'zgroup_user',
  password: process.env.DB_PASSWORD || '',
  max:      10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected client error:', err.message);
});

/**
 * Auto-inicializa el schema si las tablas no existen.
 * Lee schema.sql y lo ejecuta de forma idempotente.
 */
async function initSchema() {
  const fs = require('fs');
  const path = require('path');
  const schemaPath = path.join(__dirname, 'schema.sql');

  try {
    const sql = fs.readFileSync(schemaPath, 'utf8');
    await pool.query(sql);
    console.log('[DB] Schema initialized');
  } catch (err) {
    // Ignorar errores de "already exists" — son normales en re-runs
    if (!err.message.includes('already exists')) {
      console.error('[DB] Schema init error:', err.message);
      throw err;
    }
  }
}

/**
 * Helper para transacciones.
 * @param {Function} fn - async (client) => result
 */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, initSchema, withTransaction };
