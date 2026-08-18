/**
 * Configuración de conexión a Odoo 17 (etapa 0).
 * ODOO_SYNC_ENABLED debe quedar en 0 hasta la etapa 3 (worker de pull).
 */

function envFlag(name, fallback = false) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase());
}

function normalizeOdooBaseUrl(raw) {
  const trimmed = String(raw || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`ODOO_URL inválida: ${raw}`);
  }
  if (url.pathname === '/' || url.pathname === '') {
    return `${url.protocol}//${url.host}`;
  }
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`;
}

function loadOdooConfig(env = process.env) {
  const urlRaw = (env.ODOO_URL || '').trim();
  let url = '';
  if (urlRaw) {
    url = normalizeOdooBaseUrl(urlRaw);
  }
  const timeoutMs = Number.parseInt(env.ODOO_TIMEOUT_MS || '20000', 10);
  return {
    url,
    db: (env.ODOO_DB || '').trim(),
    user: (env.ODOO_USER || '').trim(),
    apiKey: (env.ODOO_API_KEY || '').trim(),
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 20000,
    tlsInsecure: envFlag('ODOO_TLS_INSECURE', false),
    syncEnabled: envFlag('ODOO_SYNC_ENABLED', false),
    failureThreshold: Number.parseInt(env.ODOO_CIRCUIT_FAILURES || '5', 10) || 5,
    cooldownMs: Number.parseInt(env.ODOO_CIRCUIT_COOLDOWN_MS || String(10 * 60 * 1000), 10) || 10 * 60 * 1000,
  };
}

function isOdooConfigured(cfg = loadOdooConfig()) {
  return Boolean(cfg.url && cfg.db && cfg.user && cfg.apiKey);
}

function odooUsesHttps(cfg = loadOdooConfig()) {
  return Boolean(cfg.url && cfg.url.startsWith('https://'));
}

function xmlrpcEndpoint(cfg, kind) {
  const path = kind === 'common' ? '/xmlrpc/2/common' : '/xmlrpc/2/object';
  return `${cfg.url}${path}`;
}

module.exports = {
  loadOdooConfig,
  isOdooConfigured,
  odooUsesHttps,
  xmlrpcEndpoint,
  normalizeOdooBaseUrl,
};
