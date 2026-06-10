const { pool } = require('../config/db');

async function loadUserFlags(userId) {
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

function commercialModuleAllowed(userRow, module) {
  if (!userRow || userRow.role !== 'COMERCIAL') return true;
  if (userRow.can_see_finance_summary === true) return true;
  const flags = {
    m1: userRow.can_see_finance_m1 === true,
    cp: userRow.can_see_finance_cp === true,
    lp: userRow.can_see_finance_lp === true,
    est: userRow.can_see_finance_est === true,
  };
  const anyExplicit = flags.m1 || flags.cp || flags.lp || flags.est;
  if (!anyExplicit) return true;
  return flags[module] === true;
}

/** Módulos visibles en PDF/panel comercial = permiso usuario ∩ vista comercial del proyecto. */
function resolveCommercialModules(userRow, financeParams) {
  if (!userRow || userRow.role !== 'COMERCIAL') return null;
  const fp =
    financeParams && typeof financeParams === 'object'
      ? financeParams
      : {};
  return {
    m1: commercialModuleAllowed(userRow, 'm1') && fp.commercialShowM1 === true,
    cp:
      commercialModuleAllowed(userRow, 'cp') &&
      fp.commercialShowCp === true &&
      fp.enableCp !== false,
    lp:
      commercialModuleAllowed(userRow, 'lp') &&
      fp.commercialShowLp === true &&
      fp.enableLp !== false,
    est:
      commercialModuleAllowed(userRow, 'est') &&
      fp.commercialShowEst === true &&
      fp.enableEst !== false,
  };
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
  const totals = data.totals
    ? {
        lista: data.totals.lista != null ? Number(data.totals.lista) : 0,
      }
    : { lista: 0 };
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
  resolveCommercialModules,
  sanitizeBudgetItem,
  sanitizeBudgetItemsResponse,
  sanitizeCatalogItem,
  sanitizeCatalogData,
  sanitizeKitTemplate,
  sanitizeDependencyBundle,
  sanitizeBundleEditPayload,
};
