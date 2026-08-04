/** Roles que cada tipo de usuario puede crear. */
function allowedCreateRoles(creatorRole) {
  if (creatorRole === 'SUPERUSER') return ['ADMIN', 'SEMIADMIN', 'COMERCIAL', 'VIEWER'];
  if (creatorRole === 'ADMIN') return ['SEMIADMIN', 'COMERCIAL', 'VIEWER'];
  if (creatorRole === 'COMERCIAL') return ['VIEWER'];
  return [];
}

function canCreateRole(creatorRole, targetRole) {
  if (targetRole === 'SUPERUSER') return creatorRole === 'SUPERUSER';
  return allowedCreateRoles(creatorRole).includes(targetRole);
}

module.exports = { allowedCreateRoles, canCreateRole };
