const { describe, it } = require('node:test');
const assert = require('node:assert');
const { canChangeQuotationMarket } = require('../../server/utils/userRoles');
const { resolveUnitPrice } = require('../../server/lib/pricingMarket');

describe('mercado nacional / internacional', () => {
  it('solo admin y superuser cambian el mercado', () => {
    assert.strictEqual(canChangeQuotationMarket({ role: 'SUPERUSER' }), true);
    assert.strictEqual(canChangeQuotationMarket({ role: 'ADMIN' }), true);
    assert.strictEqual(canChangeQuotationMarket({ role: 'SEMIADMIN' }), false);
    assert.strictEqual(canChangeQuotationMarket({ role: 'COMERCIAL' }), false);
  });

  it('el precio internacional del catálogo no pisa el nacional si no hay dual price', () => {
    const row = { unit_price: 100, unit_price_intl: 80, has_dual_price: false };
    assert.strictEqual(resolveUnitPrice(row, 'NACIONAL'), 100);
    assert.strictEqual(resolveUnitPrice(row, 'INTERNACIONAL'), 100);
  });

  it('con dual price, el proyecto internacional usa unit_price_intl', () => {
    const row = { unit_price: 100, unit_price_intl: 80, has_dual_price: true };
    assert.strictEqual(resolveUnitPrice(row, 'NACIONAL'), 100);
    assert.strictEqual(resolveUnitPrice(row, 'INTERNACIONAL'), 80);
  });
});
