const { isSuperuser, isAdminLikeRole, canViewArchivedProjects } = require('./userRoles');

function isProjectOwner(user, row) {
  if (isSuperuser(user)) return true;
  return row.created_by === user.id;
}

function canReadProject(user, row, ctx = {}) {
  if (isSuperuser(user)) return true;
  if (user.role === 'VIEWER' && row.assigned_viewer === user.id) return true;
  if (row.created_by === user.id) return true;
  if (ctx.isSharedWithMe) return true;
  if (isAdminLikeRole(user.role) && (ctx.isTeamCommercial || ctx.isGroupAccess)) return true;
  return false;
}

function canWriteProject(user, row, ctx = {}) {
  if (isSuperuser(user)) return true;
  if (row.created_by === user.id) return true;
  if (ctx.isSharedWithMe && (isAdminLikeRole(user.role) || user.role === 'COMERCIAL')) return true;
  if (isAdminLikeRole(user.role) && (ctx.isTeamCommercial || ctx.isGroupAccess)) return true;
  return false;
}

/** Compartir, asignar VIEWER, archivar — solo dueño ADMIN o superusuario. */
function canManageProject(user, row) {
  if (isSuperuser(user)) return true;
  if (isAdminLikeRole(user.role) && row.created_by === user.id) return true;
  return false;
}

function canCloneProject(user, row, ctx = {}) {
  return canWriteProject(user, row, ctx);
}

/** Editar nombre, cliente u Odoo: propio admin, superusuario o proyecto de comercial del equipo (no otros ADMIN). */
function canEditProjectMetadata(user, row, ctx = {}) {
  if (isSuperuser(user)) return true;
  if (row.created_by === user.id) return true;
  if (isAdminLikeRole(user.role) && ctx.isTeamCommercial === true) return true;
  return false;
}

function canViewProjectAudit(user, row, ctx = {}) {
  return canEditProjectMetadata(user, row, ctx);
}

module.exports = {
  isProjectOwner,
  canReadProject,
  canWriteProject,
  canManageProject,
  canCloneProject,
  canEditProjectMetadata,
  canViewProjectAudit,
};
