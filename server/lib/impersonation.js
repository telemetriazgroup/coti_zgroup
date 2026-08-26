const crypto = require('crypto');
const { pool } = require('../config/db');
const { signAccessToken } = require('../middleware/auth');
const { mapAuthUser, AUTH_USER_SELECT } = require('./userProfile');

function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function loadUserRow(userId, client = null) {
  const q = client ? client.query.bind(client) : pool.query.bind(pool);
  const { rows } = await q(
    `SELECT ${AUTH_USER_SELECT.replace(/\n/g, ' ')}
     FROM users u
     LEFT JOIN employees e ON e.user_id = u.id
     WHERE u.id = $1`,
    [userId]
  );
  return rows[0] || null;
}

async function loadActiveRefresh(req) {
  const refreshToken = req.cookies?.refreshToken;
  if (!refreshToken) return null;
  const tokenHash = hashRefreshToken(refreshToken);
  const { rows } = await pool.query(
    `SELECT rt.id, rt.user_id, rt.impersonate_user_id, rt.revoked_at, rt.expires_at
     FROM refresh_tokens rt
     WHERE rt.token_hash = $1
       AND rt.revoked_at IS NULL
       AND rt.expires_at > NOW()`,
    [tokenHash]
  );
  const row = rows[0];
  if (!row) return null;
  const owner = await loadUserRow(row.user_id);
  if (!owner || !owner.active) return null;
  return { tokenHash, row, owner };
}

function sessionUserPayload(effective, owner) {
  const user = mapAuthUser(effective);
  if (owner && owner.id !== effective.id) {
    user.impersonator = {
      id: owner.id,
      email: owner.email,
      role: owner.role,
      nombres: owner.nombres ?? null,
      apellidos: owner.apellidos ?? null,
    };
  }
  return user;
}

function signSessionAccess(effective, owner) {
  if (owner && owner.id !== effective.id) {
    return signAccessToken(effective, {
      impersonatorId: owner.id,
      impersonatorEmail: owner.email,
    });
  }
  return signAccessToken(effective);
}

function assertCanImpersonate(owner, target) {
  if (!owner || owner.role !== 'SUPERUSER') {
    const err = new Error('Solo el superadmin puede virtualizar un usuario');
    err.status = 403;
    err.code = 'FORBIDDEN';
    throw err;
  }
  if (!target || !target.active) {
    const err = new Error('Usuario no encontrado o inactivo');
    err.status = 404;
    err.code = 'NOT_FOUND';
    throw err;
  }
  if (target.id === owner.id) {
    const err = new Error('Ya está en su propia sesión');
    err.status = 400;
    err.code = 'INVALID_TARGET';
    throw err;
  }
  if (target.role === 'SUPERUSER') {
    const err = new Error('No se puede virtualizar a otro superadmin');
    err.status = 400;
    err.code = 'INVALID_TARGET';
    throw err;
  }
}

async function listImpersonationCandidates(ownerId) {
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.role, u.active,
            e.nombres, e.apellidos, e.cargo, e.foto_url
     FROM users u
     LEFT JOIN employees e ON e.user_id = u.id
     WHERE u.active = true
       AND u.role <> 'SUPERUSER'
       AND u.id <> $1
     ORDER BY u.role ASC, e.nombres ASC NULLS LAST, u.email ASC`,
    [ownerId]
  );
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    role: r.role,
    active: r.active,
    nombres: r.nombres,
    apellidos: r.apellidos,
    cargo: r.cargo,
    fotoUrl: r.foto_url,
  }));
}

async function setImpersonation(tokenHash, targetUserId) {
  await pool.query(
    `UPDATE refresh_tokens SET impersonate_user_id = $2 WHERE token_hash = $1 AND revoked_at IS NULL`,
    [tokenHash, targetUserId]
  );
}

module.exports = {
  loadUserRow,
  loadActiveRefresh,
  sessionUserPayload,
  signSessionAccess,
  assertCanImpersonate,
  listImpersonationCandidates,
  setImpersonation,
};
