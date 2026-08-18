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

export function canManageCatalog(user) {
  return hasAdminPanelAccess(user);
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
