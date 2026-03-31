const express = require('express');
const bcrypt  = require('bcrypt');
const crypto  = require('crypto');
const rateLimit = require('express-rate-limit');
const { pool }  = require('../config/db');
const {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  requireAuth,
} = require('../middleware/auth');

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
    `SELECT rt.id, u.id as user_id, u.email, u.role, u.active,
            e.nombres, e.apellidos, e.cargo, e.foto_url
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

  const user = rows[0];
  const accessToken = signAccessToken({
    id:    user.user_id,
    email: user.email,
    role:  user.role,
  });

  return {
    ok: true,
    data: {
      accessToken,
      user: {
        id:        user.user_id,
        email:     user.email,
        role:      user.role,
        nombres:   user.nombres,
        apellidos: user.apellidos,
        cargo:     user.cargo,
        fotoUrl:   user.foto_url,
      },
    },
  };
}

const REFRESH_ERR_MSG = {
  NO_REFRESH_TOKEN: 'Sesión expirada',
  INVALID_REFRESH_TOKEN: 'Sesión inválida',
  SESSION_EXPIRED: 'Sesión expirada. Por favor inicia sesión.',
};

// Rate limit login: por IP (req.ip respeta trust proxy si TRUST_PROXY=1). Ajustar con LOGIN_RATE_LIMIT_*.
const LOGIN_RATE_LIMIT_MAX = Math.max(1, parseInt(process.env.LOGIN_RATE_LIMIT_MAX || '5', 10) || 5);
const LOGIN_RATE_LIMIT_WINDOW_MS = Math.max(
  60_000,
  parseInt(process.env.LOGIN_RATE_LIMIT_WINDOW_MS || String(15 * 60 * 1000), 10) || 15 * 60 * 1000
);
const loginLimiter =
  process.env.NODE_ENV === 'test'
    ? (req, res, next) => next()
    : rateLimit({
        windowMs: LOGIN_RATE_LIMIT_WINDOW_MS,
        max: LOGIN_RATE_LIMIT_MAX,
        standardHeaders: true,
        legacyHeaders: false,
        message: {
          success: false,
          error: { code: 'TOO_MANY_REQUESTS', message: 'Demasiados intentos. Intenta en unos minutos.' }
        }
      });

// ─── POST /api/auth/login ───────────────────────────────────────
router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Email y contraseña requeridos' }
    });
  }

  try {
    // Buscar usuario activo
    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.password_hash, u.role, u.active,
              e.nombres, e.apellidos, e.cargo, e.foto_url
       FROM users u
       LEFT JOIN employees e ON e.user_id = u.id
       WHERE u.email = $1`,
      [email.toLowerCase().trim()]
    );

    const user = rows[0];

    if (!user || !user.active) {
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Credenciales incorrectas' }
      });
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Credenciales incorrectas' }
      });
    }

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
        user: {
          id:       user.id,
          email:    user.email,
          role:     user.role,
          nombres:  user.nombres,
          apellidos: user.apellidos,
          cargo:    user.cargo,
          fotoUrl:  user.foto_url,
        }
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

// ─── GET /api/auth/me ───────────────────────────────────────────
router.get('/me', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.role,
              e.nombres, e.apellidos, e.cargo, e.telefono, e.foto_url, e.fecha_ingreso
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
        id:        u.id,
        email:     u.email,
        role:      u.role,
        nombres:   u.nombres,
        apellidos: u.apellidos,
        cargo:     u.cargo,
        telefono:  u.telefono,
        fotoUrl:   u.foto_url,
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

module.exports = router;
