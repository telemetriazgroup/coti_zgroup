const { pool } = require('../config/db');

const RECENT_DAYS = 7;
const RECENT_LIMIT = 5;

function mapRecentRow(row) {
  const creatorName = String(row.creator_name || '').trim();
  return {
    id: row.id,
    nombre: row.nombre,
    odooRef: row.odoo_ref || null,
    status: row.status,
    createdAt: row.created_at,
    clientRazonSocial: row.client_razon_social || null,
    createdByEmail: row.creator_email || null,
    createdByName: creatorName || row.creator_email || null,
  };
}

async function listUnreviewedRecentProjects(userId) {
  const { rows } = await pool.query(
    `SELECT p.id, p.nombre, p.odoo_ref, p.status, p.created_at,
            c.razon_social AS client_razon_social,
            u.email AS creator_email,
            TRIM(CONCAT(COALESCE(e.nombres, ''), ' ', COALESCE(e.apellidos, ''))) AS creator_name
     FROM projects p
     LEFT JOIN clients c ON c.id = p.client_id
     LEFT JOIN users u ON u.id = p.created_by
     LEFT JOIN employees e ON e.user_id = p.created_by
     WHERE p.deleted_at IS NULL
       AND p.created_at >= NOW() - INTERVAL '7 days'
       AND NOT EXISTS (
         SELECT 1 FROM admin_project_reviews r
         WHERE r.user_id = $1 AND r.project_id = p.id
       )
     ORDER BY p.created_at DESC
     LIMIT $2`,
    [userId, RECENT_LIMIT]
  );
  return rows.map(mapRecentRow);
}

async function markProjectReviewed(userId, projectId) {
  const { rows } = await pool.query(
    `SELECT id FROM projects WHERE id = $1 AND deleted_at IS NULL`,
    [projectId]
  );
  if (!rows[0]) return false;
  await pool.query(
    `INSERT INTO admin_project_reviews (user_id, project_id)
     VALUES ($1, $2)
     ON CONFLICT (user_id, project_id) DO UPDATE SET reviewed_at = NOW()`,
    [userId, projectId]
  );
  return true;
}

module.exports = {
  RECENT_DAYS,
  RECENT_LIMIT,
  listUnreviewedRecentProjects,
  markProjectReviewed,
};
