export function isSuperuser(user) {
  return user?.role === 'SUPERUSER';
}

export function isSemiAdmin(user) {
  return user?.role === 'SEMIADMIN';
}

/** ADMIN estricto (no incluye SEMIADMIN). */
export function isAdmin(user) {
  return user?.role === 'ADMIN' || isSuperuser(user);
}

/** Panel admin: ADMIN, SEMIADMIN o SUPERUSER. */
export function hasAdminPanelAccess(user) {
  return isAdmin(user) || isSemiAdmin(user);
}

/** Alta/edición de categorías, precios y productos del catálogo. */
export function canManageCatalog(user) {
  return isAdmin(user);
}

/** Aprobar solicitudes de precio/alta del comercial. */
export function canReviewCatalogRequests(user) {
  return hasAdminPanelAccess(user);
}

/** Productos no liberados: solo ADMIN / SUPERUSER. */
export function canSeeUnreleasedCatalog(user) {
  return isAdmin(user);
}

export function canShareProjects(user) {
  return user?.role === 'ADMIN' || isSemiAdmin(user) || isSuperuser(user);
}

export function canViewArchivedProjects(user) {
  return isSuperuser(user);
}

export function canViewInactiveCatalog(user) {
  return user?.role === 'ADMIN' || isSuperuser(user);
}

export function canWriteProjects(user) {
  return hasAdminPanelAccess(user) || user?.role === 'COMERCIAL';
}

export function canWriteClients(user) {
  return canWriteProjects(user);
}

/** Mercado de un proyecto o del usuario: solo ADMIN y SUPERUSER. SEMIADMIN no cambia nacional/internacional. */
export function canChangeQuotationMarket(user) {
  return isAdmin(user);
}
