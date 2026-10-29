const SEMIADMIN_FINANCE_KEYS = [
  'adjType',
  'adjPct',
  'commercialShowM1',
  'commercialShowCp',
  'commercialShowLp',
  'commercialShowEst',
  'cpPlazo',
  'lpN',
  'lpNContrato',
  'displayCurrency',
];

function roleOf(userOrRole) {
  return typeof userOrRole === 'string' ? userOrRole : userOrRole?.role;
}

function canEditAllFinance(userOrRole) {
  const role = roleOf(userOrRole);
  return role === 'ADMIN' || role === 'SUPERUSER';
}

function financeEditableKeys(userOrRole) {
  const role = roleOf(userOrRole);
  if (canEditAllFinance(role)) return null;
  if (role === 'SEMIADMIN') return [...SEMIADMIN_FINANCE_KEYS];
  return [];
}

function pickAllowedFinancePatch(incoming, userOrRole, extraKeys = []) {
  if (!incoming || typeof incoming !== 'object') return {};
  if (canEditAllFinance(userOrRole)) return incoming;
  const allowed = new Set([...(financeEditableKeys(userOrRole) || []), ...extraKeys]);
  const patch = {};
  for (const key of allowed) {
    if (incoming[key] !== undefined) patch[key] = incoming[key];
  }
  return patch;
}

function pickSemiAdminFinancePatch(incoming) {
  return pickAllowedFinancePatch(incoming, 'SEMIADMIN');
}

module.exports = {
  SEMIADMIN_FINANCE_KEYS,
  canEditAllFinance,
  financeEditableKeys,
  pickAllowedFinancePatch,
  pickSemiAdminFinancePatch,
};
