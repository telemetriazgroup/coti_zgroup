/**
 * Motor financiero ZGROUP M1–M4 (puro, sin I/O).
 * Lógica alineada a zgroup-cotizaciones-v10-final.html y modulo financiero.md
 * ESM (shared/package.json "type": "module") para Vite/Rollup y Vitest.
 */
export const DEFAULT_FINANCE_PARAMS = {
  adjType: 'margin',
  adjPct: 0,
  enableCp: true,
  enableLp: true,
  enableEst: true,
  cpPlazo: 6,
  cpVida: 60,
  cpOp: 5,
  cpRoa: 35,
  cpMerma: 2,
  lpN: 24,
  lpNContrato: 36,
  lpVida: 120,
  lpTeaBanco: 7,
  lpTeaCot: 15,
  lpOp: 5,
  lpForm: 350,
  lpPostPct: 80,
  lpFondoRep: 5,
  estOp: 8,
  estSb: 4,
  estSeguro: 1,
  estSbPct: 35,
  /** Horizonte meses para panel gerencial CP vs LP */
  cmpPeriod: 24,

  /** Opciones de PDF / reporte (no afectan cálculos M1–M5) */
  pdfShowRentalMonths: true,
  pdfIncludeIgv: false,
  pdfLogoUrl: '',
  pdfFooter: '',
};

export function mergeFinanceParams(stored) {
  return { ...DEFAULT_FINANCE_PARAMS, ...(stored && typeof stored === 'object' ? stored : {}) };
}

export function frenchPayment(pv, tem, n) {
  if (pv <= 0 || n <= 0) return 0;
  if (tem <= 0) return pv / n;
  return (pv * tem) / (1 - Math.pow(1 + tem, -n));
}

/**
 * Tabla de amortización (mismo criterio que HTML renderAmort).
 * @returns {{rows: Array<{period:number,saldoInicial:number,interes:number,amortizacion:number,cuota:number}>}}
 */
export function buildAmortizationSchedule(pv, tem, n, cuota) {
  const rows = [];
  let saldo = pv;
  const resid = 0;
  for (let i = 1; i <= n; i++) {
    const saldoInicial = saldo;
    const interes = saldo * tem;
    const amort = cuota - interes;
    saldo = Math.max(0, saldo - amort);
    const cuotaFila = i === n ? cuota + resid : cuota;
    rows.push({
      period: i,
      saldoInicial: saldoInicial,
      interes,
      amortizacion: amort,
      cuota: cuotaFila,
    });
  }
  return { rows };
}

/**
 * @param {object} input
 * @param {number} input.baseLista - suma activos + consumibles (subtotal lista)
 * @param {number} [input.baseActivos]
 * @param {number} [input.baseConsumibles]
 * @param {object} [input.params] - finance params (parcial OK)
 */
export function computeFinance(input) {
  const p = mergeFinanceParams(input?.params);
  const baseActivos = Number(input?.baseActivos);
  const baseConsumibles = Number(input?.baseConsumibles);
  const baseLista =
    input?.baseLista != null
      ? Number(input.baseLista)
      : (Number.isFinite(baseActivos) ? baseActivos : 0) +
        (Number.isFinite(baseConsumibles) ? baseConsumibles : 0);

  const adj = p.adjPct || 0;
  const isMargin = p.adjType !== 'discount';
  const ventaAdj = baseLista * (adj / 100);
  const ventaTotal = isMargin ? baseLista + ventaAdj : baseLista - ventaAdj;

  const m1 = {
    base: baseLista,
    adjPct: adj,
    adjType: isMargin ? 'margin' : 'discount',
    ventaAdj,
    ventaTotal,
    discount100Warning: !isMargin && adj >= 100 && ventaTotal <= 0,
  };

  const cpPlazo = Math.max(1, p.cpPlazo || 6);
  const cpVida = Math.max(1, p.cpVida || 60);
  const cpOp = p.cpOp || 5;
  const cpRoa = p.cpRoa || 35;
  const cpMerma = p.cpMerma || 2;

  const baseCons = Number.isFinite(baseConsumibles) ? baseConsumibles : 0;

  const cpDep = ventaTotal / cpVida;
  const cpMermaVal = (ventaTotal * (cpMerma / 100)) / cpPlazo;
  const cpGop = (ventaTotal * (cpOp / 100)) / 12;
  const cpConsRec = baseCons > 0 ? baseCons / cpPlazo : 0;
  const cpRoaVal = (ventaTotal * (cpRoa / 100)) / 12;
  const cpRentaVal = cpDep + cpMermaVal + cpGop + cpConsRec + cpRoaVal;
  const cpGanancia = cpRoaVal;
  const cpPE = cpGanancia > 0 ? Math.ceil(ventaTotal / cpGanancia) : null;

  const m2 = {
    enabled: p.enableCp !== false,
    cpPlazo,
    cpVida,
    cpOp,
    cpRoa,
    cpMerma,
    depreciationMonthly: cpDep,
    mermaMonthly: cpMermaVal,
    gopMonthly: cpGop,
    consumiblesMonthly: cpConsRec,
    roaMonthly: cpRoaVal,
    rentaCliente: cpRentaVal,
    gananciaMensual: cpGanancia,
    peMeses: cpPE,
    peDisplay: cpGanancia > 0 ? `${cpPE} m` : '—',
    warningVidaMenorPlazo: cpVida < cpPlazo,
  };

  const lpNPrestamo = Math.max(1, p.lpN || 24);
  let lpNContrato = Math.max(lpNPrestamo, p.lpNContrato || 36);
  const lpVida = Math.max(1, p.lpVida || 120);
  const lpTeaBanco = (p.lpTeaBanco || 7) / 100;
  const lpTeaCot = (p.lpTeaCot || 15) / 100;
  const lpOp = p.lpOp || 5;
  const lpForm = p.lpForm || 350;
  const lpPostPct = (p.lpPostPct || 80) / 100;
  const lpFondoRepAnnual = (p.lpFondoRep || 5) / 100;

  const totalFin = ventaTotal + lpForm;
  const temBanco = lpTeaBanco > 0 ? Math.pow(1 + lpTeaBanco, 1 / 12) - 1 : 0;
  const temCot = lpTeaCot > 0 ? Math.pow(1 + lpTeaCot, 1 / 12) - 1 : 0;

  let cuotaBanco = 0;
  let cuotaCliente = 0;
  if (totalFin > 0 && lpNPrestamo > 0) {
    cuotaBanco = frenchPayment(totalFin, temBanco, lpNPrestamo);
    cuotaCliente = frenchPayment(totalFin, temCot, lpNPrestamo);
  }

  const lpSpreadVal = cuotaCliente - cuotaBanco;
  const lpGop = (ventaTotal * (lpOp / 100)) / 12;

  const lpRentaF1 = cuotaCliente + lpGop;
  const lpGanF1 = lpSpreadVal;
  const lpTotalGanF1 = lpGanF1 * lpNPrestamo;

  const lpNF2 = Math.max(0, lpNContrato - lpNPrestamo);
  const contrUmbral = lpVida * 0.8;
  const activarFondo = lpNContrato > contrUmbral;
  const lpFondoMensual = activarFondo ? ventaTotal * (lpFondoRepAnnual / 12) : 0;

  const lpRentaF2 = lpRentaF1 * lpPostPct;
  const lpGanF2 = lpRentaF2 - lpGop - lpFondoMensual;
  const lpTotalGanF2 = lpGanF2 * lpNF2;
  const lpTotalCiclo = lpTotalGanF1 + lpTotalGanF2;
  const lpPE = lpGanF1 > 0 ? Math.ceil(lpForm / lpGanF1) : 0;

  const lpSpreadNegative = cuotaCliente < cuotaBanco - 1e-9;

  const amort = buildAmortizationSchedule(totalFin, temBanco, lpNPrestamo, cuotaBanco);

  const m3 = {
    enabled: p.enableLp !== false,
    lpNPrestamo,
    lpNContrato,
    lpVida,
    lpTeaBancoPct: p.lpTeaBanco || 7,
    lpTeaCotPct: p.lpTeaCot || 15,
    lpOp,
    lpForm,
    lpPostPct: p.lpPostPct || 80,
    lpFondoRepPct: p.lpFondoRep || 5,
    totalFinanciado: totalFin,
    temBanco,
    temCliente: temCot,
    cuotaBanco,
    cuotaCliente,
    lpSpread: lpSpreadVal,
    lpGop,
    lpRentaF1,
    lpGanF1,
    lpTotalGanF1,
    lpNF2,
    lpRentaF2,
    lpGanF2,
    lpTotalGanF2,
    lpTotalCiclo,
    lpPE,
    lpPEDisplay: lpPE > 0 ? `${lpPE} m` : '< 1 m',
    activarFondoReposicion: activarFondo,
    contratoUmbralMeses: Math.round(contrUmbral),
    lpFondoMensual,
    lpSpreadNegative,
    amortization: amort.rows,
    timeline: {
      f1Pct: lpNContrato > 0 ? (lpNPrestamo / lpNContrato) * 100 : 0,
      f2Pct: lpNContrato > 0 ? ((lpNContrato - lpNPrestamo) / lpNContrato) * 100 : 0,
    },
  };

  const estOp = Math.max(1, p.estOp || 8);
  const estSb = Math.max(1, p.estSb || 4);
  const estSeg = p.estSeguro || 1;
  const estSbPct = (p.estSbPct || 35) / 100;

  const seasonalRatio = (estOp + estSb * estSbPct) / 12;

  const estSeguroVal = (ventaTotal * (estSeg / 100)) / 12;
  const estGestion = (ventaTotal * 0.05) / 12;
  const estCostoMin = cuotaBanco + estSeguroVal + estGestion;
  const estRentaSb = lpRentaF1 * estSbPct;

  const estIngFullYear = lpRentaF1 * estOp;
  const estIngSbYear = estRentaSb * estSb;
  const estIngTotalYear = estIngFullYear + estIngSbYear;
  const estGastoF1Year = (cuotaBanco + lpGop) * estOp + cuotaBanco * estSb;
  const estGanTotalYear = estIngTotalYear - estGastoF1Year;
  const estMargenPct = estIngTotalYear > 0 ? (estGanTotalYear / estIngTotalYear) * 100 : 0;

  const lpTotalCicloSeasonal = lpTotalCiclo * seasonalRatio;

  const standbyBelowMin =
    ventaTotal > 0 && estRentaSb < estCostoMin - 1e-9;
  const minStandbyPct =
    lpRentaF1 > 0 ? Math.ceil((estCostoMin / lpRentaF1) * 100) : 0;

  const fiveYearRows = [];
  let cumAcum = 0;
  let totIng = 0;
  let totBanco = 0;
  let totGop = 0;
  let totUtil = 0;
  const FIXED_YEARS = 5;

  for (let yr = 1; yr <= FIXED_YEARS; yr++) {
    const mStart = (yr - 1) * 12 + 1;
    const mEnd = yr * 12;

    const f1Months = Math.max(0, Math.min(mEnd, lpNPrestamo) - Math.max(mStart - 1, 0));
    const f2Months = Math.max(0, Math.min(mEnd, lpNContrato) - Math.max(mStart - 1, lpNPrestamo));
    const activeMonths = f1Months + f2Months;

    const f1FullM = f1Months * (estOp / 12);
    const f1SbM = f1Months * (estSb / 12);
    const f2FullM = f2Months * (estOp / 12);
    const f2SbM = f2Months * (estSb / 12);
    const ingBruto =
      f1FullM * lpRentaF1 +
      f1SbM * (lpRentaF1 * estSbPct) +
      f2FullM * lpRentaF2 +
      f2SbM * (lpRentaF2 * estSbPct);

    const pagoBanco = cuotaBanco * f1Months;
    const gopYear = lpGop * activeMonths + (activarFondo ? lpFondoMensual * f2Months : 0);
    const utilNeta = ingBruto - pagoBanco - gopYear;
    cumAcum += utilNeta;
    totIng += ingBruto;
    totBanco += pagoBanco;
    totGop += gopYear;
    totUtil += utilNeta;

    const isAllF1 = f1Months >= 12;
    const isAllF2 = f2Months >= 12;
    const isTransition = f1Months > 0 && f2Months > 0;

    const prevWasF2 = yr > 1 && (yr - 2) * 12 + 1 > lpNPrestamo;
    const showF2Banner = isAllF2 && pagoBanco === 0 && !prevWasF2;

    fiveYearRows.push({
      year: yr,
      monthStart: mStart,
      monthEnd: mEnd,
      f1Months,
      f2Months,
      ingBruto,
      pagoBanco,
      gopYear,
      utilNeta,
      cumAcum,
      isAllF1,
      isAllF2,
      isTransition,
      showTransitionBanner: isTransition,
      showF2FullYearBanner: showF2Banner,
      phaseLabel: isTransition ? 'F1→F2' : isAllF2 ? 'F2' : 'F1',
    });
  }

  const reglaDeOroExpected = lpTotalCicloSeasonal;
  const reglaDeOroActual = totUtil;
  const reglaDeOroOk = Math.abs(reglaDeOroActual - reglaDeOroExpected) <= 1;

  const m4 = {
    enabled: p.enableEst !== false,
    estOp,
    estSb,
    estSeguroPct: estSeg,
    estSbPct: p.estSbPct || 35,
    seasonalRatio,
    estRentaSb,
    estCostoMin,
    estSeguroVal,
    estGestion,
    standbyBelowMin,
    minStandbyPct,
    estIngFullYear,
    estIngSbYear,
    estIngTotalYear,
    estGanTotalYear,
    estMargenPct,
    estGastoF1Year,
    fiveYearRows,
    totals5y: {
      totIng,
      totBanco,
      totGop,
      totUtil,
      cumAcum,
    },
    lpTotalCicloSeasonal,
    reglaDeOro: {
      expected: reglaDeOroExpected,
      actual: reglaDeOroActual,
      ok: reglaDeOroOk,
    },
  };

  // ── M5 Panel gerencial (comparativa CP vs LP, HTML v10) ────────
  const cmpPeriod = Math.max(1, p.cmpPeriod || 24);
  const cpTot = cpGanancia * cmpPeriod;
  const f1InPeriod = Math.min(cmpPeriod, lpNPrestamo);
  const f2InPeriod = Math.max(0, cmpPeriod - lpNPrestamo);
  const lpTotInPeriod = lpGanF1 * f1InPeriod + lpGanF2 * f2InPeriod;
  const lpMasBarato = lpRentaF1 <= cpRentaVal;
  const diffRenta = lpRentaF1 - cpRentaVal;
  let veredicto = '';
  if (ventaTotal <= 0) {
    veredicto = 'Añade partidas al presupuesto para ver el análisis comparativo.';
  } else if (lpMasBarato) {
    const roiAnual =
      cpGanancia > 0 ? ((cpGanancia * 12) / ventaTotal) * 100 : null;
    veredicto =
      `LP Fase 1 es más barata para el cliente que CP (aprox. ${Math.abs(diffRenta).toFixed(2)} USD/mes en renta). ` +
      `Horizonte ${cmpPeriod}m: utilidad acumulada CP ${cpTot.toFixed(2)} USD vs LP ${lpTotInPeriod.toFixed(2)} USD. ` +
      (roiAnual != null ? `ROI anual CP sobre capital ~${roiAnual.toFixed(1)}%.` : '');
  } else {
    veredicto = `LP Fase 1 es más cara que CP (${diffRenta.toFixed(2)} USD/mes). Ajustar tasa de cotización LP para competir.`;
  }

  const m5 = {
    cmpPeriod,
    cpRenta: cpRentaVal,
    lpRentaF1: lpRentaF1,
    cpTotPeriodo: cpTot,
    lpTotPeriodo: lpTotInPeriod,
    lpMasBaratoCliente: lpMasBarato,
    lpTotalCiclo,
    lpTotalCicloSeasonal,
    veredicto,
  };

  return {
    paramsResolved: p,
    m1,
    m2,
    m3,
    m4,
    m5,
  };
}
