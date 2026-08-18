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

function parseOdooWriteDate(raw) {
  if (raw == null || raw === false) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(s)) {
    return new Date(`${s.replace(' ', 'T')}Z`);
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function overlapWatermark(watermark) {
  const base = watermark ? new Date(watermark) : EPOCH;
  const t = Number.isNaN(base.getTime()) ? EPOCH.getTime() : base.getTime();
  return new Date(t - OVERLAP_MS);
}

function shouldSkipEcho(incomingWriteDate, lastPushedWriteDate) {
  if (!incomingWriteDate || !lastPushedWriteDate) return false;
  const a = incomingWriteDate instanceof Date ? incomingWriteDate : new Date(incomingWriteDate);
  const b = lastPushedWriteDate instanceof Date ? lastPushedWriteDate : new Date(lastPushedWriteDate);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return false;
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
  toOdooNaiveUtc,
  parseOdooWriteDate,
  overlapWatermark,
  shouldSkipEcho,
  maxDate,
  isDebounced,
  odooPartnerLookupDomain,
};
