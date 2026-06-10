const { pool } = require('../config/db');

const LOGIN_RATE_LIMIT_MAX = Math.max(1, parseInt(process.env.LOGIN_RATE_LIMIT_MAX || '5', 10) || 5);
const LOGIN_RATE_LIMIT_WINDOW_MS = Math.max(
  60_000,
  parseInt(process.env.LOGIN_RATE_LIMIT_WINDOW_MS || String(15 * 60 * 1000), 10) || 15 * 60 * 1000
);

function normalizeLoginEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

function isLockoutDisabled() {
  return process.env.NODE_ENV === 'test' || process.env.DISABLE_LOGIN_LOCKOUT === '1';
}

function formatLockMessage(retryAfterMs) {
  const mins = Math.max(1, Math.ceil(retryAfterMs / 60_000));
  return `Demasiados intentos para esta cuenta. Espera ${mins} minuto${mins === 1 ? '' : 's'} antes de reintentar.`;
}

/**
 * @returns {Promise<{ locked: boolean, retryAfterMs?: number, failedCount?: number, message?: string }>}
 */
async function checkLoginLockout(email) {
  if (isLockoutDisabled()) return { locked: false };

  const norm = normalizeLoginEmail(email);
  if (!norm) return { locked: false };

  const { rows } = await pool.query(
    `SELECT failed_count, locked_until FROM login_lockouts WHERE email_normalized = $1`,
    [norm]
  );
  const row = rows[0];
  if (!row?.locked_until) return { locked: false, failedCount: row?.failed_count || 0 };

  const lockedUntil = new Date(row.locked_until);
  if (lockedUntil <= new Date()) {
    await pool.query(
      `UPDATE login_lockouts
       SET failed_count = 0, locked_until = NULL, updated_at = NOW()
       WHERE email_normalized = $1`,
      [norm]
    );
    return { locked: false, failedCount: 0 };
  }

  const retryAfterMs = lockedUntil.getTime() - Date.now();
  return {
    locked: true,
    retryAfterMs,
    failedCount: row.failed_count,
    message: formatLockMessage(retryAfterMs),
  };
}

async function recordFailedLogin(email, userId = null) {
  if (isLockoutDisabled()) return { locked: false };

  const norm = normalizeLoginEmail(email);
  if (!norm) return { locked: false };

  const { rows } = await pool.query(
    `INSERT INTO login_lockouts (email_normalized, user_id, failed_count, last_attempt_at, updated_at)
     VALUES ($1, $2, 1, NOW(), NOW())
     ON CONFLICT (email_normalized) DO UPDATE SET
       user_id = COALESCE(EXCLUDED.user_id, login_lockouts.user_id),
       failed_count = CASE
         WHEN login_lockouts.locked_until IS NOT NULL AND login_lockouts.locked_until <= NOW() THEN 1
         ELSE login_lockouts.failed_count + 1
       END,
       locked_until = CASE
         WHEN login_lockouts.locked_until IS NOT NULL AND login_lockouts.locked_until <= NOW() THEN NULL
         ELSE login_lockouts.locked_until
       END,
       last_attempt_at = NOW(),
       updated_at = NOW()
     RETURNING failed_count, locked_until`,
    [norm, userId]
  );

  let failedCount = rows[0]?.failed_count || 1;
  let lockedUntil = rows[0]?.locked_until ? new Date(rows[0].locked_until) : null;

  if (failedCount >= LOGIN_RATE_LIMIT_MAX) {
    lockedUntil = new Date(Date.now() + LOGIN_RATE_LIMIT_WINDOW_MS);
    await pool.query(
      `UPDATE login_lockouts
       SET locked_until = $2, updated_at = NOW()
       WHERE email_normalized = $1`,
      [norm, lockedUntil]
    );
    const retryAfterMs = LOGIN_RATE_LIMIT_WINDOW_MS;
    return {
      locked: true,
      retryAfterMs,
      failedCount,
      message: formatLockMessage(retryAfterMs),
    };
  }

  return { locked: false, failedCount };
}

async function clearLoginLockout(email) {
  const norm = normalizeLoginEmail(email);
  if (!norm) return false;
  const { rowCount } = await pool.query(`DELETE FROM login_lockouts WHERE email_normalized = $1`, [norm]);
  return rowCount > 0;
}

async function clearLoginLockoutByUserId(userId) {
  if (!userId) return false;
  const { rows } = await pool.query(`SELECT email FROM users WHERE id = $1`, [userId]);
  if (!rows[0]?.email) return false;
  return clearLoginLockout(rows[0].email);
}

async function listLoginLockouts({ activeOnly = true } = {}) {
  let sql = `
    SELECT l.email_normalized, l.user_id, l.failed_count, l.locked_until, l.last_attempt_at, l.updated_at,
           u.email AS user_email, u.role,
           TRIM(CONCAT(e.nombres, ' ', e.apellidos)) AS user_nombre
    FROM login_lockouts l
    LEFT JOIN users u ON u.id = l.user_id
    LEFT JOIN employees e ON e.user_id = u.id`;
  if (activeOnly) {
    sql += ` WHERE l.locked_until IS NOT NULL AND l.locked_until > NOW()`;
  } else {
    sql += ` WHERE l.failed_count > 0 OR l.locked_until IS NOT NULL`;
  }
  sql += ` ORDER BY l.locked_until DESC NULLS LAST, l.last_attempt_at DESC`;

  const { rows } = await pool.query(sql);
  return rows.map((r) => ({
    email: r.email_normalized,
    userId: r.user_id,
    userEmail: r.user_email || r.email_normalized,
    userNombre: r.user_nombre || null,
    role: r.role || null,
    failedCount: r.failed_count,
    lockedUntil: r.locked_until,
    lastAttemptAt: r.last_attempt_at,
    updatedAt: r.updated_at,
    isLocked: r.locked_until != null && new Date(r.locked_until) > new Date(),
  }));
}

module.exports = {
  LOGIN_RATE_LIMIT_MAX,
  LOGIN_RATE_LIMIT_WINDOW_MS,
  normalizeLoginEmail,
  checkLoginLockout,
  recordFailedLogin,
  clearLoginLockout,
  clearLoginLockoutByUserId,
  listLoginLockouts,
  formatLockMessage,
};
