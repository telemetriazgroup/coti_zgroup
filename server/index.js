require('dotenv').config();
const express     = require('express');
const cors        = require('cors');
const helmet      = require('helmet');
const compression = require('compression');
const morgan      = require('morgan');
const cookieParser = require('cookie-parser');
const path        = require('path');

const { initSchema } = require('./config/db');

// ─── Rutas ──────────────────────────────────────────────────────
const authRoutes  = require('./routes/auth');
const userRoutes  = require('./routes/users');
// Sprint 1+
// const clientRoutes   = require('./routes/clients');
// const projectRoutes  = require('./routes/projects');
// Sprint 2+
// const catalogRoutes  = require('./routes/catalog');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Seguridad ──────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com", "https://fonts.googleapis.com"],
      styleSrc:   ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://fonts.gstatic.com"],
      fontSrc:    ["'self'", "https://fonts.gstatic.com"],
      imgSrc:     ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"],
    },
  },
}));

app.use(cors({
  origin:      process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
  methods:     ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ─── Middlewares generales ───────────────────────────────────────
app.use(compression());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(cookieParser());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Archivos estáticos ──────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../public')));

// ─── Rutas API ──────────────────────────────────────────────────
app.use('/api/auth',  authRoutes);
app.use('/api/users', userRoutes);
// app.use('/api/clients',  clientRoutes);
// app.use('/api/projects', projectRoutes);
// app.use('/api/catalog',  catalogRoutes);

// ─── Health check ───────────────────────────────────────────────
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

// ─── SPA fallback: todas las rutas HTML van a app.html ───────────
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Ruta no encontrada' }
    });
  }
  res.sendFile(path.join(__dirname, '../public/app.html'));
});

// ─── Error handler global ────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('[SERVER] Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: { code: 'SERVER_ERROR', message: 'Error interno del servidor' }
  });
});

// ─── Startup ─────────────────────────────────────────────────────
async function start() {
  try {
    await initSchema();
    app.listen(PORT, () => {
      console.log(`\n╔══════════════════════════════════════════╗`);
      console.log(`║  ZGROUP Cotizaciones — Server v1.0.0     ║`);
      console.log(`║  http://localhost:${PORT}                  ║`);
      console.log(`║  ENV: ${(process.env.NODE_ENV || 'development').padEnd(35)}║`);
      console.log(`╚══════════════════════════════════════════╝\n`);
    });
  } catch (err) {
    console.error('[STARTUP] Fatal error:', err);
    process.exit(1);
  }
}

start();
