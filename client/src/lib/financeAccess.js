export const SEMIADMIN_FINANCE_KEYS = [
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

export function canEditAllFinance(user) {
  return user?.role === 'ADMIN' || user?.role === 'SUPERUSER';
}

/** null = todos los campos; array = solo esas claves. */
export function financeEditableKeys(user) {
  if (canEditAllFinance(user)) return null;
  if (user?.role === 'SEMIADMIN') return [...SEMIADMIN_FINANCE_KEYS];
  return null;
}
