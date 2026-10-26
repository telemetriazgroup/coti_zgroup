const assert = require('node:assert');
const { applyKitDiscount, normalizeKitDiscountPct, computeLinesTotal } = require('../../server/lib/catalogKit');

describe('descuento porcentual de conjunto KIT', () => {
  it('normaliza % inválido a 0 y recorta a 100', () => {
    assert.strictEqual(normalizeKitDiscountPct(-4), 0);
    assert.strictEqual(normalizeKitDiscountPct('x'), 0);
    assert.strictEqual(normalizeKitDiscountPct(150), 100);
    assert.strictEqual(normalizeKitDiscountPct(12.345), 12.35);
  });

  it('aplica descuento sobre la suma de componentes y deja el bruto para tachado', () => {
    const gross = computeLinesTotal([
      { qty: 2, unitPrice: 100, included: true },
      { qty: 1, unitPrice: 50, included: true },
    ]);
    assert.strictEqual(gross, 250);
    const { net, discountPct } = applyKitDiscount(gross, 10);
    assert.strictEqual(discountPct, 10);
    assert.strictEqual(net, 225);
  });

  it('descuento 0 no cambia el total', () => {
    const { gross, net } = applyKitDiscount(19055, 0);
    assert.strictEqual(gross, 19055);
    assert.strictEqual(net, 19055);
  });
});
