const jwt = require('jsonwebtoken');
const { runWithRequestContext } = require('../lib/requestContext');

/**
 * Middleware: verifica el JWT access token en el header Authorization.
 * Adjunta req.user = { id, email, role } si es válido.
 * Si hay virtualización, req.user es el usuario efectivo y req.impersonator el superadmin.
 */
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Token requerido' }
    });
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    req.user = {
      id:    payload.sub,
      email: payload.email,
      role:  payload.role,
    };
    if (payload.imp) {
      req.impersonator = {
        id: payload.imp,
        email: payload.impEmail || null,
        role: 'SUPERUSER',
      };
      req.user.impersonator = req.impersonator;
    }
    const ctx = {
      effectiveUserId: req.user.id,
      impersonatorId: req.impersonator?.id || null,
    };
    runWithRequestContext(ctx, () => next());
  } catch (err) {
    const code = err.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID';
    return res.status(401).json({
      success: false,
      error: { code, message: 'Token inválido o expirado' }
    });
  }
}

/**
 * Factory: genera un middleware que verifica que req.user.role
 * sea uno de los roles permitidos.
 *
 * Uso: requireRole('ADMIN', 'COMERCIAL')
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'No autenticado' }
      });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: `Acceso restringido. Roles permitidos: ${roles.join(', ')}`
        }
      });
    }
    next();
  };
}

/**
 * Genera un JWT access token de corta duración.
 */
function signAccessToken(user, extra = {}) {
  const payload = { sub: user.id, email: user.email, role: user.role };
  if (extra.impersonatorId) {
    payload.imp = extra.impersonatorId;
    if (extra.impersonatorEmail) payload.impEmail = extra.impersonatorEmail;
  }
  return jwt.sign(
    payload,
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: process.env.JWT_ACCESS_EXPIRES || '15m' }
  );
}

/**
 * Genera un JWT refresh token de larga duración.
 */
function signRefreshToken(user) {
  return jwt.sign(
    { sub: user.id },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES || '7d' }
  );
}

/**
 * Verifica un refresh token y retorna el payload o null.
 */
function verifyRefreshToken(token) {
  try {
    return jwt.verify(token, process.env.JWT_REFRESH_SECRET);
  } catch {
    return null;
  }
}

module.exports = {
  requireAuth,
  requireRole,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
};
