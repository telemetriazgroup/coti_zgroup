#!/usr/bin/env node
/**
 * Etapa 0 — Probe de conexión a Odoo 17 (res.partner).
 *
 * Uso:
 *   npm run odoo:probe           etapa 0 (conexión)
 *   npm run odoo:probe:stage1    etapa 0 + exige módulo zgroup_partner_ext
 *
 * Requiere en .env: ODOO_URL, ODOO_DB, ODOO_USER, ODOO_API_KEY
 * ODOO_SYNC_ENABLED debe permanecer en 0 (este script no sincroniza).
 *
 * Escribe inventario en tmp/ (gitignored):
 *   tmp/odoo-partner-fields.json   — fields_get completo
 *   tmp/odoo-probe-report.json     — resumen + muestra normalizada
 */

const fs = require('fs');
const path = require('path');

function loadDotEnvFile() {
  const envPath = path.join(__dirname, '../../.env');
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] == null || process.env[key] === '') {
      process.env[key] = val;
    }
  }
}

loadDotEnvFile();
const requireStage1 = process.argv.includes('--stage1');
const { loadOdooConfig, isOdooConfigured, odooUsesHttps } = require('../lib/odoo/config');
const { createOdooClient } = require('../lib/odoo/xmlrpcClient');
const { XmlrpcFault } = require('../lib/odoo/xmlrpcCodec');
const { CircuitOpenError } = require('../lib/odoo/circuitBreaker');
const {
  PARTNER_FIELDS,
  PARTNER_FIELDS_OPTIONAL_PE,
  FIELDS_GET_ATTRIBUTES,
  CATEGORY_FIELDS,
  REQUIRED_FIELD_NAMES,
  DEFAULT_CATEGORY_LABELS,
  MODULE_TECHNICAL_NAME,
  X_ZTRACK_UID_FIELD,
} = require('../lib/odoo/partnerFields');
const {
  normalizePartner,
  summarizeFieldsGet,
  matchCategoryIds,
} = require('../lib/odoo/normalizePartner');

function fail(msg, extra) {
  console.error(`\n[FAIL] ${msg}`);
  if (extra) console.error(extra);
  process.exit(1);
}

function ok(label, detail) {
  console.log(`  ✓ ${label}${detail != null ? `: ${detail}` : ''}`);
}

function warn(label, detail) {
  console.log(`  ! ${label}${detail != null ? `: ${detail}` : ''}`);
}

async function main() {
  const cfg = loadOdooConfig();
  console.log('=== Odoo 17 probe ===\n');
  console.log(`URL:     ${cfg.url || '(vacío)'}`);
  console.log(`DB:      ${cfg.db || '(vacío)'}`);
  console.log(`USER:    ${cfg.user || '(vacío)'}`);
  console.log(`TIMEOUT: ${cfg.timeoutMs}ms`);
  console.log(`SYNC:    ${cfg.syncEnabled ? '1 (no usar aún)' : '0 (correcto para etapa 0)'}`);
  console.log(`TLS:     ${cfg.url ? (odooUsesHttps(cfg) ? 'https' : 'http') : '—'}`);

  if (!isOdooConfigured(cfg)) {
    fail(
      'Faltan ODOO_URL, ODOO_DB, ODOO_USER o ODOO_API_KEY en .env',
      'Copia las variables de .env.example y usa una API key (no el password de una persona).'
    );
  }

  if (!odooUsesHttps(cfg)) {
    warn('URL no es HTTPS', 'en producción no seguir con HTTP');
  }
  if (cfg.tlsInsecure) {
    warn('ODOO_TLS_INSECURE=1', 'certificado no se valida — solo staging');
  }
  if (cfg.syncEnabled) {
    warn('ODOO_SYNC_ENABLED=1', 'el worker de pull aún no existe; déjalo en 0');
  }

  const client = createOdooClient(cfg);
  const report = {
    at: new Date().toISOString(),
    url: cfg.url,
    db: cfg.db,
    user: cfg.user,
    https: odooUsesHttps(cfg),
    checks: {},
  };

  try {
    const ver = await client.version();
    report.checks.version = { ok: true, elapsedMs: ver.elapsedMs, value: ver.version };
    const serverVer =
      (ver.version && (ver.version.server_version || ver.version.server_serie)) || JSON.stringify(ver.version);
    ok('version', `${serverVer} (${ver.elapsedMs}ms)`);
    if (serverVer && !String(serverVer).startsWith('17') && !String(serverVer).includes('17.')) {
      warn('versión no parece 17', String(serverVer));
    }
  } catch (err) {
    fail('common.version (¿URL /xmlrpc/2, red, TLS?)', err.message);
  }

  let uid;
  try {
    const auth = await client.authenticate();
    uid = auth.uid;
    report.checks.authenticate = { ok: true, uid, elapsedMs: auth.elapsedMs };
    ok('authenticate', `uid=${uid} (${auth.elapsedMs}ms)`);
    if (!Number.isInteger(uid) || uid <= 0) {
      fail('authenticate no devolvió un uid entero positivo', uid);
    }
  } catch (err) {
    fail('authenticate (usuario, DB o API key)', formatErr(err));
  }

  let fieldsMap = {};
  try {
    const fg = await client.executeKw(uid, 'res.partner', 'fields_get', [], {
      attributes: [...FIELDS_GET_ATTRIBUTES],
    });
    fieldsMap = fg.result || {};
    report.checks.fieldsGet = { ok: true, elapsedMs: fg.elapsedMs, total: Object.keys(fieldsMap).length };
    ok('fields_get res.partner', `${Object.keys(fieldsMap).length} campos (${fg.elapsedMs}ms)`);
  } catch (err) {
    if (err instanceof XmlrpcFault && err.odooErrorKind === 'AccessError') {
      fail('AccessError en fields_get: faltan permisos Contactos / Responsable', formatErr(err));
    }
    fail('fields_get res.partner', formatErr(err));
  }

  const summary = summarizeFieldsGet(fieldsMap, REQUIRED_FIELD_NAMES, PARTNER_FIELDS_OPTIONAL_PE);
  const missingWhitelist = PARTNER_FIELDS.filter((n) => !fieldsMap[n]);
  report.checks.whitelist = {
    requiredMissing: summary.missingRequired,
    whitelistMissing: missingWhitelist,
    optionalPe: summary.optionalPe,
  };

  if (summary.missingRequired.length) {
    fail('Faltan campos obligatorios en fields_get', summary.missingRequired.join(', '));
  }
  ok('campos obligatorios', REQUIRED_FIELD_NAMES.join(', '));

  if (missingWhitelist.length) {
    warn('whitelist incompleta (ajustar partnerFields.js)', missingWhitelist.join(', '));
  } else {
    ok('whitelist congelada', `${PARTNER_FIELDS.length} campos presentes`);
  }

  for (const [name, present] of Object.entries(summary.optionalPe)) {
    if (present) ok(`campo PE ${name}`, 'presente');
    else warn(`campo PE ${name}`, 'no instalado (l10n_pe / l10n_latam)');
  }

  const requestedFields = PARTNER_FIELDS.filter((n) => fieldsMap[n]).concat(
    PARTNER_FIELDS_OPTIONAL_PE.filter((n) => fieldsMap[n])
  );

  try {
    const sr = await client.executeKw(
      uid,
      'res.partner',
      'search_read',
      [[]],
      {
        fields: requestedFields,
        limit: 1,
        offset: 0,
        order: 'id asc',
        context: { active_test: false, bin_size: true, lang: 'es_PE' },
      }
    );
    const row = Array.isArray(sr.result) ? sr.result[0] : null;
    report.checks.searchRead = { ok: true, elapsedMs: sr.elapsedMs, raw: row };
    ok('search_read limit 1', `${sr.elapsedMs}ms`);
    if (sr.elapsedMs > 2000) {
      warn('search_read > 2s', 'revisar red / workers de Odoo; no subir paralelismo');
    }
    if (!row) {
      warn('ningún res.partner', 'BD de Odoo vacía');
    } else {
      const emailRaw = row.email;
      const parentRaw = row.parent_id;
      if (emailRaw === false) ok('email=False', 'se normaliza a null');
      else ok('email crudo', JSON.stringify(emailRaw));
      if (parentRaw === false) ok('parent_id=False', 'se normaliza a null');
      else ok('parent_id crudo', JSON.stringify(parentRaw));

      const norm = normalizePartner(row);
      report.checks.normalized = norm;
      if (emailRaw === false && norm.email !== null) {
        fail('normalizador: email False debía ser null', JSON.stringify(norm.email));
      }
      if (parentRaw === false && norm.parent !== null) {
        fail('normalizador: parent_id False debía ser null', JSON.stringify(norm.parent));
      }
      ok('partner normalizado', `${norm.odooId} ${norm.displayName || norm.name || ''}`);
    }
  } catch (err) {
    if (err instanceof XmlrpcFault && err.odooErrorKind === 'AccessError') {
      fail('AccessError al leer res.partner: grupo Contactos insuficiente', formatErr(err));
    }
    fail('search_read res.partner', formatErr(err));
  }

  try {
    const cats = await client.executeKw(
      uid,
      'res.partner.category',
      'search_read',
      [[]],
      {
        fields: [...CATEGORY_FIELDS],
        order: 'name asc',
        context: { lang: 'es_PE' },
      }
    );
    const list = Array.isArray(cats.result) ? cats.result : [];
    const matched = matchCategoryIds(list, DEFAULT_CATEGORY_LABELS);
    report.checks.categories = {
      ok: true,
      elapsedMs: cats.elapsedMs,
      count: list.length,
      matched,
      sample: list.slice(0, 30).map((c) => ({ id: c.id, name: c.name })),
    };
    ok('res.partner.category', `${list.length} etiquetas (${cats.elapsedMs}ms)`);
    for (const key of ['cliente', 'proveedor', 'contacto']) {
      if (matched[key]) ok(`etiqueta ${key}`, `id=${matched[key].id} «${matched[key].name}»`);
      else warn(`etiqueta ${key}`, 'no hallada por nombre; anotar id a mano en etapa 2');
    }
  } catch (err) {
    fail('search_read res.partner.category', formatErr(err));
  }

  const stage1 = await runStage1Checks(client, uid, fieldsMap, { requireStage1 });
  report.checks.stage1 = stage1;

  const tmpDir = path.join(__dirname, '../../tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  const fieldsPath = path.join(tmpDir, 'odoo-partner-fields.json');
  const reportPath = path.join(tmpDir, 'odoo-probe-report.json');
  fs.writeFileSync(fieldsPath, JSON.stringify(fieldsMap, null, 2));
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  ok('inventario escrito', path.relative(process.cwd(), fieldsPath));
  ok('reporte escrito', path.relative(process.cwd(), reportPath));

  if (stage1.installed) {
    console.log('\n[OK] Probe etapa 0 + módulo etapa 1 presentes. ODOO_SYNC_ENABLED sigue en 0.');
    console.log('Siguiente: etapa 2 (tablas PostgreSQL odoo_partners / extensión clients).\n');
  } else {
    console.log('\n[OK] Probe etapa 0 superado. Módulo etapa 1 AÚN NO instalado en esta BD.');
    console.log('Instalar odoo_addons/zgroup_partner_ext en staging Odoo.sh (ver implementacion_contactos_odoo.md).');
    console.log('Luego: npm run odoo:probe:stage1\n');
  }
}

async function runStage1Checks(client, uid, fieldsMap, { requireStage1 }) {
  console.log('\n-- etapa 1 (módulo zgroup_partner_ext) --');
  const out = { installed: false, moduleState: null, field: null, uidSearch: null, writeDateMs: null };

  try {
    const mod = await client.executeKw(
      uid,
      'ir.module.module',
      'search_read',
      [[['name', '=', MODULE_TECHNICAL_NAME]]],
      { fields: ['name', 'state', 'latest_version'], limit: 1 }
    );
    const row = Array.isArray(mod.result) ? mod.result[0] : null;
    if (!row) {
      warn('módulo no está en addons path', `${MODULE_TECHNICAL_NAME} (copiar odoo_addons/ a Odoo.sh)`);
    } else {
      out.moduleState = row.state;
      if (row.state === 'installed') {
        ok('ir.module.module', `${row.name} state=${row.state} ${row.latest_version || ''}`);
      } else {
        warn('módulo presente pero no instalado', `state=${row.state} — Apps → Instalar`);
      }
    }
  } catch (err) {
    warn('no se pudo leer ir.module.module', formatErr(err));
  }

  const fieldMeta = fieldsMap[X_ZTRACK_UID_FIELD];
  if (!fieldMeta) {
    warn('campo x_ztrack_uid ausente', 'el módulo no está instalado en esta base');
    if (requireStage1) {
      fail(
        'Etapa 1 incompleta: falta x_ztrack_uid',
        'Instala zgroup_partner_ext en un branch staging de Odoo.sh, no directo en producción.'
      );
    }
    return out;
  }

  out.field = { type: fieldMeta.type, store: fieldMeta.store, string: fieldMeta.string };
  ok('campo x_ztrack_uid', `type=${fieldMeta.type} store=${fieldMeta.store}`);
  if (fieldMeta.type !== 'char') {
    warn('x_ztrack_uid no es Char', fieldMeta.type);
  }

  const fakeUid = '00000000-0000-4000-8000-000000000000';
  try {
    const sr = await client.executeKw(
      uid,
      'res.partner',
      'search_read',
      [[['x_ztrack_uid', '=', fakeUid]]],
      { fields: ['id', 'x_ztrack_uid'], limit: 5, context: { active_test: false } }
    );
    const hits = Array.isArray(sr.result) ? sr.result : [];
    out.uidSearch = { elapsedMs: sr.elapsedMs, count: hits.length };
    if (hits.length === 0) {
      ok(`search x_ztrack_uid UUID inventado`, `0 filas (${sr.elapsedMs}ms)`);
    } else {
      warn('UUID inventado ya existe', `${hits.length} filas — no debería`);
    }
  } catch (err) {
    warn('search x_ztrack_uid', formatErr(err));
    if (requireStage1) fail('No se pudo buscar por x_ztrack_uid', formatErr(err));
  }

  try {
    const sr = await client.executeKw(
      uid,
      'res.partner',
      'search_read',
      [[['write_date', '>=', '2020-01-01 00:00:00']]],
      {
        fields: ['id', 'write_date'],
        limit: 300,
        order: 'write_date asc, id asc',
        context: { active_test: false },
      }
    );
    const n = Array.isArray(sr.result) ? sr.result.length : 0;
    out.writeDateMs = sr.elapsedMs;
    ok('search_read write_date lote 300', `${n} filas en ${sr.elapsedMs}ms`);
    if (sr.elapsedMs > 3000) {
      warn('write_date lento', 'confirmar índice res_partner_write_date_idx en PostgreSQL de Odoo');
    }
  } catch (err) {
    warn('search_read write_date', formatErr(err));
  }

  out.installed = true;
  return out;
}

function formatErr(err) {
  if (err instanceof CircuitOpenError) return err.message;
  if (err instanceof XmlrpcFault) {
    return `${err.odooErrorKind}: ${err.faultString.split('\n')[0]}`;
  }
  return err && err.message ? err.message : String(err);
}

main().catch((err) => {
  fail('error no controlado', err.stack || err.message);
});
