/**
 * Añade al catálogo los ítems del HTML v12 (55 filas EST/FRI/ACC/PTA).
 * Idempotente: si ya existe la pareja (categoría + codigo), no inserta.
 *
 * Uso: node server/db/seed-v12-catalog.js
 * Requiere: PostgreSQL con schema aplicado, .env con credenciales.
 */

require('dotenv').config();
const { pool } = require('../config/db');
const CATALOG_V12 = require('./catalog-v12-html');
const { importZgroupHtmlCatalogRows } = require('../lib/catalogV12Import');
const { invalidateCatalogCache } = require('../lib/catalogRedis');

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: adm } = await client.query(
      `SELECT id FROM users WHERE role = 'ADMIN' ORDER BY created_at ASC LIMIT 1`
    );
    const createdBy = adm[0]?.id ?? null;

    const stats = await importZgroupHtmlCatalogRows(client, CATALOG_V12, { createdBy });

    await client.query('COMMIT');
    console.log(
      `Catálogo v12: ${stats.inserted} insertados, ${stats.skipped} ya existían, ` +
        `${stats.categoriesCreated} categorías nuevas.`
    );
    await invalidateCatalogCache();
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('seed-v12-catalog:', err.message);
    process.exitCode = 1;
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(() => process.exit(1));
