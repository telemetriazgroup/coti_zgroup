import { mergeFinanceParams } from '@shared/finance-engine.js';

export function hasExplicitFinanceModuleFlags(user) {
  if (!user || user.role !== 'COMERCIAL') return false;
  return (
    user.canSeeFinanceSummary === true ||
    user.canSeeFinanceM1 === true ||
    user.canSeeFinanceCp === true ||
    user.canSeeFinanceLp === true ||
    user.canSeeFinanceEst === true
  );
}

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

  // Sin checks en Usuarios: basta activar el módulo en el presupuesto
  if (!anyExplicit) return true;

  return flags[module] === true;
}

export function resolveCommercialAllowedModules(user) {
  if (!user || user.role !== 'COMERCIAL') return null;
  return {
    m1: commercialModuleAllowed(user, 'm1'),
    cp: commercialModuleAllowed(user, 'cp'),
    lp: commercialModuleAllowed(user, 'lp'),
    est: commercialModuleAllowed(user, 'est'),
  };
}

/**
 * Módulos visibles para comercial.
 * Venta directa (M1) se incluye si el usuario tiene el módulo autorizado.
 * CP/LP/Est = permiso ∩ inclusión en esta cotización ∩ módulo habilitado.
 */
export function resolveCommercialModules(user, financeParams) {
  if (!user || user.role !== 'COMERCIAL') return null;
  const fp = mergeFinanceParams(financeParams);
  const allowed = resolveCommercialAllowedModules(user);
  const explicit = hasExplicitFinanceModuleFlags(user);
  return {
    m1: allowed.m1 && (explicit ? true : !!fp.commercialShowM1),
    cp: allowed.cp && !!fp.commercialShowCp && fp.enableCp !== false,
    lp: allowed.lp && !!fp.commercialShowLp && fp.enableLp !== false,
    est: allowed.est && !!fp.commercialShowEst && fp.enableEst !== false,
  };
}
