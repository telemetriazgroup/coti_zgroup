/**
 * Bitácora de acceso y actividad (login, módulo, proyecto).
 * No bloquea el flujo principal.
 */
const { pool } = require('../config/db');

const ALLOWED_KINDS = new Set([
  'LOGIN',
  'LOGOUT',
  'DASHBOARD',
  'LISTA_PROYECTOS',
  'PRESUPUESTO',
  'PLANOS',
  'CATALOGO',
  'CLIENTES',
  'USUARIOS',
  'OTRO',
]);

const THROTTLE_MS = 3 * 60 * 1000;
const NO_THROTTLE = new Set(['LOGIN', 'LOGOUT']);

function clip(s, n) {
  const t = String(s || '').trim();
  if (!t) return null;
  return t.length > n ? t.slice(0, n) : t;
}

async function logUserActivity({ userId, kind, projectId, summary, path, ip }) {
  if (!userId) return;
  const k = String(kind || '').toUpperCase();
  if (!ALLOWED_KINDS.has(k)) return;
  try {
    if (!NO_THROTTLE.has(k)) {
      const { rows } = await pool.query(
        `SELECT created_at FROM user_activity_log
         WHERE user_id = $1 AND kind = $2
           AND COALESCE(project_id::text, '') = COALESCE($3::text, '')
         ORDER BY created_at DESC LIMIT 1`,
        [userId, k, projectId || null]
      );
      if (rows[0] && Date.now() - new Date(rows[0].created_at).getTime() < THROTTLE_MS) {
        return;
      }
    }
    await pool.query(
      `INSERT INTO user_activity_log (user_id, kind, project_id, summary, path, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        userId,
        k,
        projectId || null,
        clip(summary, 400),
        clip(path, 200),
        clip(ip, 64),
      ]
    );
  } catch (err) {
    console.error('[ACTIVITY] log:', err.message);
  }
}

async function markUserLogin(userId, ip) {
  if (!userId) return;
  try {
    await pool.query(`UPDATE users SET last_login_at = NOW(), last_login_ip = $2 WHERE id = $1`, [
      userId,
      clip(ip, 64),
    ]);
  } catch (err) {
    console.error('[ACTIVITY] last_login:', err.message);
  }
}

async function loadUserActivityDashboard() {
  const { rows: users } = await pool.query(
    `SELECT
       u.id,
       u.email,
       u.role::text AS role,
       u.last_login_at,
       u.last_login_ip,
       e.nombres,
       e.apellidos,
       a.kind AS last_kind,
       a.summary AS last_summary,
       a.created_at AS last_activity_at,
       a.project_id,
       p.nombre AS project_nombre
     FROM users u
     LEFT JOIN employees e ON e.user_id = u.id
     LEFT JOIN LATERAL (
       SELECT kind, summary, created_at, project_id
       FROM user_activity_log
       WHERE user_id = u.id
       ORDER BY created_at DESC
       LIMIT 1
     ) a ON true
     LEFT JOIN projects p ON p.id = a.project_id
     WHERE u.active = true
     ORDER BY COALESCE(u.last_login_at, a.created_at) DESC NULLS LAST, u.email ASC`
  );

  const { rows: recent } = await pool.query(
    `SELECT
       a.id,
       a.kind,
       a.summary,
       a.path,
       a.created_at,
       a.project_id,
       u.email,
       u.role::text AS role,
       e.nombres,
       e.apellidos,
       p.nombre AS project_nombre
     FROM user_activity_log a
     INNER JOIN users u ON u.id = a.user_id
     LEFT JOIN employees e ON e.user_id = u.id
     LEFT JOIN projects p ON p.id = a.project_id
     ORDER BY a.created_at DESC
     LIMIT 40`
  );

  const mapUser = (r) => ({
    id: r.id,
    email: r.email,
    role: r.role,
    nombres: r.nombres || null,
    apellidos: r.apellidos || null,
    lastLoginAt: r.last_login_at || null,
    lastLoginIp: r.last_login_ip || null,
    lastKind: r.last_kind || null,
    lastSummary: r.last_summary || null,
    lastActivityAt: r.last_activity_at || null,
    lastProjectId: r.project_id || null,
    lastProjectNombre: r.project_nombre || null,
  });

  return {
    users: users.map(mapUser),
    recent: recent.map((r) => ({
      id: r.id,
      kind: r.kind,
      summary: r.summary,
      path: r.path,
      createdAt: r.created_at,
      projectId: r.project_id || null,
      projectNombre: r.project_nombre || null,
      email: r.email,
      role: r.role,
      nombres: r.nombres || null,
      apellidos: r.apellidos || null,
    })),
  };
}

module.exports = {
  ALLOWED_KINDS,
  logUserActivity,
  markUserLogin,
  loadUserActivityDashboard,
};
