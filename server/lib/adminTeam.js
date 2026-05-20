const { pool } = require('../config/db');

/** IDs de comerciales bajo un admin: creados por él + asignados por superusuario. */
async function getManagedCommercialIds(adminId) {
  const { rows } = await pool.query(
    `SELECT u.id FROM users u
     WHERE u.role = 'COMERCIAL' AND u.active = true AND (
       u.created_by = $1::uuid OR
       EXISTS (
         SELECT 1 FROM admin_commercial_assignments a
         WHERE a.admin_id = $1::uuid AND a.commercial_id = u.id
       )
     )`,
    [adminId]
  );
  return rows.map((r) => r.id);
}

async function isManagedCommercial(adminId, commercialUserId) {
  if (!adminId || !commercialUserId) return false;
  const { rows } = await pool.query(
    `SELECT 1 FROM users u
     WHERE u.id = $2::uuid AND u.role = 'COMERCIAL' AND (
       u.created_by = $1::uuid OR
       EXISTS (
         SELECT 1 FROM admin_commercial_assignments a
         WHERE a.admin_id = $1::uuid AND a.commercial_id = u.id
       )
     )
     LIMIT 1`,
    [adminId, commercialUserId]
  );
  return rows.length > 0;
}

module.exports = { getManagedCommercialIds, isManagedCommercial };
