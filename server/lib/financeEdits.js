const { pool } = require('../config/db');
const { resolveAuditActorId } = require('./requestContext');

function stableJson(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return JSON.stringify(value ?? null);
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = value[key];
  return JSON.stringify(out);
}

async function recordFinanceEdit(projectId, actorId, db = pool) {
  if (!projectId) return;
  const actor = resolveAuditActorId(actorId);
  await db.query(
    `INSERT INTO project_finance_edits (project_id, actor_id) VALUES ($1, $2)`,
    [projectId, actor || null]
  );
}

async function listFinanceEdits(projectId, limit = 12) {
  const n = Math.min(30, Math.max(1, Number(limit) || 12));
  const { rows } = await pool.query(
    `SELECT e.id, e.created_at, u.email AS actor_email,
            TRIM(CONCAT(emp.nombres, ' ', emp.apellidos)) AS actor_name
     FROM project_finance_edits e
     LEFT JOIN users u ON u.id = e.actor_id
     LEFT JOIN employees emp ON emp.user_id = e.actor_id
     WHERE e.project_id = $1
     ORDER BY e.created_at DESC
     LIMIT $2`,
    [projectId, n]
  );
  return rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    actorEmail: row.actor_email || null,
    actorName: row.actor_name && String(row.actor_name).trim() ? String(row.actor_name).trim() : null,
  }));
}

module.exports = { stableJson, recordFinanceEdit, listFinanceEdits };
