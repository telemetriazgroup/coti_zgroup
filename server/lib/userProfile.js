function mapAuthUser(row) {
  if (!row) return null;
  const id = row.user_id || row.id;
  return {
    id,
    email: row.email,
    role: row.role,
    nombres: row.nombres ?? null,
    apellidos: row.apellidos ?? null,
    cargo: row.cargo ?? null,
    fotoUrl: row.foto_url ?? null,
    pricingMarket: row.pricing_market || 'NACIONAL',
    canSeeFinanceSummary: row.can_see_finance_summary === true,
    canSeeFinanceM1: row.can_see_finance_m1 === true || row.can_see_finance_summary === true,
    canSeeFinanceCp: row.can_see_finance_cp === true || row.can_see_finance_summary === true,
    canSeeFinanceLp: row.can_see_finance_lp === true || row.can_see_finance_summary === true,
    canSeeFinanceEst: row.can_see_finance_est === true || row.can_see_finance_summary === true,
  };
}

const AUTH_USER_SELECT = `
  u.id, u.email, u.role, u.active, u.pricing_market,
  u.can_see_finance_summary, u.can_see_finance_m1, u.can_see_finance_cp,
  u.can_see_finance_lp, u.can_see_finance_est,
  e.nombres, e.apellidos, e.cargo, e.foto_url
`;

module.exports = { mapAuthUser, AUTH_USER_SELECT };
