const { pool } = require('../../config/db');
const { LOCK_KEY_PARTNERS } = require('./syncStatus');
const { LOCK_TTL_MS } = require('./pullHelpers');

async function tryAcquireLock(lockKey = LOCK_KEY_PARTNERS, holder, ttlMs = LOCK_TTL_MS) {
  const { rows } = await pool.query(
    `INSERT INTO odoo_sync_locks (lock_key, holder, expires_at)
     VALUES ($1, $2, NOW() + ($3::int * INTERVAL '1 millisecond'))
     ON CONFLICT (lock_key) DO UPDATE
       SET holder = EXCLUDED.holder,
           expires_at = EXCLUDED.expires_at
       WHERE odoo_sync_locks.expires_at < NOW()
     RETURNING lock_key, holder, expires_at`,
    [lockKey, holder, ttlMs]
  );
  return rows[0] || null;
}

async function releaseLock(lockKey, holder) {
  await pool.query(`DELETE FROM odoo_sync_locks WHERE lock_key = $1 AND holder = $2`, [lockKey, holder]);
}

async function readLock(lockKey = LOCK_KEY_PARTNERS) {
  const { rows } = await pool.query(
    `SELECT lock_key, holder, expires_at FROM odoo_sync_locks WHERE lock_key = $1`,
    [lockKey]
  );
  const row = rows[0];
  if (!row) return { held: false };
  const held = new Date(row.expires_at).getTime() > Date.now();
  return { held, holder: row.holder, expiresAt: row.expires_at };
}

module.exports = { tryAcquireLock, releaseLock, readLock };
