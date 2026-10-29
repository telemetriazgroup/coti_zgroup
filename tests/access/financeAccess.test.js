const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  pickSemiAdminFinancePatch,
  canEditAllFinance,
  financeEditableKeys,
} = require('../../server/lib/financeAccess');

describe('permisos financieros por rol', () => {
  it('admin y superuser editan todo', () => {
    assert.strictEqual(canEditAllFinance({ role: 'ADMIN' }), true);
    assert.strictEqual(canEditAllFinance({ role: 'SUPERUSER' }), true);
    assert.strictEqual(financeEditableKeys({ role: 'ADMIN' }), null);
  });

  it('semiadmin solo persiste M1 y plazos CP/LP', () => {
    const patch = pickSemiAdminFinancePatch({
      adjPct: 8,
      adjType: 'discount',
      cpPlazo: 9,
      lpN: 36,
      lpNContrato: 48,
      lpMargen: 99,
      estOp: 12,
      cmpPeriod: 60,
      commercialShowCp: true,
    });
    assert.deepStrictEqual(patch, {
      adjPct: 8,
      adjType: 'discount',
      commercialShowCp: true,
      cpPlazo: 9,
      lpN: 36,
      lpNContrato: 48,
    });
  });
});
