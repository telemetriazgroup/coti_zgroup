const { sqlAdminTeamAndGroupAccess, sqlAdminOwnTeamCommercials, sqlAdminGroupProjectAccess } = require('../lib/adminGroups');

function mapCreator(row) {
  const email = row.creator_email || null;
  const nombres = row.creator_nombres || '';
  const apellidos = row.creator_apellidos || '';
  const label =
    nombres || apellidos
      ? `${nombres} ${apellidos}`.trim()
      : email || null;
  return {
    createdByEmail: email,
    createdByName: label || null,
  };
}

function mapProject(row, viewerId, viewerRole) {
  const creator = mapCreator(row);
  const isOwner = viewerId && row.created_by === viewerId;
  const isShared = row.is_shared_with_me === true;
  const isTeam = row.is_team_commercial === true;
  const isGroup = row.is_group_access === true;
  let accessKind = 'other';
  if (isOwner) accessKind = 'own';
  else if (isShared) accessKind = 'shared';
  else if (isGroup) accessKind = 'group';
  else if (isTeam) accessKind = 'team';

  const canEditMetadata =
    viewerRole === 'SUPERUSER' ||
    isOwner ||
    (viewerRole === 'ADMIN' && isTeam === true) ||
    (viewerRole === 'SEMIADMIN' && isTeam === true);

  return {
    id: row.id,
    nombre: row.nombre,
    odooRef: row.odoo_ref,
    clientId: row.client_id,
    clientRazonSocial: row.client_razon_social,
    clientRuc: row.client_ruc || null,
    clientDireccion: row.client_direccion || null,
    clientCiudad: row.client_ciudad || null,
    clientContactoNombre: row.client_contacto_nombre || null,
    clientContactoEmail: row.client_contacto_email || null,
    clientContactoTelefono: row.client_contacto_telefono || null,
    clientOdooId: row.client_odoo_id != null ? Number(row.client_odoo_id) : null,
    clientSyncOrigin: row.client_sync_origin || null,
    status: row.status,
    createdBy: row.created_by,
    ...creator,
    assignedViewer: row.assigned_viewer,
    currency: row.currency,
    tc: row.tc != null ? Number(row.tc) : null,
    quotationMarket: row.quotation_market || 'NACIONAL',
    financeParams: row.finance_params,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    accessKind,
    isSharedWithMe: isShared,
    sharedBy: row.shared_by || null,
    sharedByEmail: row.shared_by_email || null,
    sharedByName: row.shared_by_name || null,
    shareCount: row.share_count != null ? Number(row.share_count) : undefined,
    canEditMetadata,
    canViewAudit: canEditMetadata,
  };
}

/** SELECT enriquecido para listado/detalle de proyectos. $1 = viewer user id */
const PROJECT_SELECT = `
  SELECT p.*,
    c.razon_social AS client_razon_social,
    c.ruc AS client_ruc,
    c.direccion AS client_direccion,
    c.ciudad AS client_ciudad,
    c.contacto_nombre AS client_contacto_nombre,
    c.contacto_email AS client_contacto_email,
    c.contacto_telefono AS client_contacto_telefono,
    c.odoo_id AS client_odoo_id,
    c.sync_origin AS client_sync_origin,
    cu.email AS creator_email,
    ce.nombres AS creator_nombres,
    ce.apellidos AS creator_apellidos,
    EXISTS (
      SELECT 1 FROM project_shares ps
      WHERE ps.project_id = p.id AND ps.user_id = $1::uuid
    ) AS is_shared_with_me,
    ps_me.shared_by AS shared_by,
    su.email AS shared_by_email,
    TRIM(CONCAT(se.nombres, ' ', se.apellidos)) AS shared_by_name,
    (SELECT COUNT(*)::int FROM project_shares ps2 WHERE ps2.project_id = p.id) AS share_count,
    (
      $2::text IN ('ADMIN', 'SEMIADMIN') AND p.created_by IS DISTINCT FROM $1::uuid AND (
        ${sqlAdminOwnTeamCommercials('$1')}
      )
    ) AS is_team_commercial,
    (
      $2::text IN ('ADMIN', 'SEMIADMIN') AND p.created_by IS DISTINCT FROM $1::uuid AND (
        ${sqlAdminGroupProjectAccess('$1')}
      )
    ) AS is_group_access
  FROM projects p
  LEFT JOIN clients c ON c.id = p.client_id
  LEFT JOIN users cu ON cu.id = p.created_by
  LEFT JOIN employees ce ON ce.user_id = p.created_by
  LEFT JOIN project_shares ps_me ON ps_me.project_id = p.id AND ps_me.user_id = $1::uuid
  LEFT JOIN users su ON su.id = ps_me.shared_by
  LEFT JOIN employees se ON se.user_id = ps_me.shared_by
`;

function projectVisibilityWhere(paramRole = '$2', paramUid = '$1', paramIncludeDeleted = '$3') {
  const adminExtended = sqlAdminTeamAndGroupAccess(paramUid);
  return `(
    ${paramRole} = 'SUPERUSER' OR
    (${paramRole} IN ('ADMIN', 'SEMIADMIN') AND (
      p.created_by = ${paramUid}::uuid OR
      EXISTS (SELECT 1 FROM project_shares ps WHERE ps.project_id = p.id AND ps.user_id = ${paramUid}::uuid) OR
      ${adminExtended}
    )) OR
    (${paramRole} = 'COMERCIAL' AND (
      p.created_by = ${paramUid}::uuid OR
      EXISTS (SELECT 1 FROM project_shares ps WHERE ps.project_id = p.id AND ps.user_id = ${paramUid}::uuid)
    )) OR
    (${paramRole} = 'VIEWER' AND p.assigned_viewer = ${paramUid}::uuid)
  )
  AND (
    p.deleted_at IS NULL OR
    (${paramRole} = 'SUPERUSER' AND ${paramIncludeDeleted} = true) OR
    (${paramRole} = 'ADMIN' AND p.created_by = ${paramUid}::uuid AND ${paramIncludeDeleted} = true)
  )`;
}

module.exports = { mapProject, PROJECT_SELECT, projectVisibilityWhere };
