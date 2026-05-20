const { pool } = require('../config/db');
const { isManagedCommercial } = require('../lib/adminTeam');

async function isSharedWithUser(projectId, userId) {
  const { rows } = await pool.query(
    `SELECT shared_by FROM project_shares WHERE project_id = $1 AND user_id = $2`,
    [projectId, userId]
  );
  return rows[0] ? { isSharedWithMe: true, sharedBy: rows[0].shared_by } : { isSharedWithMe: false };
}

/**
 * Contexto de acceso a un proyecto (compartido, equipo comercial, etc.).
 */
async function loadProjectAccessContext(user, projectRow) {
  if (!projectRow || !user) return {};
  if (projectRow.created_by === user.id) {
    return { isOwner: true, isSharedWithMe: false, isTeamCommercial: false };
  }

  const share = await isSharedWithUser(projectRow.id, user.id);
  if (share.isSharedWithMe) {
    return { ...share, isTeamCommercial: false };
  }

  if (user.role === 'ADMIN' && projectRow.created_by) {
    const team = await isManagedCommercial(user.id, projectRow.created_by);
    if (team) {
      return { isSharedWithMe: false, isTeamCommercial: true, teamCommercialId: projectRow.created_by };
    }
  }

  return { isSharedWithMe: false, isTeamCommercial: false };
}

/** @deprecated use loadProjectAccessContext */
const loadShareContext = loadProjectAccessContext;

module.exports = { isSharedWithUser, loadProjectAccessContext, loadShareContext };
