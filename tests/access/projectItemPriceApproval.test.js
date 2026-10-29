const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  pricesDiffer,
  commercialPricePatch,
  reviewerPricePatch,
  canReviewBudgetPrices,
  priceApprovalMeta,
} = require('../../server/lib/projectItemPriceApproval');

describe('aprobación de precios de presupuesto', () => {
  it('el comercial deja PENDING si cambia el precio aprobado', () => {
    const patch = commercialPricePatch({ unit_price: 100, approved_unit_price: 100 }, 85);
    assert.strictEqual(patch.unitPrice, 85);
    assert.strictEqual(patch.priceStatus, 'PENDING');
    assert.strictEqual(patch.approvedUnitPrice, 100);
  });

  it('si el comercial vuelve al precio aprobado, queda APPROVED', () => {
    const patch = commercialPricePatch({ unit_price: 85, approved_unit_price: 100 }, 100);
    assert.strictEqual(patch.priceStatus, 'APPROVED');
    assert.strictEqual(patch.unitPrice, 100);
  });

  it('admin/semiadmin aprueban al guardar el precio', () => {
    const patch = reviewerPricePatch(70);
    assert.strictEqual(patch.priceStatus, 'APPROVED');
    assert.strictEqual(patch.approvedUnitPrice, 70);
  });

  it('solo admin, semiadmin y superuser revisan (el semiadmin debe ser el encargado)', () => {
    assert.strictEqual(canReviewBudgetPrices({ role: 'COMERCIAL' }), false);
    assert.strictEqual(canReviewBudgetPrices({ role: 'SEMIADMIN' }), true);
    assert.strictEqual(canReviewBudgetPrices({ role: 'ADMIN' }), true);
    assert.strictEqual(canReviewBudgetPrices({ role: 'SUPERUSER' }), true);
  });

  it('cuenta partidas pendientes para el * del proyecto', () => {
    const meta = priceApprovalMeta([
      { pricePending: true },
      { pricePending: false },
      { pricePending: true },
    ]);
    assert.strictEqual(meta.pendingPriceCount, 2);
    assert.strictEqual(meta.hasPendingPrices, true);
    assert.strictEqual(pricesDiffer(10, 10.001), false);
  });
});
