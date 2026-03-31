const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const path = require('path');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');

const app = express();

const PORT = parseInt(process.env.PORT || '3000', 10);

/** Orígenes permitidos (CORS con credentials): localhost y 127.0.0.1 no son el mismo origen. */
function buildAllowedOrigins() {
  const set = new Set([
    `http://localhost:${PORT}`,
    `http://127.0.0.1:${PORT}`,
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ]);
  const fromEnv = (process.env.FRONTEND_URL || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  fromEnv.forEach((o) => set.add(o));
  return set;
}

const allowedOrigins = buildAllowedOrigins();

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // unsafe-eval: algunas herramientas de desarrollo / Tailwind CDN (HTML de referencia) usan eval
      scriptSrc:  ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.tailwindcss.com", "https://fonts.googleapis.com"],
      styleSrc:   ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://fonts.gstatic.com"],
      fontSrc:    ["'self'", "https://fonts.gstatic.com"],
      imgSrc:     ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"],
    },
  },
}));

app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.has(origin)) return callback(null, true);
    callback(null, false);
  },
  credentials: true,
  methods:     ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(compression());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(cookieParser());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

const clientDist = path.join(__dirname, '../client/dist');
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(clientDist));
}

app.use('/api/auth',  authRoutes);
app.use('/api/users', userRoutes);

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    data: {
      status:  'ok',
      version: '1.0.0',
      env:     process.env.NODE_ENV || 'development',
      ts:      new Date().toISOString(),
    }
  });
});

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Ruta no encontrada' }
    });
  }
  if (process.env.NODE_ENV === 'production') {
    return res.sendFile(path.join(clientDist, 'index.html'));
  }
  res
    .status(503)
    .type('html')
    .send(
      '<!DOCTYPE html><html><body style="font-family:system-ui;padding:2rem;background:#121212;color:#eee">' +
        '<p>API en modo desarrollo. Usa el front en <strong>http://localhost:5173</strong> (Vite).</p>' +
        '<p>Health: <a href="/api/health" style="color:#00E5FF">/api/health</a></p></body></html>'
    );
});

app.use((err, req, res, _next) => {
  console.error('[SERVER] Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: { code: 'SERVER_ERROR', message: 'Error interno del servidor' }
  });
});

module.exports = app;
