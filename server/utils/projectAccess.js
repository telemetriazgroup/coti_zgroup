/**
 * Permisos de lectura/escritura sobre filas de `projects` (misma lógica en rutas de proyecto e ítems).
 */
function canWriteProject(user, row) {
  if (user.role === 'ADMIN') return true;
  if (user.role === 'COMERCIAL' && row.created_by === user.id) return true;
  return false;
}

function canReadProject(user, row) {
  if (user.role === 'ADMIN') return true;
  if (user.role === 'COMERCIAL' && row.created_by === user.id) return true;
  if (user.role === 'VIEWER' && row.assigned_viewer === user.id) return true;
  return false;
}

module.exports = { canReadProject, canWriteProject };
