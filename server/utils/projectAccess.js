const { isSuperuser } = require('./userRoles');

function isProjectOwner(user, row) {
  if (isSuperuser(user)) return true;
  return row.created_by === user.id;
}

function canReadProject(user, row, ctx = {}) {
  if (isSuperuser(user)) return true;
  if (user.role === 'VIEWER' && row.assigned_viewer === user.id) return true;
  if (row.created_by === user.id) return true;
  if (ctx.isSharedWithMe) return true;
  if (user.role === 'ADMIN' && ctx.isTeamCommercial) return true;
  return false;
}

function canWriteProject(user, row, ctx = {}) {
  if (isSuperuser(user)) return true;
  if (row.created_by === user.id) return true;
  if (ctx.isSharedWithMe && (user.role === 'ADMIN' || user.role === 'COMERCIAL')) return true;
  if (user.role === 'ADMIN' && ctx.isTeamCommercial) return true;
  return false;
}

/** Compartir, asignar VIEWER, archivar — solo dueño ADMIN o superusuario. */
function canManageProject(user, row) {
  if (isSuperuser(user)) return true;
  if (user.role === 'ADMIN' && row.created_by === user.id) return true;
  return false;
}

function canCloneProject(user, row, ctx = {}) {
  return canWriteProject(user, row, ctx);
}

module.exports = {
  isProjectOwner,
  canReadProject,
  canWriteProject,
  canManageProject,
  canCloneProject,
};
