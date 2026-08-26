const { pool } = require('../config/db');
const { resolveAuditActorId } = require('../lib/requestContext');

/**
 * Registra un evento de auditoría en project_audit_log.
 * No bloquea la respuesta (fire-and-forget).
 *
 * @param {object} opts
 * @param {string} opts.projectId
 * @param {string} opts.eventType   - audit_event enum
 * @param {string} opts.actorId     - user.id
 * @param {object} [opts.prevData]
 * @param {object} [opts.newData]
 * @param {string} [opts.ip]
 */
async function logAuditEvent({ projectId, eventType, actorId, prevData, newData, ip }) {
  try {
    const resolvedActor = resolveAuditActorId(actorId);
    const extra =
      resolvedActor && actorId && resolvedActor !== actorId
        ? { ...(newData && typeof newData === 'object' ? newData : {}), impersonatedUserId: actorId }
        : newData || null;
    await pool.query(
      `INSERT INTO project_audit_log
         (project_id, event_type, actor_id, prev_data, new_data, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [projectId, eventType, resolvedActor, prevData || null, extra, ip || null]
    );
  } catch (err) {
    // Auditoría no debe interrumpir el flujo principal
    console.error('[AUDIT] Error logging event:', err.message);
  }
}

module.exports = { logAuditEvent };
