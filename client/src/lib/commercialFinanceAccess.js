import { mergeFinanceParams } from '@shared/finance-engine.js';

/** ¿El comercial tiene permiso de usuario para ver este módulo? */
export function commercialModuleAllowed(user, module) {
  if (!user || user.role !== 'COMERCIAL') return true;
  if (user.canSeeFinanceSummary === true) return true;

  const flags = {
    m1: user.canSeeFinanceM1 === true,
    cp: user.canSeeFinanceCp === true,
    lp: user.canSeeFinanceLp === true,
    est: user.canSeeFinanceEst === true,
  };
  const anyExplicit = flags.m1 || flags.cp || flags.lp || flags.est;

  // Sin checks en Usuarios: basta «Vista comercial» en el presupuesto (admin)
  if (!anyExplicit) return true;

  return flags[module] === true;
}

/** Módulos visibles para comercial = permiso usuario ∩ vista comercial del proyecto. */
export function resolveCommercialModules(user, financeParams) {
  if (!user || user.role !== 'COMERCIAL') return null;
  const fp = mergeFinanceParams(financeParams);
  return {
    m1: commercialModuleAllowed(user, 'm1') && !!fp.commercialShowM1,
    cp: commercialModuleAllowed(user, 'cp') && !!fp.commercialShowCp && fp.enableCp !== false,
    lp: commercialModuleAllowed(user, 'lp') && !!fp.commercialShowLp && fp.enableLp !== false,
    est: commercialModuleAllowed(user, 'est') && !!fp.commercialShowEst && fp.enableEst !== false,
  };
}
