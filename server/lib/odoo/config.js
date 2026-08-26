/**
 * Configuración de conexión a Odoo 17 (etapa 0).
 * ODOO_SYNC_ENABLED debe quedar en 0 hasta la etapa 3 (worker de pull).
 */

function envFlag(name, fallback = false, env = process.env) {
  const raw = env[name];
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
    tlsInsecure: envFlag('ODOO_TLS_INSECURE', false, env),
    syncEnabled: envFlag('ODOO_SYNC_ENABLED', false, env),
    failureThreshold: Number.parseInt(env.ODOO_CIRCUIT_FAILURES || '5', 10) || 5,
    cooldownMs: Number.parseInt(env.ODOO_CIRCUIT_COOLDOWN_MS || String(10 * 60 * 1000), 10) || 10 * 60 * 1000,
  };
}

function isOdooConfigured(cfg = loadOdooConfig()) {
  return Boolean(cfg.url && cfg.db && cfg.user && cfg.apiKey);
}

function odooHostname(cfg = loadOdooConfig()) {
  if (!cfg.url) return '';
  try {
    return new URL(cfg.url).hostname;
  } catch {
    return '';
  }
}

/**
 * create/write solo contra staging SaaS, lab local, o con ODOO_WRITE_ENABLED=1.
 * Evita altas accidentales a production (zgroup.odoo.com) sin el módulo UNIQUE.
 */
function isOdooWriteAllowed(cfg = loadOdooConfig(), env = process.env) {
  if (!isOdooConfigured(cfg)) {
    return {
      ok: false,
      code: 'ODOO_NOT_CONFIGURED',
      message:
        'Configure ODOO_URL, ODOO_DB y ODOO_API_KEY apuntando a staging (espejo de producción) para crear o editar contactos.',
    };
  }
  if (envFlag('ODOO_WRITE_ENABLED', false, env)) {
    return { ok: true, host: odooHostname(cfg), forced: true };
  }
  const host = odooHostname(cfg);
  const stagingSaas = host.endsWith('.dev.odoo.com');
  const local = host === 'localhost' || host === '127.0.0.1';
  if (stagingSaas || local) return { ok: true, host };
  return {
    ok: false,
    code: 'ODOO_WRITE_BLOCKED',
    message: `Escritura bloqueada contra ${host}. Para la fase 5 apunte ODOO_URL a staging (*.dev.odoo.com) o, cuando el módulo x_ztrack_uid esté en ese entorno, ODOO_WRITE_ENABLED=1.`,
  };
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
  isOdooWriteAllowed,
  odooHostname,
  odooUsesHttps,
  xmlrpcEndpoint,
  normalizeOdooBaseUrl,
};
