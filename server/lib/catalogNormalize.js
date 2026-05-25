/** Normaliza valores booleanos (BD, caché, edición manual en explorador). */
function normalizeBool(val, defaultValue = true) {
  if (val === true || val === false) return val;
  if (val == null || val === '') return defaultValue;
  const s = String(val).trim().toLowerCase();
  if (['true', 't', '1', 'yes', 'si', 'sí', 'activo', 'active'].includes(s)) return true;
  if (['false', 'f', '0', 'no', 'inactivo', 'inactive'].includes(s)) return false;
  return defaultValue;
}

/**
 * Corrige flags active en categorías e ítems si difieren del booleano esperado.
 * Reactiva ítems inactivos cuya categoría está activa (recuperación tras desactivación antigua).
 * @returns {{ categoriesFixed: number, itemsFixed: number, itemsReactivated: number }}
 */
async function regularizeCatalogActiveFlags(client) {
  const q = client.query.bind(client);
  let categoriesFixed = 0;
  let itemsFixed = 0;

  const { rows: cats } = await q(`SELECT id, active FROM catalog_categories`);
  for (const row of cats) {
    const norm = normalizeBool(row.active, true);
    if (row.active !== norm) {
      await q(`UPDATE catalog_categories SET active = $1, updated_at = NOW() WHERE id = $2`, [norm, row.id]);
      categoriesFixed += 1;
    }
  }

  const { rows: items } = await q(`SELECT id, active FROM catalog_items`);
  for (const row of items) {
    const norm = normalizeBool(row.active, true);
    if (row.active !== norm) {
      await q(`UPDATE catalog_items SET active = $1, updated_at = NOW() WHERE id = $2`, [norm, row.id]);
      itemsFixed += 1;
    }
  }

  const { rowCount: itemsReactivated } = await q(
    `UPDATE catalog_items i SET active = true, updated_at = NOW()
     FROM catalog_categories c
     WHERE i.category_id = c.id AND c.active IS TRUE AND i.active IS NOT TRUE`
  );

  return {
    categoriesFixed,
    itemsFixed,
    itemsReactivated: rowCount ?? 0,
  };
}

module.exports = { normalizeBool, regularizeCatalogActiveFlags };
