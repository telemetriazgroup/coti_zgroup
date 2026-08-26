/** Helpers puros del pull incremental (testables sin Odoo ni PG). */

const OVERLAP_MS = 120 * 1000;
const BATCH_SIZE = 300;
const LOCK_TTL_MS = 15 * 60 * 1000;
const DEBOUNCE_MS = 60 * 1000;
const EPOCH = new Date('1970-01-01T00:00:00.000Z');

function toOdooNaiveUtc(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '1970-01-01 00:00:00';
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

const LIMA_OFFSET_MS = 5 * 60 * 60 * 1000;

/**
 * Odoo 17 datetime es naive UTC. Nunca interpretar "2026-08-18 20:32:44" como hora local (GMT-5).
 */
function parseOdooWriteDate(raw) {
  if (raw == null || raw === false) return null;
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? null : raw;
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const ms = raw < 1e12 ? raw * 1000 : raw;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const s = String(raw).trim();
  if (!s) return null;

  if (/[zZ]$/.test(s) || /[+-]\d{2}:?\d{2}$/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  let m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?/);
  if (m) return new Date(`${m[1]}T${m[2]}${m[3] || ''}Z`);

  m = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  if (m) return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`);

  m = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/);
  if (m) return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`);

  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isTimezoneSkewDelta(deltaMs, offsetMs = LIMA_OFFSET_MS) {
  return Math.abs(Math.abs(Number(deltaMs)) - offsetMs) <= 120_000;
}

/** true si el write_date remoto es realmente más nuevo (no TZ ni jitter). */
function isRemoteWriteNewer(remoteWd, knownWd, { skewMs = 2000 } = {}) {
  if (!remoteWd || !knownWd) return false;
  const remote = parseOdooWriteDate(remoteWd);
  const known = parseOdooWriteDate(knownWd);
  if (!remote || !known) return false;
  const delta = remote.getTime() - known.getTime();
  if (delta <= skewMs) return false;
  if (isTimezoneSkewDelta(delta)) return false;
  return true;
}

function formatOdooWriteDateForUser(raw) {
  const d = parseOdooWriteDate(raw);
  if (!d) return String(raw || '');
  const utc = d.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
  const lima = new Intl.DateTimeFormat('es-PE', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(d);
  return `${utc} (${lima} hora Perú)`;
}

function overlapWatermark(watermark) {
  const base = watermark ? new Date(watermark) : EPOCH;
  const t = Number.isNaN(base.getTime()) ? EPOCH.getTime() : base.getTime();
  return new Date(t - OVERLAP_MS);
}

function shouldSkipEcho(incomingWriteDate, lastPushedWriteDate) {
  const a = parseOdooWriteDate(incomingWriteDate);
  const b = parseOdooWriteDate(lastPushedWriteDate);
  if (!a || !b) return false;
  return a.getTime() <= b.getTime();
}

function maxDate(current, candidate) {
  if (!candidate) return current;
  if (!current) return candidate;
  return candidate.getTime() > current.getTime() ? candidate : current;
}

function isDebounced(lastRunAt, now = Date.now(), windowMs = DEBOUNCE_MS) {
  if (!lastRunAt) return false;
  const t = lastRunAt instanceof Date ? lastRunAt.getTime() : new Date(lastRunAt).getTime();
  if (Number.isNaN(t)) return false;
  return now - t < windowMs;
}

const LOOKUP_MIN_LEN = 3;
const LOOKUP_MAX_LEN = 80;

/** Dominio XML-RPC para buscar un contacto por nombre / RUC / email. */
function odooPartnerLookupDomain(q) {
  const s = String(q || '').trim().slice(0, LOOKUP_MAX_LEN);
  if (s.length < LOOKUP_MIN_LEN) return null;
  const term = s.replace(/[%_]/g, ' ').trim();
  if (term.length < LOOKUP_MIN_LEN) return null;
  const digits = term.replace(/\D/g, '');
  const clauses = [
    ['name', 'ilike', term],
    ['display_name', 'ilike', term],
    ['vat', 'ilike', term],
    ['email', 'ilike', term],
  ];
  if (digits.length >= 8) clauses.push(['vat', 'ilike', digits]);
  const ors = [];
  for (let i = 0; i < clauses.length - 1; i += 1) ors.push('|');
  return [...ors, ...clauses];
}

module.exports = {
  OVERLAP_MS,
  BATCH_SIZE,
  LOCK_TTL_MS,
  DEBOUNCE_MS,
  EPOCH,
  LOOKUP_MIN_LEN,
  LOOKUP_MAX_LEN,
  LIMA_OFFSET_MS,
  toOdooNaiveUtc,
  parseOdooWriteDate,
  isTimezoneSkewDelta,
  isRemoteWriteNewer,
  formatOdooWriteDateForUser,
  overlapWatermark,
  shouldSkipEcho,
  maxDate,
  isDebounced,
  odooPartnerLookupDomain,
};
