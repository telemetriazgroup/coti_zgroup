import { createRequire } from 'module';
import { describe, it, expect } from 'vitest';

const require = createRequire(import.meta.url);
const { totalsFromRows } = require('../../server/lib/budgetTotals.js');

function row(partial) {
  return {
    tipo: 'ACTIVO',
    subtotal: 0,
    apply_adjustment: true,
    is_bundle_header: false,
    is_bundle_component: false,
    bundle_id: null,
    ...partial,
  };
}

describe('totales de presupuesto con KIT', () => {
  it('un consumible suelto sigue yendo a consumibles', () => {
    const t = totalsFromRows([
      row({ tipo: 'ACTIVO', subtotal: 1000 }),
      row({ tipo: 'CONSUMIBLE', subtotal: 200, apply_adjustment: false }),
    ]);
    expect(t.activos).toBe(1000);
    expect(t.consumibles).toBe(200);
    expect(t.lista).toBe(1200);
    expect(t.consumiblesAdj).toBe(0);
    expect(t.consumiblesExempt).toBe(200);
  });

  it('no cuenta dos veces la cabecera y sus componentes', () => {
    const t = totalsFromRows([
      row({ bundle_id: 'k1', is_bundle_header: true, subtotal: 1000 }),
      row({ bundle_id: 'k1', is_bundle_component: true, tipo: 'ACTIVO', subtotal: 800 }),
      row({ bundle_id: 'k1', is_bundle_component: true, tipo: 'CONSUMIBLE', subtotal: 200 }),
    ]);
    expect(t.lista).toBe(1000);
    expect(t.activos).toBe(800);
    expect(t.consumibles).toBe(200);
  });

  it('reparte el precio cobrado del kit (con descuento) según el tipo de cada componente', () => {
    // Caso STORE 2XL: cortina 300 + unión plegable 1500 son CONSUMIBLE.
    // El resto del conjunto es ACTIVO. La cabecera es el neto cobrado.
    const t = totalsFromRows([
      row({
        codigo: 'PF-0001',
        bundle_id: 'kit',
        is_bundle_header: true,
        tipo: 'ACTIVO',
        subtotal: 31390,
        apply_adjustment: true,
      }),
      row({ bundle_id: 'kit', is_bundle_component: true, tipo: 'CONSUMIBLE', subtotal: 300, apply_adjustment: false }),
      row({ bundle_id: 'kit', is_bundle_component: true, tipo: 'CONSUMIBLE', subtotal: 1500, apply_adjustment: false }),
      row({ bundle_id: 'kit', is_bundle_component: true, tipo: 'ACTIVO', subtotal: 890, apply_adjustment: false }),
      row({ bundle_id: 'kit', is_bundle_component: true, tipo: 'ACTIVO', subtotal: 15900, apply_adjustment: false }),
      row({ bundle_id: 'kit', is_bundle_component: true, tipo: 'ACTIVO', subtotal: 7400, apply_adjustment: false }),
      row({ bundle_id: 'kit', is_bundle_component: true, tipo: 'ACTIVO', subtotal: 7400, apply_adjustment: false }),
    ]);
    const gross = 33390;
    const cons = Math.round(31390 * (1800 / gross) * 100) / 100;
    expect(t.consumibles).toBe(cons);
    expect(t.activos).toBe(Math.round((31390 - cons) * 100) / 100);
    expect(t.lista).toBe(31390);
    expect(t.consumiblesAdj).toBe(cons);
    expect(t.consumiblesExempt).toBe(0);
    expect(t.activos + t.consumibles).toBe(31390);
  });

  it('si el kit no trae componentes, usa el tipo de la cabecera', () => {
    const t = totalsFromRows([
      row({ bundle_id: 'k', is_bundle_header: true, tipo: 'ACTIVO', subtotal: 500 }),
    ]);
    expect(t.activos).toBe(500);
    expect(t.consumibles).toBe(0);
  });
});
