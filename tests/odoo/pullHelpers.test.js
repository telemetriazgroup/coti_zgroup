const assert = require('node:assert');
const {
  toOdooNaiveUtc,
  overlapWatermark,
  shouldSkipEcho,
  isDebounced,
  OVERLAP_MS,
  EPOCH,
} = require('../../server/lib/odoo/pullHelpers');

describe('odoo pullHelpers (etapa 3)', () => {
  it('formatea datetime naive UTC para el dominio Odoo', () => {
    assert.strictEqual(toOdooNaiveUtc(new Date('2026-08-18T14:03:22.000Z')), '2026-08-18 14:03:22');
  });

  it('aplica solape de 120s al watermark (no usa reloj local como corte)', () => {
    const wm = new Date('2026-08-18T14:03:22.000Z');
    const since = overlapWatermark(wm);
    assert.strictEqual(wm.getTime() - since.getTime(), OVERLAP_MS);
    const fromNull = overlapWatermark(null);
    assert.strictEqual(fromNull.getTime(), EPOCH.getTime() - OVERLAP_MS);
  });

  it('detecta eco de un push propio', () => {
    const wd = new Date('2026-08-18T14:00:00Z');
    assert.strictEqual(shouldSkipEcho(wd, wd), true);
    assert.strictEqual(shouldSkipEcho(new Date('2026-08-18T13:59:00Z'), wd), true);
    assert.strictEqual(shouldSkipEcho(new Date('2026-08-18T14:01:00Z'), wd), false);
    assert.strictEqual(shouldSkipEcho(wd, null), false);
  });

  it('debounce 60s', () => {
    const now = Date.parse('2026-08-18T12:00:00Z');
    assert.strictEqual(isDebounced(new Date(now - 10_000), now, 60_000), true);
    assert.strictEqual(isDebounced(new Date(now - 90_000), now, 60_000), false);
    assert.strictEqual(isDebounced(null, now, 60_000), false);
  });

  it('parsea write_date naive de Odoo siempre como UTC (no hora Perú)', () => {
    const { parseOdooWriteDate, isRemoteWriteNewer, isTimezoneSkewDelta, LIMA_OFFSET_MS } =
      require('../../server/lib/odoo/pullHelpers');
    const utc = parseOdooWriteDate('2026-08-18 20:32:44');
    assert.strictEqual(utc.toISOString(), '2026-08-18T20:32:44.000Z');
    assert.strictEqual(parseOdooWriteDate('2026-08-18T20:32:44').toISOString(), '2026-08-18T20:32:44.000Z');
    assert.strictEqual(parseOdooWriteDate('20260818T20:32:44').toISOString(), '2026-08-18T20:32:44.000Z');
    assert.strictEqual(parseOdooWriteDate(utc).toISOString(), '2026-08-18T20:32:44.000Z');
    const limaAsUtc = parseOdooWriteDate('2026-08-18 15:32:44');
    assert.strictEqual(isTimezoneSkewDelta(utc.getTime() - limaAsUtc.getTime(), LIMA_OFFSET_MS), true);
    assert.strictEqual(isRemoteWriteNewer('2026-08-18 20:32:44', '2026-08-18 15:32:44'), false);
    assert.strictEqual(isRemoteWriteNewer('2026-08-18 20:32:44', '2026-08-18 20:32:43'), false);
    assert.strictEqual(isRemoteWriteNewer('2026-08-18 20:35:00', '2026-08-18 20:30:00'), true);
  });

  it('arma dominio OR para lookup por nombre/RUC', () => {
    const { odooPartnerLookupDomain } = require('../../server/lib/odoo/pullHelpers');
    assert.strictEqual(odooPartnerLookupDomain('ab'), null);
    const d = odooPartnerLookupDomain('Acme SAC');
    assert.ok(Array.isArray(d) && d.includes('|'));
    assert.ok(d.some((c) => Array.isArray(c) && c[0] === 'name' && c[2] === 'Acme SAC'));
    const ruc = odooPartnerLookupDomain('20123456789');
    assert.ok(ruc.some((c) => Array.isArray(c) && c[0] === 'vat' && c[2] === '20123456789'));
  });
});
