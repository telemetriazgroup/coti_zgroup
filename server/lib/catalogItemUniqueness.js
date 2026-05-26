/** Unicidad de descripción en ítems activos del catálogo. */

const { pool } = require('../config/db');

function normalizeDescriptionKey(descripcion) {
  return String(descripcion || '')
    .trim()
    .toLowerCase();
}

/**
 * @returns {Promise<{ id: string, codigo: string, descripcion: string } | null>}
 */
async function findActiveItemByDescription(descripcion, excludeItemId = null, client = null) {
  const key = normalizeDescriptionKey(descripcion);
  if (!key) return null;
  const q = client ? client.query.bind(client) : pool.query.bind(pool);
  const params = [key];
  let sql = `
    SELECT id, codigo, descripcion FROM catalog_items
    WHERE active IS NOT FALSE AND LOWER(TRIM(descripcion)) = $1`;
  if (excludeItemId) {
    sql += ` AND id != $2`;
    params.push(excludeItemId);
  }
  sql += ` LIMIT 1`;
  const { rows } = await q(sql, params);
  return rows[0] || null;
}

async function assertUniqueDescription(descripcion, excludeItemId = null, client = null) {
  const dup = await findActiveItemByDescription(descripcion, excludeItemId, client);
  if (!dup) return { ok: true };
  return {
    ok: false,
    code: 'DUPLICATE_DESCRIPTION',
    message: `Ya existe un ítem activo con la misma descripción (${dup.codigo})`,
    existing: dup,
  };
}

module.exports = {
  normalizeDescriptionKey,
  findActiveItemByDescription,
  assertUniqueDescription,
};
