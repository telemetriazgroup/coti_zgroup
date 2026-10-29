const { pool } = require('../config/db');

const SETTINGS_KEY = 'finance_defaults';

function sanitizeDefaults(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return { ...raw };
}

async function getFinanceDefaults() {
  try {
    const { rows } = await pool.query(`SELECT value FROM app_settings WHERE key = $1`, [SETTINGS_KEY]);
    if (rows[0]?.value && typeof rows[0].value === 'object') {
      return sanitizeDefaults(rows[0].value);
    }
  } catch (err) {
    if (err.code !== '42P01') throw err;
  }
  return {};
}

async function saveFinanceDefaults(params, actorId) {
  const value = sanitizeDefaults(params);
  await pool.query(
    `INSERT INTO app_settings (key, value, updated_by, updated_at)
     VALUES ($1, $2::jsonb, $3, NOW())
     ON CONFLICT (key) DO UPDATE SET
       value = EXCLUDED.value,
       updated_by = EXCLUDED.updated_by,
       updated_at = NOW()`,
    [SETTINGS_KEY, JSON.stringify(value), actorId || null]
  );
  return value;
}

module.exports = {
  SETTINGS_KEY,
  getFinanceDefaults,
  saveFinanceDefaults,
  sanitizeDefaults,
};
