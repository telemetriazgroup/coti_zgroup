const OTROS_CATEGORY_NAME = 'OTROS';

function isOtrosCategory(row) {
  return String(row?.nombre || '')
    .trim()
    .toUpperCase() === OTROS_CATEGORY_NAME;
}

/** Categoría genérica para ítems huérfanos al desactivar otra categoría. */
async function ensureOtrosCategory(client) {
  const { rows } = await client.query(
    `SELECT * FROM catalog_categories WHERE UPPER(TRIM(nombre)) = $1 LIMIT 1`,
    [OTROS_CATEGORY_NAME]
  );
  if (rows[0]) {
    if (!rows[0].active) {
      await client.query(
        `UPDATE catalog_categories SET active = true, updated_at = NOW() WHERE id = $1`,
        [rows[0].id]
      );
    }
    return rows[0].id;
  }
  const { rows: so } = await client.query(
    `SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM catalog_categories`
  );
  const { rows: ins } = await client.query(
    `INSERT INTO catalog_categories (nombre, sort_order, active, default_apply_adjustment)
     VALUES ($1, $2, true, true) RETURNING id`,
    [OTROS_CATEGORY_NAME, so[0].n]
  );
  return ins[0].id;
}

async function reassignCatalogItemsToOtros(client, fromCategoryId, otrosId) {
  if (!fromCategoryId || fromCategoryId === otrosId) return 0;
  const { rowCount } = await client.query(
    `UPDATE catalog_items SET category_id = $1, updated_at = NOW() WHERE category_id = $2`,
    [otrosId, fromCategoryId]
  );
  return rowCount ?? 0;
}

/**
 * Desactiva categoría: mueve ítems activos a OTROS (no los borra ni desactiva).
 * @returns {{ moved: number, otrosId: string }}
 */
async function deactivateCatalogCategory(client, categoryId) {
  const { rows: cat } = await client.query(`SELECT * FROM catalog_categories WHERE id = $1`, [categoryId]);
  if (!cat[0]) {
    const err = new Error('Categoría no encontrada');
    err.code = 'NOT_FOUND';
    throw err;
  }
  if (isOtrosCategory(cat[0])) {
    const err = new Error('La categoría OTROS no puede desactivarse');
    err.code = 'OTROS_PROTECTED';
    throw err;
  }
  const otrosId = await ensureOtrosCategory(client);
  const moved = await reassignCatalogItemsToOtros(client, categoryId, otrosId);
  await client.query(
    `UPDATE catalog_categories SET active = false, updated_at = NOW() WHERE id = $1`,
    [categoryId]
  );
  return { moved, otrosId, categoryName: cat[0].nombre };
}

module.exports = {
  OTROS_CATEGORY_NAME,
  isOtrosCategory,
  ensureOtrosCategory,
  deactivateCatalogCategory,
};
