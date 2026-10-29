function isSuperuser(user) {
  return user?.role === 'SUPERUSER';
}

function isSemiAdmin(user) {
  return user?.role === 'SEMIADMIN';
}

/** ADMIN estricto (no incluye SEMIADMIN). */
function isAdmin(user) {
  return user?.role === 'ADMIN' || isSuperuser(user);
}

/** Panel admin: ADMIN, SEMIADMIN o SUPERUSER. */
function hasAdminPanelAccess(user) {
  return isAdmin(user) || isSemiAdmin(user);
}

/** Alta/edición de categorías, precios y productos del catálogo. */
function canManageCatalog(user) {
  return isAdmin(user);
}

/** Aprobar solicitudes de precio/alta del comercial. */
function canReviewCatalogRequests(user) {
  return hasAdminPanelAccess(user);
}

/** Productos no liberados: solo ADMIN / SUPERUSER. */
function canSeeUnreleasedCatalog(user) {
  return isAdmin(user);
}

function canShareProjects(user) {
  return user?.role === 'ADMIN' || isSemiAdmin(user) || isSuperuser(user);
}

/** Archivados y restauración: solo SUPERUSER. */
function canViewArchivedProjects(user) {
  return isSuperuser(user);
}

/** Ítems/categorías inactivos en catálogo: solo ADMIN y SUPERUSER. */
function canViewInactiveCatalog(user) {
  return user?.role === 'ADMIN' || isSuperuser(user);
}

function isAdminLikeRole(role) {
  return role === 'ADMIN' || role === 'SEMIADMIN';
}

/** Mercado de un proyecto o del usuario: solo ADMIN y SUPERUSER. SEMIADMIN no cambia nacional/internacional. */
function canChangeQuotationMarket(user) {
  return isAdmin(user);
}

module.exports = {
  isSuperuser,
  isSemiAdmin,
  isAdmin,
  hasAdminPanelAccess,
  canManageCatalog,
  canReviewCatalogRequests,
  canSeeUnreleasedCatalog,
  canShareProjects,
  canViewArchivedProjects,
  canViewInactiveCatalog,
  isAdminLikeRole,
  canChangeQuotationMarket,
};
