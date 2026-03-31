const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const path = require('path');
const { normalizePublicBasePath } = require('./lib/publicPath');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const employeeRoutes = require('./routes/employees');
const clientRoutes = require('./routes/clients');
const projectItemRoutes = require('./routes/projectItems');
const projectRoutes = require('./routes/projects');
const dashboardRoutes = require('./routes/dashboard');
const catalogRoutes = require('./routes/catalog');
const planRoutes = require('./routes/plans');
const exportRoutes = require('./routes/export');

const app = express();

const PORT = parseInt(process.env.PORT || '3000', 10);
const PUBLIC_BASE_PATH = normalizePublicBasePath(process.env.PUBLIC_BASE_PATH || '');

/** Orígenes permitidos (CORS con credentials): localhost y 127.0.0.1 no son el mismo origen. */
function buildAllowedOrigins() {
  const set = new Set([
    `http://localhost:${PORT}`,
    `http://127.0.0.1:${PORT}`,
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ]);
  const mergeList = (raw) =>
    (raw || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  mergeList(process.env.FRONTEND_URL).forEach((o) => set.add(o));
  mergeList(process.env.ALLOWED_ORIGINS).forEach((o) => set.add(o));
  return set;
}

/**
 * En HTTP sobre IP pública, Helmet (COOP/COEP) genera avisos y el navegador las ignora.
 * Activa RELAX_HELMET_HTTP=1 en despliegues sin HTTPS (o detrás de proxy que termina TLS).
 */
function useRelaxedHelmet() {
  const v = String(process.env.RELAX_HELMET_HTTP || '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

const allowedOrigins = buildAllowedOrigins();

if (String(process.env.TRUST_PROXY || '').toLowerCase() === '1' || process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}

function s3OriginsForCsp() {
  const extra = [];
  const u = process.env.S3_PUBLIC_ENDPOINT || process.env.S3_ENDPOINT || '';
  if (u) {
    try {
      extra.push(new URL(u).origin);
    } catch {
      /* ignore */
    }
  }
  return extra;
}

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          "'unsafe-eval'",
          'https://cdn.tailwindcss.com',
          'https://fonts.googleapis.com',
        ],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'blob:', ...s3OriginsForCsp()],
        frameSrc: ["'self'", 'blob:', ...s3OriginsForCsp()],
        connectSrc: ["'self'"],
      },
    },
    originAgentCluster: false,
    ...(useRelaxedHelmet()
      ? {
          crossOriginOpenerPolicy: false,
          crossOriginEmbedderPolicy: false,
        }
      : {}),
  })
);

app.use((req, res, next) => {
  res.setHeader('Origin-Agent-Cluster', '?0');
  next();
});

app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.has(origin)) return callback(null, true);
    callback(null, false);
  },
  credentials: true,
  methods:     ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(compression());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(cookieParser());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

const clientDist = path.join(__dirname, '../client/dist');

/** Rutas SPA + API bajo el mismo prefijo (vacío = raíz). */
const web = express.Router();

if (process.env.NODE_ENV === 'production') {
  web.use(express.static(clientDist, { index: false, maxAge: '1y' }));
}

web.use('/api/auth', authRoutes);
web.use('/api/users', userRoutes);
web.use('/api/employees', employeeRoutes);
web.use('/api/clients', clientRoutes);
web.use('/api/projects', projectItemRoutes);
web.use('/api/projects', planRoutes);
web.use('/api/projects', projectRoutes);
web.use('/api/dashboard', dashboardRoutes);
web.use('/api/catalog', catalogRoutes);
web.use('/api/export', exportRoutes);

web.get('/api/health', (req, res) => {
  res.json({
    success: true,
    data: {
      status:  'ok',
      version: '1.0.0',
      env:     process.env.NODE_ENV || 'development',
      publicBasePath: PUBLIC_BASE_PATH || '/',
      ts:      new Date().toISOString(),
    },
  });
});

web.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Ruta no encontrada' },
    });
  }
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    return res.sendFile(path.join(clientDist, 'index.html'), { etag: false });
  }
  const healthPath = `${PUBLIC_BASE_PATH || ''}/api/health`.replace(/\/{2,}/g, '/');
  res
    .status(503)
    .type('html')
    .send(
      '<!DOCTYPE html><html><body style="font-family:system-ui;padding:2rem;background:#121212;color:#eee">' +
        '<p>API en modo desarrollo. Usa el front en <strong>http://localhost:5173</strong> (Vite).</p>' +
        `<p>Health: <a href="${healthPath}" style="color:#00E5FF">${healthPath}</a></p></body></html>`
    );
});

app.use(PUBLIC_BASE_PATH || '/', web);

app.use((err, req, res, _next) => {
  console.error('[SERVER] Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: { code: 'SERVER_ERROR', message: 'Error interno del servidor' },
  });
});

module.exports = app;
module.exports.PUBLIC_BASE_PATH = PUBLIC_BASE_PATH;
