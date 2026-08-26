import { describe, it, expect } from 'vitest';
import { buildConsolidatedKitBudgetRows, mergeKitComponents } from '../../shared/kitBudgetRows.js';

describe('vista presupuesto KIT', () => {
  const line = (id, extra = {}) => ({
    id,
    codigo: extra.codigo || id,
    descripcion: extra.descripcion || id,
    qty: extra.qty ?? 1,
    subtotal: extra.subtotal ?? 10,
    sortOrder: extra.sortOrder ?? 0,
    catalogItemId: extra.catalogItemId || id,
    bundleId: extra.bundleId,
    isBundleHeader: extra.isBundleHeader === true,
    isBundleComponent: extra.isBundleComponent === true,
  });

  it('consolida el mismo código dentro de un KIT aunque esté repetido en sub-grupos', () => {
    const merged = mergeKitComponents([
      line('a', { catalogItemId: 'te', codigo: 'TE-0012', qty: 4, subtotal: 100 }),
      line('b', { catalogItemId: 'te', codigo: 'TE-0012', qty: 4.8, subtotal: 120 }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].qty).toBe(8.8);
    expect(merged[0].subtotal).toBe(220);
  });

  it('no mezcla componentes de otro KIT aunque el sort_order esté intercalado', () => {
    const rows = [
      line('h1', { bundleId: 'k1', isBundleHeader: true, sortOrder: 0, codigo: 'PF-0001' }),
      line('c1', { bundleId: 'k1', isBundleComponent: true, sortOrder: 1, codigo: 'AC-0025', catalogItemId: 'ac' }),
      line('h2', { bundleId: 'k2', isBundleHeader: true, sortOrder: 2, codigo: 'PF-0002' }),
      line('intruder', {
        bundleId: 'k1',
        isBundleComponent: true,
        sortOrder: 3,
        codigo: 'TE-0012',
        catalogItemId: 'te',
      }),
      line('c2', { bundleId: 'k2', isBundleComponent: true, sortOrder: 4, codigo: 'TE-0014', catalogItemId: 'tm' }),
    ];
    const out = buildConsolidatedKitBudgetRows(rows);
    const codes = out.map((r) => r.codigo);
    expect(codes).toEqual(['PF-0001', 'AC-0025', 'TE-0012', 'PF-0002', 'TE-0014']);
  });

  it('en un mismo KIT suma CORTE PANEL aunque esté en dos sub-grupos', () => {
    const rows = [
      line('h1', { bundleId: 'k1', isBundleHeader: true, sortOrder: 0, codigo: 'PF-0001' }),
      line('c1', {
        bundleId: 'k1',
        isBundleComponent: true,
        sortOrder: 1,
        codigo: 'TE-0012',
        catalogItemId: 'te',
        qty: 4,
        subtotal: 1160,
      }),
      line('c2', {
        bundleId: 'k1',
        isBundleComponent: true,
        sortOrder: 5,
        codigo: 'TE-0012',
        catalogItemId: 'te',
        qty: 4.8,
        subtotal: 1392,
      }),
      line('h2', { bundleId: 'k2', isBundleHeader: true, sortOrder: 10, codigo: 'PF-0002' }),
    ];
    const out = buildConsolidatedKitBudgetRows(rows);
    const te = out.filter((r) => r.codigo === 'TE-0012');
    expect(te).toHaveLength(1);
    expect(te[0].qty).toBe(8.8);
    expect(te[0].subtotal).toBe(2552);
  });
});
