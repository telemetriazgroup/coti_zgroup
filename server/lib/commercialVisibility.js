async function loadUserFlags(userId) {
  const { pool } = require('../config/db');
  const { rows } = await pool.query(
    `SELECT id, role, can_see_finance_summary,
            can_see_finance_m1, can_see_finance_cp, can_see_finance_lp, can_see_finance_est
     FROM users WHERE id = $1`,
    [userId]
  );
  return rows[0] || null;
}

function isCommercialRole(userOrRole) {
  const role = typeof userOrRole === 'string' ? userOrRole : userOrRole?.role;
  return role === 'COMERCIAL';
}

/** Comercial nunca ve precios unitarios ni subtotales por línea. */
function canSeeItemPrices(userRow) {
  if (!userRow) return true;
  if (userRow.role === 'VIEWER') return false;
  if (userRow.role === 'COMERCIAL') return false;
  return true;
}

/** Comercial no ve tablas/formulas M1–M5 salvo resumen autorizado. */
function canSeeFinanceDetail(userRow) {
  if (!userRow) return true;
  if (userRow.role === 'VIEWER') return false;
  if (userRow.role === 'COMERCIAL') return false;
  return true;
}

/** Cuotas / montos por módulo sin detalle — flags granulares del admin. */
function canSeeFinanceSummary(userRow) {
  if (!userRow) return true;
  if (userRow.role !== 'COMERCIAL') return true;
  if (userRow.can_see_finance_summary === true) return true;
  return (
    userRow.can_see_finance_m1 === true ||
    userRow.can_see_finance_cp === true ||
    userRow.can_see_finance_lp === true ||
    userRow.can_see_finance_est === true
  );
}

function mapCommercialFinanceAccess(userRow) {
  if (!userRow || userRow.role !== 'COMERCIAL') {
    return { m1: true, cp: true, lp: true, est: true };
  }
  const legacy = userRow.can_see_finance_summary === true;
  return {
    m1: legacy || userRow.can_see_finance_m1 === true,
    cp: legacy || userRow.can_see_finance_cp === true,
    lp: legacy || userRow.can_see_finance_lp === true,
    est: legacy || userRow.can_see_finance_est === true,
  };
}

function commercialModuleFlags(userRow) {
  if (!userRow) {
    return { m1: false, cp: false, lp: false, est: false };
  }
  const legacy = userRow.can_see_finance_summary === true;
  return {
    m1: legacy || userRow.can_see_finance_m1 === true,
    cp: legacy || userRow.can_see_finance_cp === true,
    lp: legacy || userRow.can_see_finance_lp === true,
    est: legacy || userRow.can_see_finance_est === true,
  };
}

function hasExplicitFinanceModuleFlags(userRow) {
  if (!userRow || userRow.role !== 'COMERCIAL') return false;
  return (
    userRow.can_see_finance_summary === true ||
    userRow.can_see_finance_m1 === true ||
    userRow.can_see_finance_cp === true ||
    userRow.can_see_finance_lp === true ||
    userRow.can_see_finance_est === true
  );
}

function commercialModuleAllowed(userRow, module) {
  if (!userRow || userRow.role !== 'COMERCIAL') return true;
  const flags = commercialModuleFlags(userRow);
  if (!hasExplicitFinanceModuleFlags(userRow)) return true;
  return flags[module] === true;
}

function resolveCommercialAllowedModules(userRow) {
  if (!userRow || userRow.role !== 'COMERCIAL') return null;
  return {
    m1: commercialModuleAllowed(userRow, 'm1'),
    cp: commercialModuleAllowed(userRow, 'cp'),
    lp: commercialModuleAllowed(userRow, 'lp'),
    est: commercialModuleAllowed(userRow, 'est'),
  };
}

/**
 * Módulos en PDF/panel comercial.
 * M1 (venta directa): si el admin autorizó el módulo al usuario, va en la propuesta
 * (es la cotización base). CP/LP/Est requieren además «Vista comercial» del proyecto.
 */
function resolveCommercialModules(userRow, financeParams) {
  if (!userRow || userRow.role !== 'COMERCIAL') return null;
  const fp =
    financeParams && typeof financeParams === 'object'
      ? financeParams
      : {};
  const allowed = resolveCommercialAllowedModules(userRow);
  const explicit = hasExplicitFinanceModuleFlags(userRow);
  return {
    m1: allowed.m1 && (explicit ? true : fp.commercialShowM1 === true),
    cp: allowed.cp && fp.commercialShowCp === true && fp.enableCp !== false,
    lp: allowed.lp && fp.commercialShowLp === true && fp.enableLp !== false,
    est: allowed.est && fp.commercialShowEst === true && fp.enableEst !== false,
  };
}

/**
 * Comercial persiste inclusión de módulos autorizados y, si tiene M1,
 * el tipo/porcentaje de margen o descuento.
 */
function pickCommercialShowPatch(financeParams, userRow) {
  if (!financeParams || typeof financeParams !== 'object') return {};
  const keys = [
    ['commercialShowM1', 'm1'],
    ['commercialShowCp', 'cp'],
    ['commercialShowLp', 'lp'],
    ['commercialShowEst', 'est'],
  ];
  const patch = {};
  for (const [paramKey, mod] of keys) {
    if (financeParams[paramKey] === undefined) continue;
    if (!commercialModuleAllowed(userRow, mod)) continue;
    patch[paramKey] = financeParams[paramKey] === true;
  }
  if (commercialModuleAllowed(userRow, 'm1')) {
    if (financeParams.adjType === 'margin' || financeParams.adjType === 'discount') {
      patch.adjType = financeParams.adjType;
    }
    if (financeParams.adjPct !== undefined && financeParams.adjPct !== null) {
      const n = Number(financeParams.adjPct);
      if (Number.isFinite(n)) {
        patch.adjPct = Math.min(100, Math.max(0, n));
      }
    }
  }
  return patch;
}

function sanitizeBudgetItem(item) {
  if (!item || typeof item !== 'object') return item;
  return {
    ...item,
    unitPrice: null,
    officialUnitPrice: null,
    subtotal: null,
  };
}

function sanitizeBudgetItemsResponse(userRow, data) {
  if (canSeeItemPrices(userRow)) return data;
  const items = (data.items || []).map(sanitizeBudgetItem);
  const t = data.totals || {};
  const num = (v) => (v != null ? Number(v) : 0);
  const totals = {
    lista: num(t.lista),
    activos: num(t.activos),
    consumibles: num(t.consumibles),
    listaAdj: num(t.listaAdj),
    listaExempt: num(t.listaExempt),
    activosAdj: num(t.activosAdj),
    activosExempt: num(t.activosExempt),
    consumiblesAdj: num(t.consumiblesAdj),
    consumiblesExempt: num(t.consumiblesExempt),
  };
  return { ...data, items, totals, priceVisibility: 'total_only' };
}

function sanitizeCatalogItem(item) {
  if (!item || typeof item !== 'object') return item;
  return {
    ...item,
    unitPrice: null,
    unitPriceIntl: null,
  };
}

function sanitizeCatalogData(userRow, data) {
  if (canSeeItemPrices(userRow)) return data;
  return {
    ...data,
    items: (data.items || []).map(sanitizeCatalogItem),
  };
}

function sanitizePriceLine(line) {
  if (!line || typeof line !== 'object') return line;
  return { ...line, unitPrice: null };
}

function sanitizeKitTemplate(userRow, template) {
  if (canSeeItemPrices(userRow) || !template) return template;
  return {
    ...template,
    templatePrice: null,
    unitPrice: null,
    lines: (template.lines || []).map(sanitizePriceLine),
  };
}

function sanitizeDependencyBundle(userRow, bundle) {
  if (canSeeItemPrices(userRow) || !bundle) return bundle;
  return {
    ...bundle,
    lines: (bundle.lines || []).map(sanitizePriceLine),
  };
}

function sanitizeBundleEditPayload(userRow, payload) {
  if (canSeeItemPrices(userRow) || !payload) return payload;
  return {
    ...payload,
    unitPrice: null,
    lines: (payload.lines || []).map(sanitizePriceLine),
  };
}

module.exports = {
  loadUserFlags,
  isCommercialRole,
  canSeeItemPrices,
  canSeeFinanceDetail,
  canSeeFinanceSummary,
  mapCommercialFinanceAccess,
  commercialModuleAllowed,
  hasExplicitFinanceModuleFlags,
  resolveCommercialAllowedModules,
  resolveCommercialModules,
  pickCommercialShowPatch,
  sanitizeBudgetItem,
  sanitizeBudgetItemsResponse,
  sanitizeCatalogItem,
  sanitizeCatalogData,
  sanitizeKitTemplate,
  sanitizeDependencyBundle,
  sanitizeBundleEditPayload,
};
