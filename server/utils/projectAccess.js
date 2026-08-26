const { isSuperuser, isAdminLikeRole, canViewArchivedProjects } = require('./userRoles');

function isProjectOwner(user, row) {
  if (isSuperuser(user)) return true;
  return row.created_by === user.id;
}

function canReadProject(user, row, ctx = {}) {
  if (isSuperuser(user)) return true;
  if (user.role === 'ADMIN') return true;
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

/** Compartir y archivar — dueño ADMIN/SEMIADMIN o superusuario. */
function canManageProject(user, row) {
  if (isSuperuser(user)) return true;
  if (isAdminLikeRole(user.role) && row.created_by === user.id) return true;
  return false;
}

/** Asignar VIEWER: comercial dueño o superusuario. ADMIN no asigna vista. */
function canAssignProjectViewer(user, row) {
  if (isSuperuser(user)) return true;
  if (user.role === 'COMERCIAL' && row.created_by === user.id) return true;
  return false;
}

function canCloneProject(user, row, ctx = {}) {
  if (canWriteProject(user, row, ctx)) return true;
  if (isAdminLikeRole(user.role) && canReadProject(user, row, ctx)) return true;
  return false;
}

/**
 * Kits: el dueño puede editarlos; un usuario solo compartido no.
 * ADMIN / SEMIADMIN / SUPERUSER sí, en cualquier proyecto que puedan ver.
 */
function canEditProjectKits(user, row, ctx = {}) {
  if (isSuperuser(user)) return true;
  if (isAdminLikeRole(user.role) && canReadProject(user, row, ctx)) return true;
  if (row.created_by === user.id && (user.role === 'COMERCIAL' || isAdminLikeRole(user.role))) {
    return true;
  }
  return false;
}

/** Editar nombre, cliente u Odoo: propio admin, superusuario o proyecto de comercial del equipo (no otros ADMIN). */
function canEditProjectMetadata(user, row, ctx = {}) {
  if (isSuperuser(user)) return true;
  if (row.created_by === user.id) return true;
  if (isAdminLikeRole(user.role) && ctx.isTeamCommercial === true) return true;
  return false;
}

function canViewProjectAudit(user) {
  return isSuperuser(user);
}

module.exports = {
  isProjectOwner,
  canReadProject,
  canWriteProject,
  canManageProject,
  canAssignProjectViewer,
  canCloneProject,
  canEditProjectKits,
  canEditProjectMetadata,
  canViewProjectAudit,
};
