#!/usr/bin/env node
/**
 * Una corrida de pull incremental (etapa 3). No requiere ODOO_SYNC_ENABLED=1.
 *
 *   node server/scripts/odoo-sync.js
 *   node server/scripts/odoo-sync.js --project
 *   node server/scripts/odoo-sync.js --reconcile
 */

const fs = require('fs');
const path = require('path');

function loadDotEnvFile() {
  const envPath = path.join(__dirname, '../../.env');
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] == null || process.env[key] === '') process.env[key] = val;
  }
}

loadDotEnvFile();

async function main() {
  const { initSchema, pool } = require('../config/db');
  await initSchema();
  const migDir = path.join(__dirname, '../db/migrations');
  for (const f of fs.readdirSync(migDir).filter((n) => n.endsWith('.sql')).sort()) {
    try {
      await pool.query(fs.readFileSync(path.join(migDir, f), 'utf8'));
    } catch (err) {
      console.warn('[DB]', f, err.message);
    }
  }

  const { runIncrementalPull, runReconcileDeletes, getSyncHealth } = require('../lib/odoo/pullPartners');
  const { projectEligibleClients } = require('../lib/odoo/projectClients');
  if (process.argv.includes('--reconcile')) {
    const r = await runReconcileDeletes({ holder: 'cli-reconcile' });
    console.log(JSON.stringify(r, null, 2));
  } else if (process.argv.includes('--project')) {
    const r = await projectEligibleClients();
    console.log(JSON.stringify({ ...r, link: { ...r.link, ambiguous: r.link?.ambiguous?.slice(0, 20) } }, null, 2));
  } else {
    const r = await runIncrementalPull({ force: true, holder: 'cli-pull' });
    console.log(JSON.stringify(r, null, 2));
  }
  const health = await getSyncHealth();
  console.log('health.counts', health.counts, 'watermark', health.state && health.state.watermark);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
