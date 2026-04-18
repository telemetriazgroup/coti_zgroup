/**
 * Import idempotente del catálogo ZGROUP (filas tipo HTML v12: code, name, cat, tipo, unit, price, detalle).
 * Unicidad BD: (category_id, codigo).
 */

const CATEGORY_SORT = {
  'Trab. Estructura': 0,
  'Sistema de Frio': 1,
  Accesorios: 2,
  Puertas: 3,
};

function buildDescripcion(it) {
  const d = it.detalle && String(it.detalle).trim();
  const base = d ? `${it.name} — ${d}` : it.name;
  return base.slice(0, 300);
}

function normalizeUnidad(u) {
  const s = String(u || 'und').trim().toUpperCase();
  return (s.slice(0, 30) || 'UND');
}

function normalizeTipo(t) {
  const u = String(t || '').toUpperCase();
  if (u.includes('CONSUM')) return 'CONSUMIBLE';
  return 'ACTIVO';
}

async function ensureCatalogCategory(client, nombre) {
  const { rows } = await client.query(
    'SELECT id FROM catalog_categories WHERE nombre = $1',
    [nombre]
  );
  if (rows.length) return { id: rows[0].id, created: false };
  const sort = CATEGORY_SORT[nombre] ?? 99;
  const ins = await client.query(
    `INSERT INTO catalog_categories (nombre, sort_order) VALUES ($1, $2) RETURNING id`,
    [nombre, sort]
  );
  return { id: ins.rows[0].id, created: true };
}

/**
 * @param {import('pg').PoolClient} client
 * @param {Array<{ code: string, name: string, cat: string, tipo?: string, unit?: string, price: number, detalle?: string }>} rows
 * @param {{ createdBy?: string | null }} [options]
 * @returns {Promise<{ inserted: number, skipped: number, categoriesCreated: number }>}
 */
async function importZgroupHtmlCatalogRows(client, rows, options = {}) {
  const createdBy = options.createdBy ?? null;
  let inserted = 0;
  let skipped = 0;
  let categoriesCreated = 0;

  for (const it of rows) {
    const codigo = it.code;
    if (!codigo || !it.cat) continue;

    const { id: categoryId, created: catCreated } = await ensureCatalogCategory(client, it.cat);
    if (catCreated) categoriesCreated++;

    const { rows: ex } = await client.query(
      `SELECT id FROM catalog_items WHERE category_id = $1 AND codigo = $2`,
      [categoryId, codigo]
    );
    if (ex.length) {
      skipped++;
      continue;
    }

    const { rows: so } = await client.query(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM catalog_items WHERE category_id = $1`,
      [categoryId]
    );

    await client.query(
      `INSERT INTO catalog_items
        (category_id, codigo, descripcion, unidad, tipo, unit_price, sort_order, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        categoryId,
        codigo,
        buildDescripcion(it),
        normalizeUnidad(it.unit),
        normalizeTipo(it.tipo),
        it.price,
        so[0].n,
        createdBy,
      ]
    );
    inserted++;
  }

  return { inserted, skipped, categoriesCreated };
}

module.exports = {
  importZgroupHtmlCatalogRows,
  buildDescripcion,
  normalizeUnidad,
  normalizeTipo,
  ensureCatalogCategory,
};
