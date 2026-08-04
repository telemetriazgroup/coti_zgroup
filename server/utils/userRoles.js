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

function canManageCatalog(user) {
  return hasAdminPanelAccess(user);
}

function canShareProjects(user) {
  return user?.role === 'ADMIN' || isSemiAdmin(user) || isSuperuser(user);
}

/** Archivados: solo ADMIN (propios) y SUPERUSER. */
function canViewArchivedProjects(user) {
  return user?.role === 'ADMIN' || isSuperuser(user);
}

/** Ítems/categorías inactivos en catálogo: solo ADMIN y SUPERUSER. */
function canViewInactiveCatalog(user) {
  return user?.role === 'ADMIN' || isSuperuser(user);
}

function isAdminLikeRole(role) {
  return role === 'ADMIN' || role === 'SEMIADMIN';
}

module.exports = {
  isSuperuser,
  isSemiAdmin,
  isAdmin,
  hasAdminPanelAccess,
  canManageCatalog,
  canShareProjects,
  canViewArchivedProjects,
  canViewInactiveCatalog,
  isAdminLikeRole,
};
