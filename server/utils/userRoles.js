function isSuperuser(user) {
  return user?.role === 'SUPERUSER';
}

function isAdmin(user) {
  return user?.role === 'ADMIN' || isSuperuser(user);
}

function canManageCatalog(user) {
  return isAdmin(user);
}

function canShareProjects(user) {
  return user?.role === 'ADMIN' || isSuperuser(user);
}

module.exports = { isSuperuser, isAdmin, canManageCatalog, canShareProjects };
