export function isSuperuser(user) {
  return user?.role === 'SUPERUSER';
}

export function isAdmin(user) {
  return user?.role === 'ADMIN' || isSuperuser(user);
}

export function canManageCatalog(user) {
  return isAdmin(user);
}

export function canShareProjects(user) {
  return user?.role === 'ADMIN' || isSuperuser(user);
}

export function canWriteProjects(user) {
  return isAdmin(user) || user?.role === 'COMERCIAL';
}
