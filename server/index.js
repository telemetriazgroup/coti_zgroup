require('dotenv').config();
const { initSchema } = require('./config/db');
const app = require('./app');

const PORT = process.env.PORT || 3000;

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
