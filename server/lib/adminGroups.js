const { pool } = require('../config/db');
const { isManagedCommercial } = require('./adminTeam');

/** Comerciales propios del admin (creados + asignados). */
function sqlAdminOwnTeamCommercials(viewerAdminParam) {
  return `(
    EXISTS (
      SELECT 1 FROM users ucm
      WHERE ucm.id = p.created_by AND ucm.role = 'COMERCIAL' AND ucm.created_by = ${viewerAdminParam}::uuid
    ) OR EXISTS (
      SELECT 1 FROM admin_commercial_assignments aca
      WHERE aca.admin_id = ${viewerAdminParam}::uuid AND aca.commercial_id = p.created_by
    )
  )`;
}

/** Proyectos de otros ADMIN del mismo grupo y comerciales bajo esos ADMIN. */
function sqlAdminGroupProjectAccess(viewerAdminParam) {
  return `EXISTS (
    SELECT 1
    FROM admin_group_members agm_viewer
    JOIN admin_group_members agm_peer ON agm_peer.group_id = agm_viewer.group_id
      AND agm_peer.admin_id <> agm_viewer.admin_id
    JOIN users u_peer ON u_peer.id = agm_peer.admin_id AND u_peer.role = 'ADMIN' AND u_peer.active = true
    WHERE agm_viewer.admin_id = ${viewerAdminParam}::uuid
      AND (
        p.created_by = agm_peer.admin_id
        OR EXISTS (
          SELECT 1 FROM users ucm
          WHERE ucm.id = p.created_by AND ucm.role = 'COMERCIAL' AND ucm.active = true AND (
            ucm.created_by = agm_peer.admin_id OR
            EXISTS (
              SELECT 1 FROM admin_commercial_assignments aca
              WHERE aca.admin_id = agm_peer.admin_id AND aca.commercial_id = ucm.id
            )
          )
        )
      )
  )`;
}

function sqlAdminTeamAndGroupAccess(viewerAdminParam) {
  return `(${sqlAdminOwnTeamCommercials(viewerAdminParam)} OR ${sqlAdminGroupProjectAccess(viewerAdminParam)})`;
}

async function isGroupProjectAccessible(adminId, creatorId) {
  if (!adminId || !creatorId) return false;
  const { rows } = await pool.query(
    `SELECT 1
     FROM admin_group_members agm_viewer
     JOIN admin_group_members agm_peer ON agm_peer.group_id = agm_viewer.group_id
       AND agm_peer.admin_id <> agm_viewer.admin_id
     JOIN users u_peer ON u_peer.id = agm_peer.admin_id AND u_peer.role = 'ADMIN' AND u_peer.active = true
     WHERE agm_viewer.admin_id = $1::uuid
       AND (
         $2::uuid = agm_peer.admin_id
         OR EXISTS (
           SELECT 1 FROM users ucm
           WHERE ucm.id = $2::uuid AND ucm.role = 'COMERCIAL' AND ucm.active = true AND (
             ucm.created_by = agm_peer.admin_id OR
             EXISTS (
               SELECT 1 FROM admin_commercial_assignments aca
               WHERE aca.admin_id = agm_peer.admin_id AND aca.commercial_id = ucm.id
             )
           )
         )
       )
     LIMIT 1`,
    [adminId, creatorId]
  );
  return rows.length > 0;
}

async function canAdminAccessProjectCreator(adminId, creatorId) {
  if (await isManagedCommercial(adminId, creatorId)) {
    return { ok: true, isTeamCommercial: true, isGroupAccess: false };
  }
  if (await isGroupProjectAccessible(adminId, creatorId)) {
    return { ok: true, isTeamCommercial: false, isGroupAccess: true };
  }
  return { ok: false, isTeamCommercial: false, isGroupAccess: false };
}

module.exports = {
  sqlAdminOwnTeamCommercials,
  sqlAdminGroupProjectAccess,
  sqlAdminTeamAndGroupAccess,
  isGroupProjectAccessible,
  canAdminAccessProjectCreator,
};
