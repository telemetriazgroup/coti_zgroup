require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { initSchema, pool } = require('./config/db');
const app = require('./app');
const PUBLIC_BASE_PATH = app.PUBLIC_BASE_PATH ?? '';
const storage = require('./services/storage.service');

const PORT = process.env.PORT || 3000;

async function runMigrations() {
  const dir = path.join(__dirname, 'db/migrations');
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    try {
      await pool.query(sql);
      console.log(`[DB] Migration ${f} OK`);
    } catch (err) {
      console.warn(`[DB] Migration ${f}:`, err.message);
    }
  }
}

async function start() {
  try {
    await initSchema();
    await runMigrations();
    try {
      await storage.ensureBucket();
    } catch (e) {
      console.warn('[S3] Bucket MinIO:', e.message);
    }
    try {
      const exp = require('./routes/export');
      if (exp.shouldUsePdfQueue && exp.shouldUsePdfQueue()) {
        exp.startExportWorker();
      }
    } catch (e) {
      console.warn('[EXPORT] Worker PDF:', e.message);
    }
    app.listen(PORT, () => {
      const baseLbl = PUBLIC_BASE_PATH ? `${PUBLIC_BASE_PATH}/` : '(raíz)';
      console.log(`\n╔══════════════════════════════════════════╗`);
      console.log(`║  ZGROUP Cotizaciones — Server v1.0.0     ║`);
      console.log(`║  http://localhost:${String(PORT).padEnd(26)}║`);
      console.log(`║  PUBLIC_BASE_PATH: ${baseLbl.padEnd(27)}║`);
      console.log(`║  ENV: ${(process.env.NODE_ENV || 'development').padEnd(35)}║`);
      console.log(`╚══════════════════════════════════════════╝\n`);
    });
  } catch (err) {
    console.error('[STARTUP] Fatal error:', err);
    process.exit(1);
  }
}

start();
