/**
 * Vínculo Odoo guardado en app_settings (clave odoo_connection).
 * La API key no sale en las respuestas. Un campo vacío conserva la clave ya guardada
 * y, si tampoco hay clave en base, se usa ODOO_API_KEY del entorno.
 */

const { pool } = require('../../config/db');
const { loadOdooConfig, setOdooRuntime, isOdooConfigured, normalizeOdooBaseUrl, PULL_INTERVAL_MS } = require('./config');

const SETTINGS_KEY = 'odoo_connection';

function blank(v) {
  return String(v || '').trim();
}

function isMaskedSecret(v) {
  const s = blank(v);
  return !s || /^[•*]+$/.test(s);
}

function maskKey(key) {
  const s = blank(key);
  if (!s) return '';
  if (s.length <= 4) return '••••';
  return `••••${s.slice(-4)}`;
}

function normalizeStored(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return {
    url: blank(raw.url),
    db: blank(raw.db),
    user: blank(raw.user),
    apiKey: blank(raw.apiKey),
    syncEnabled: raw.syncEnabled === true,
  };
}

async function readStoredOdooConnection() {
  try {
    const { rows } = await pool.query(`SELECT value FROM app_settings WHERE key = $1`, [SETTINGS_KEY]);
    return normalizeStored(rows[0]?.value);
  } catch (err) {
    if (err.code === '42P01') return null;
    throw err;
  }
}

function applyStoredRuntime(stored) {
  setOdooRuntime(stored);
  try {
    require('./pullPartners').resetSharedOdooClient();
  } catch (err) {
    console.warn('[ODOO SETTINGS] reset pull client:', err.message);
  }
  try {
    require('./pushPartners').resetSharedOdooClient();
  } catch (err) {
    console.warn('[ODOO SETTINGS] reset push client:', err.message);
  }
}

async function hydrateOdooRuntime() {
  const stored = await readStoredOdooConnection();
  if (stored) applyStoredRuntime(stored);
  else setOdooRuntime(null);
  return stored;
}

function publicOdooSettings(stored, cfg = loadOdooConfig()) {
  const usingDb = cfg.configSource === 'database';
  return {
    url: cfg.url || '',
    db: cfg.db || '',
    user: cfg.user || '',
    apiKeySet: Boolean(cfg.apiKey),
    apiKeyHint: maskKey(cfg.apiKey),
    syncEnabled: Boolean(cfg.syncEnabled),
    intervalMinutes: Math.round((cfg.syncIntervalMs || PULL_INTERVAL_MS) / 60000),
    configSource: usingDb ? 'database' : cfg.url || cfg.db || cfg.user || cfg.apiKey ? 'env' : 'none',
    configured: isOdooConfigured(cfg),
    stored: Boolean(stored),
  };
}

async function getOdooSettingsView() {
  const stored = await readStoredOdooConnection();
  return publicOdooSettings(stored);
}

async function saveOdooConnection(input, actorId) {
  const prev = (await readStoredOdooConnection()) || {
    url: '',
    db: '',
    user: '',
    apiKey: '',
    syncEnabled: false,
  };
  const body = input && typeof input === 'object' ? input : {};
  const urlRaw = body.url != null ? blank(body.url) : prev.url;
  const url = urlRaw ? normalizeOdooBaseUrl(urlRaw) : '';
  const db = body.db != null ? blank(body.db) : prev.db;
  const user = body.user != null ? blank(body.user) : prev.user;
  const apiKey = isMaskedSecret(body.apiKey) ? prev.apiKey : blank(body.apiKey);
  const syncEnabled = body.syncEnabled === true || body.syncEnabled === 'true' || body.syncEnabled === 1;
  const value = { url, db, user, apiKey, syncEnabled };

  await pool.query(
    `INSERT INTO app_settings (key, value, updated_by, updated_at)
     VALUES ($1, $2::jsonb, $3, NOW())
     ON CONFLICT (key) DO UPDATE SET
       value = EXCLUDED.value,
       updated_by = EXCLUDED.updated_by,
       updated_at = NOW()`,
    [SETTINGS_KEY, JSON.stringify(value), actorId || null]
  );
  applyStoredRuntime(value);
  return publicOdooSettings(value);
}

module.exports = {
  SETTINGS_KEY,
  readStoredOdooConnection,
  hydrateOdooRuntime,
  getOdooSettingsView,
  saveOdooConnection,
  publicOdooSettings,
  isMaskedSecret,
};
