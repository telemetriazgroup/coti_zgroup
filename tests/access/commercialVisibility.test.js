const assert = require('node:assert');
const {
  commercialModuleAllowed,
  hasExplicitFinanceModuleFlags,
  resolveCommercialAllowedModules,
  resolveCommercialModules,
  pickCommercialShowPatch,
  sanitizeBudgetItemsResponse,
} = require('../../server/lib/commercialVisibility');

describe('visibilidad financiera del comercial', () => {
  const comercialM1 = {
    role: 'COMERCIAL',
    can_see_finance_m1: true,
    can_see_finance_cp: false,
    can_see_finance_lp: false,
    can_see_finance_est: false,
  };

  it('con venta directa autorizada, M1 va a la propuesta aunque commercialShowM1 esté apagado', () => {
    assert.strictEqual(hasExplicitFinanceModuleFlags(comercialM1), true);
    assert.strictEqual(commercialModuleAllowed(comercialM1, 'm1'), true);
    assert.strictEqual(commercialModuleAllowed(comercialM1, 'cp'), false);
    const mods = resolveCommercialModules(comercialM1, { commercialShowM1: false });
    assert.strictEqual(mods.m1, true);
    assert.strictEqual(mods.cp, false);
  });

  it('CP/LP/Est requieren inclusión en la cotización además del permiso', () => {
    const user = {
      role: 'COMERCIAL',
      can_see_finance_m1: true,
      can_see_finance_cp: true,
    };
    const off = resolveCommercialModules(user, { commercialShowCp: false, enableCp: true });
    assert.strictEqual(off.cp, false);
    const on = resolveCommercialModules(user, { commercialShowCp: true, enableCp: true });
    assert.strictEqual(on.cp, true);
  });

  it('el comercial solo persiste flags de módulos autorizados', () => {
    const patch = pickCommercialShowPatch(
      { commercialShowM1: true, commercialShowCp: true, adjPct: 40 },
      comercialM1
    );
    assert.deepStrictEqual(patch, { commercialShowM1: true });
  });

  it('sin flags explícitos puede activar cualquier módulo en la cotización', () => {
    const user = { role: 'COMERCIAL' };
    const allowed = resolveCommercialAllowedModules(user);
    assert.deepStrictEqual(allowed, { m1: true, cp: true, lp: true, est: true });
    const mods = resolveCommercialModules(user, { commercialShowM1: false });
    assert.strictEqual(mods.m1, false);
  });

  it('oculta precios unitarios pero conserva bases M1 en totales', () => {
    const data = sanitizeBudgetItemsResponse(comercialM1, {
      items: [{ id: '1', unitPrice: 100, subtotal: 200, applyAdjustment: true }],
      totals: { lista: 200, listaAdj: 200, listaExempt: 0, activos: 200, consumibles: 0 },
    });
    assert.strictEqual(data.items[0].unitPrice, null);
    assert.strictEqual(data.items[0].applyAdjustment, true);
    assert.strictEqual(data.totals.lista, 200);
    assert.strictEqual(data.totals.listaAdj, 200);
  });
});
