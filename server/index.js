require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { initSchema, pool } = require('./config/db');
const app = require('./app');

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
