const { pool } = require('../config/db');
const { canAdminAccessProjectCreator } = require('../lib/adminGroups');
const { isAdminLikeRole } = require('./userRoles');

async function isSharedWithUser(projectId, userId) {
  const { rows } = await pool.query(
    `SELECT shared_by FROM project_shares WHERE project_id = $1 AND user_id = $2`,
    [projectId, userId]
  );
  return rows[0] ? { isSharedWithMe: true, sharedBy: rows[0].shared_by } : { isSharedWithMe: false };
}

function flagsFromProjectRow(projectRow) {
  return {
    isSharedWithMe: projectRow.is_shared_with_me === true || projectRow.isSharedWithMe === true,
    isTeamCommercial: projectRow.is_team_commercial === true || projectRow.isTeamCommercial === true,
    isGroupAccess: projectRow.is_group_access === true || projectRow.isGroupAccess === true,
    sharedBy: projectRow.shared_by || projectRow.sharedBy || null,
  };
}

/**
 * Contexto de acceso a un proyecto (compartido, equipo comercial, grupo admin, etc.).
 * ADMIN y SEMIADMIN: equipo propio y grupos. El listado ya los muestra; este contexto
 * debe coincidir o GET /:id e ítems responden 403.
 */
async function loadProjectAccessContext(user, projectRow) {
  if (!projectRow || !user) return {};
  if (projectRow.created_by === user.id) {
    return { isOwner: true, isSharedWithMe: false, isTeamCommercial: false, isGroupAccess: false };
  }

  const fromRow = flagsFromProjectRow(projectRow);
  if (fromRow.isSharedWithMe || fromRow.isTeamCommercial || fromRow.isGroupAccess) {
    return fromRow;
  }

  const share = await isSharedWithUser(projectRow.id, user.id);
  if (share.isSharedWithMe) {
    return { ...share, isTeamCommercial: false, isGroupAccess: false };
  }

  if (isAdminLikeRole(user.role) && projectRow.created_by) {
    const access = await canAdminAccessProjectCreator(user.id, projectRow.created_by);
    if (access.ok) {
      return {
        isSharedWithMe: false,
        isTeamCommercial: access.isTeamCommercial,
        isGroupAccess: access.isGroupAccess,
        teamCommercialId: access.isTeamCommercial ? projectRow.created_by : undefined,
      };
    }
  }

  return { isSharedWithMe: false, isTeamCommercial: false, isGroupAccess: false };
}

/** @deprecated use loadProjectAccessContext */
const loadShareContext = loadProjectAccessContext;

module.exports = { isSharedWithUser, loadProjectAccessContext, loadShareContext };
