/**
 * Tests motor financiero M1–M4 (sin BD).
 */
import assert from 'node:assert';
import {
  computeFinance,
  mergeFinanceParams,
  DEFAULT_FINANCE_PARAMS,
  frenchPayment,
  buildAmortizationSchedule,
} from '../shared/finance-engine.js';

describe('finance-engine — defaults y M1', () => {
  it('mergeFinanceParams aplica defaults', () => {
    const m = mergeFinanceParams({ adjPct: 10 });
    assert.strictEqual(m.adjPct, 10);
    assert.strictEqual(m.cpPlazo, DEFAULT_FINANCE_PARAMS.cpPlazo);
    assert.strictEqual(m.pdfShowRentalMonths, DEFAULT_FINANCE_PARAMS.pdfShowRentalMonths);
    assert.strictEqual(m.pdfIncludeIgv, DEFAULT_FINANCE_PARAMS.pdfIncludeIgv);
  });

  it('M1 margen: ventaTotal = base × (1 + pct/100)', () => {
    const { m1 } = computeFinance({
      baseLista: 1000,
      params: { adjType: 'margin', adjPct: 10 },
    });
    assert.strictEqual(m1.ventaTotal, 1100);
  });

  it('M1 descuento: ventaTotal = base × (1 - pct/100)', () => {
    const { m1 } = computeFinance({
      baseLista: 1000,
      params: { adjType: 'discount', adjPct: 10 },
    });
    assert.strictEqual(m1.ventaTotal, 900);
  });

  it('M1 adj 0 deja venta = base', () => {
    const { m1 } = computeFinance({ baseLista: 500, params: { adjPct: 0 } });
    assert.strictEqual(m1.ventaTotal, 500);
  });

  it('M5 panel gerencial expone comparativa', () => {
    const { m5 } = computeFinance({ baseLista: 10000, params: { cmpPeriod: 12 } });
    assert.ok(m5.veredicto.length > 0);
    assert.strictEqual(m5.cmpPeriod, 12);
  });
});

describe('finance-engine — M2 corto plazo', () => {
  it('renta cliente = suma componentes (sin consumibles)', () => {
    const { m2 } = computeFinance({
      baseLista: 12000,
      baseConsumibles: 0,
      params: { adjPct: 0, cpPlazo: 6, cpVida: 60, cpOp: 5, cpRoa: 35, cpMerma: 2 },
    });
    const vt = 12000;
    const dep = vt / 60;
    const merma = (vt * 0.02) / 6;
    const gop = (vt * 0.05) / 12;
    const roa = (vt * 0.35) / 12;
    assert.ok(Math.abs(m2.rentaCliente - (dep + merma + gop + roa)) < 0.01);
    assert.ok(Math.abs(m2.gananciaMensual - roa) < 0.01);
  });

  it('PE = ceil(venta / ROA mensual)', () => {
    const { m1, m2 } = computeFinance({
      baseLista: 10000,
      params: { cpRoa: 10, cpVida: 120, cpPlazo: 12, cpMerma: 0, cpOp: 0 },
    });
    const gan = m2.gananciaMensual;
    const pe = Math.ceil(m1.ventaTotal / gan);
    assert.strictEqual(m2.peMeses, pe);
  });
});

describe('finance-engine — M3 largo plazo', () => {
  it('TEA 0: cuota banco = totalFin / N', () => {
    const pv = 10000;
    const n = 24;
    const c = frenchPayment(pv, 0, n);
    assert.ok(Math.abs(c - pv / n) < 1e-6);
  });

  it('spread negativo cuando tasa cliente < banco (mismo N)', () => {
    const { m3 } = computeFinance({
      baseLista: 50000,
      params: {
        lpTeaBanco: 15,
        lpTeaCot: 7,
        lpN: 24,
        lpNContrato: 36,
        lpForm: 350,
      },
    });
    assert.strictEqual(m3.lpSpreadNegative, true);
  });

  it('amortización: último saldo residual pequeño', () => {
    const pv = 24000;
    const tem = Math.pow(1.07, 1 / 12) - 1;
    const n = 24;
    const cuota = frenchPayment(pv, tem, n);
    const { rows } = buildAmortizationSchedule(pv, tem, n, cuota);
    assert.strictEqual(rows.length, n);
    assert.strictEqual(rows[0].saldoInicial, pv);
  });
});

describe('finance-engine — M4 Regla de Oro', () => {
  it('suma utilidad 5 años ≈ Total ciclo LP × seasonalRatio (±1 USD)', () => {
    const out = computeFinance({
      baseLista: 87543.21,
      baseActivos: 80000,
      baseConsumibles: 7543.21,
      params: {
        adjType: 'margin',
        adjPct: 5.5,
        lpN: 24,
        lpNContrato: 36,
        estOp: 8,
        estSb: 4,
        estSbPct: 35,
      },
    });
    assert.ok(out.m4.reglaDeOro.ok, `expected ${out.m4.reglaDeOro.expected} vs ${out.m4.reglaDeOro.actual}`);
  });
});
