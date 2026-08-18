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
});
