const express = require('express');
const bcrypt  = require('bcrypt');
const crypto  = require('crypto');
const { body, validationResult } = require('express-validator');
const { pool }  = require('../config/db');
const {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  requireAuth,
} = require('../middleware/auth');
const { mapAuthUser, AUTH_USER_SELECT } = require('../lib/userProfile');
const {
  checkLoginLockout,
  recordFailedLogin,
  clearLoginLockout,
  normalizeLoginEmail,
} = require('../lib/loginLockout');
const {
  loadUserRow,
  loadActiveRefresh,
  sessionUserPayload,
  signSessionAccess,
  assertCanImpersonate,
  listImpersonationCandidates,
  setImpersonation,
} = require('../lib/impersonation');

const router = express.Router();

/**
 * Intenta emitir un access token a partir de la cookie refresh.
 * @returns {{ ok: true, data: { accessToken, user } } | { ok: false, err: string }}
 */
async function resolveRefresh(req) {
  const refreshToken = req.cookies?.refreshToken;
  if (!refreshToken) {
    return { ok: false, err: 'NO_REFRESH_TOKEN' };
  }

  const payload = verifyRefreshToken(refreshToken);
  if (!payload) {
    return { ok: false, err: 'INVALID_REFRESH_TOKEN' };
  }

  const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

  const { rows } = await pool.query(
    `SELECT rt.id, rt.user_id, rt.impersonate_user_id, ${AUTH_USER_SELECT.replace(/\n/g, ' ')}
     FROM refresh_tokens rt
     JOIN users u ON u.id = rt.user_id
     LEFT JOIN employees e ON e.user_id = u.id
     WHERE rt.token_hash = $1
       AND rt.revoked_at IS NULL
       AND rt.expires_at > NOW()`,
    [tokenHash]
  );

  if (!rows[0] || !rows[0].active) {
    return { ok: false, err: 'SESSION_EXPIRED' };
  }

  const owner = rows[0];
  let effective = owner;
  if (owner.impersonate_user_id) {
    const target = await loadUserRow(owner.impersonate_user_id);
    if (target && target.active) {
      effective = target;
    } else {
      await setImpersonation(tokenHash, null);
    }
  }

  const accessToken = signSessionAccess(effective, owner);

  return {
    ok: true,
    data: {
      accessToken,
      user: sessionUserPayload(effective, owner),
    },
  };
}

const REFRESH_ERR_MSG = {
  NO_REFRESH_TOKEN: 'Sesión expirada',
  INVALID_REFRESH_TOKEN: 'Sesión inválida',
  SESSION_EXPIRED: 'Sesión expirada. Por favor inicia sesión.',
};

// ─── POST /api/auth/login ───────────────────────────────────────
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Email y contraseña requeridos' }
    });
  }

  const emailNorm = normalizeLoginEmail(email);

  try {
    const lock = await checkLoginLockout(emailNorm);
    if (lock.locked) {
      return res.status(429).json({
        success: false,
        error: {
          code: 'TOO_MANY_REQUESTS',
          message: lock.message,
          retryAfterMs: lock.retryAfterMs,
        },
      });
    }

    // Buscar usuario activo
    const { rows } = await pool.query(
      `SELECT u.password_hash, ${AUTH_USER_SELECT.replace(/\n/g, ' ')}
       FROM users u
       LEFT JOIN employees e ON e.user_id = u.id
       WHERE u.email = $1`,
      [emailNorm]
    );

    const user = rows[0];

    if (!user || !user.active) {
      await recordFailedLogin(emailNorm, null);
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Credenciales incorrectas' }
      });
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      const fail = await recordFailedLogin(emailNorm, user.id);
      if (fail.locked) {
        return res.status(429).json({
          success: false,
          error: {
            code: 'TOO_MANY_REQUESTS',
            message: fail.message,
            retryAfterMs: fail.retryAfterMs,
          },
        });
      }
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Credenciales incorrectas' }
      });
    }

    await clearLoginLockout(emailNorm);

    // Generar tokens
    const accessToken  = signAccessToken(user);
    const refreshToken = signRefreshToken(user);

    // Guardar hash del refresh token en BD
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7d

    await pool.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5)`,
      [user.id, tokenHash, expiresAt, req.ip, req.get('user-agent')]
    );

    // Cookie: path '/' para que el navegador la envíe en toda la app; lax evita problemas con redirecciones
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure:   process.env.COOKIE_SECURE === 'true',
      sameSite: 'lax',
      maxAge:   7 * 24 * 60 * 60 * 1000,
      path:     '/',
    });

    return res.json({
      success: true,
      data: {
        accessToken,
        user: mapAuthUser(user),
      }
    });

  } catch (err) {
    console.error('[AUTH] Login error:', err);
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Error interno del servidor' }
    });
  }
});

// ─── GET /api/auth/session ────────────────────────────────────
// Comprueba sesión sin devolver 401 (evita ruido en consola del navegador en login).
router.get('/session', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  try {
    const r = await resolveRefresh(req);
    if (!r.ok) {
      return res.json({ success: true, data: { authenticated: false } });
    }
    return res.json({
      success: true,
      data: {
        authenticated: true,
        accessToken: r.data.accessToken,
        user:        r.data.user,
      },
    });
  } catch (err) {
    console.error('[AUTH] Session error:', err);
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Error interno' }
    });
  }
});

// ─── POST /api/auth/refresh ─────────────────────────────────────
router.post('/refresh', async (req, res) => {
  try {
    const r = await resolveRefresh(req);
    if (!r.ok) {
      return res.status(401).json({
        success: false,
        error: {
          code:    r.err,
          message: REFRESH_ERR_MSG[r.err] || 'Sesión inválida',
        }
      });
    }
    return res.json({ success: true, data: r.data });
  } catch (err) {
    console.error('[AUTH] Refresh error:', err);
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Error interno' }
    });
  }
});

// ─── POST /api/auth/logout ──────────────────────────────────────
router.post('/logout', requireAuth, async (req, res) => {
  const refreshToken = req.cookies?.refreshToken;

  if (refreshToken) {
    try {
      const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
      await pool.query(
        `UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1`,
        [tokenHash]
      );
    } catch (err) {
      console.error('[AUTH] Logout revoke error:', err.message);
    }
  }

  res.clearCookie('refreshToken', { path: '/' });
  res.clearCookie('refreshToken', { path: '/api/auth' });
  return res.json({ success: true, data: { message: 'Sesión cerrada correctamente' } });
});

async function requireSuperuserRefresh(req, res) {
  const session = await loadActiveRefresh(req);
  if (!session || session.owner.role !== 'SUPERUSER') {
    res.status(403).json({
      success: false,
      error: { code: 'FORBIDDEN', message: 'Se requiere sesión de superadmin' },
    });
    return null;
  }
  return session;
}

// ─── GET /api/auth/impersonate/candidates ───────────────────────
router.get('/impersonate/candidates', requireAuth, async (req, res) => {
  try {
    const session = await requireSuperuserRefresh(req, res);
    if (!session) return;
    const data = await listImpersonationCandidates(session.owner.id);
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[AUTH] impersonate candidates:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// ─── POST /api/auth/impersonate ─────────────────────────────────
router.post('/impersonate', requireAuth, async (req, res) => {
  try {
    const session = await requireSuperuserRefresh(req, res);
    if (!session) return;
    const targetId = req.body?.userId;
    if (!targetId) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'userId requerido' },
      });
    }
    const target = await loadUserRow(targetId);
    assertCanImpersonate(session.owner, target);
    await setImpersonation(session.tokenHash, target.id);
    const accessToken = signSessionAccess(target, session.owner);
    return res.json({
      success: true,
      data: {
        accessToken,
        user: sessionUserPayload(target, session.owner),
      },
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({
        success: false,
        error: { code: err.code || 'FORBIDDEN', message: err.message },
      });
    }
    console.error('[AUTH] impersonate:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// ─── POST /api/auth/impersonate/stop ────────────────────────────
router.post('/impersonate/stop', requireAuth, async (req, res) => {
  try {
    const session = await requireSuperuserRefresh(req, res);
    if (!session) return;
    await setImpersonation(session.tokenHash, null);
    const accessToken = signSessionAccess(session.owner, session.owner);
    return res.json({
      success: true,
      data: {
        accessToken,
        user: sessionUserPayload(session.owner, session.owner),
      },
    });
  } catch (err) {
    console.error('[AUTH] impersonate stop:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// ─── GET /api/auth/me ───────────────────────────────────────────
router.get('/me', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${AUTH_USER_SELECT.replace(/\n/g, ' ')}
       FROM users u
       LEFT JOIN employees e ON e.user_id = u.id
       WHERE u.id = $1 AND u.active = true`,
      [req.user.id]
    );

    if (!rows[0]) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Usuario no encontrado' }
      });
    }

    const u = rows[0];
    return res.json({
      success: true,
      data: {
        ...mapAuthUser(u),
        telefono: u.telefono,
        dni: u.dni,
        fechaIngreso: u.fecha_ingreso,
      }
    });
  } catch (err) {
    console.error('[AUTH] Me error:', err);
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Error interno' }
    });
  }
});

// ─── PUT /api/auth/me — actualizar datos personales ─────────────
router.put('/me', requireAuth, async (req, res) => {
  const { nombres, apellidos, cargo, telefono, dni } = req.body || {};

  try {
    if (req.impersonator) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'IMPERSONATING',
          message: 'No se puede editar el perfil mientras virtualiza a otro usuario',
        },
      });
    }
    const { rows: emp } = await pool.query(`SELECT user_id FROM employees WHERE user_id = $1`, [req.user.id]);

    if (emp.length) {
      await pool.query(
        `UPDATE employees SET
           nombres = COALESCE($1, nombres),
           apellidos = COALESCE($2, apellidos),
           cargo = COALESCE($3, cargo),
           telefono = COALESCE($4, telefono),
           dni = COALESCE($5, dni),
           updated_at = NOW()
         WHERE user_id = $6`,
        [
          nombres?.trim() || null,
          apellidos?.trim() || null,
          cargo?.trim() || null,
          telefono?.trim() || null,
          dni?.trim() || null,
          req.user.id,
        ]
      );
    } else if (nombres?.trim() && apellidos?.trim()) {
      await pool.query(
        `INSERT INTO employees (user_id, nombres, apellidos, cargo, telefono, dni)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          req.user.id,
          nombres.trim(),
          apellidos.trim(),
          cargo?.trim() || null,
          telefono?.trim() || null,
          dni?.trim() || null,
        ]
      );
    }

    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.role,
              e.nombres, e.apellidos, e.cargo, e.telefono, e.dni, e.foto_url, e.fecha_ingreso
       FROM users u
       LEFT JOIN employees e ON e.user_id = u.id
       WHERE u.id = $1`,
      [req.user.id]
    );

    const u = rows[0];
    return res.json({
      success: true,
      data: {
        id: u.id,
        email: u.email,
        role: u.role,
        nombres: u.nombres,
        apellidos: u.apellidos,
        cargo: u.cargo,
        telefono: u.telefono,
        dni: u.dni,
        fotoUrl: u.foto_url,
        fechaIngreso: u.fecha_ingreso,
      },
    });
  } catch (err) {
    console.error('[AUTH] Update me error:', err);
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Error interno' },
    });
  }
});

// ─── PUT /api/auth/me/password — cambio seguro de contraseña ────
router.put(
  '/me/password',
  requireAuth,
  [
    body('currentPassword').notEmpty().withMessage('Contraseña actual requerida'),
    body('newPassword').isLength({ min: 8 }).withMessage('La nueva contraseña debe tener al menos 8 caracteres'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: errors.array()[0].msg },
      });
    }

    const { currentPassword, newPassword } = req.body;
    if (req.impersonator) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'IMPERSONATING',
          message: 'No se puede cambiar la contraseña mientras virtualiza a otro usuario',
        },
      });
    }
    if (currentPassword === newPassword) {
      return res.status(400).json({
        success: false,
        error: { code: 'SAME_PASSWORD', message: 'La nueva contraseña debe ser distinta a la actual' },
      });
    }

    try {
      const { rows } = await pool.query(`SELECT password_hash FROM users WHERE id = $1 AND active = true`, [
        req.user.id,
      ]);
      if (!rows[0]) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Usuario no encontrado' },
        });
      }

      const ok = await bcrypt.compare(currentPassword, rows[0].password_hash);
      if (!ok) {
        return res.status(401).json({
          success: false,
          error: { code: 'INVALID_PASSWORD', message: 'Contraseña actual incorrecta' },
        });
      }

      const passwordHash = await bcrypt.hash(newPassword, 12);
      await pool.query(`UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`, [
        passwordHash,
        req.user.id,
      ]);

      return res.json({ success: true, data: { message: 'Contraseña actualizada' } });
    } catch (err) {
      console.error('[AUTH] Change password error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Error interno' },
      });
    }
  }
);

module.exports = router;
