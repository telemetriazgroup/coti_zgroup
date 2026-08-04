/** KIT / Productos finales — precio rollup y plantilla para presupuesto. */

const { pool } = require('../config/db');
const { fetchDirectDependencies } = require('./catalogItemDependencies');

async function fetchItemWithCategory(itemId, client = null) {
  const q = client ? client.query.bind(client) : pool.query.bind(pool);
  const { rows } = await q(
    `SELECT i.*, c.is_kit_category, c.nombre AS category_nombre
     FROM catalog_items i
     INNER JOIN catalog_categories c ON c.id = i.category_id
     WHERE i.id = $1`,
    [itemId]
  );
  return rows[0] || null;
}

async function isKitItem(catalogItemId, client = null) {
  const row = await fetchItemWithCategory(catalogItemId, client);
  return !!(row && row.is_kit_category);
}

async function isKitCategory(categoryId, client = null) {
  const q = client ? client.query.bind(client) : pool.query.bind(pool);
  const { rows } = await q(`SELECT is_kit_category FROM catalog_categories WHERE id = $1`, [categoryId]);
  return rows[0]?.is_kit_category === true;
}

async function computeKitCatalogPrice(parentItemId, client = null) {
  const deps = await fetchDirectDependencies(parentItemId, client);
  let total = 0;
  for (const dep of deps) {
    const price = dep.child?.unitPrice != null ? Number(dep.child.unitPrice) : 0;
    total += Number(dep.qty) * price;
  }
  return Math.round(total * 100) / 100;
}

async function recalcKitItemPrice(parentItemId, client = null) {
  const q = client ? client.query.bind(client) : pool.query.bind(pool);
  const item = await fetchItemWithCategory(parentItemId, client);
  if (!item?.is_kit_category) return null;
  const price = await computeKitCatalogPrice(parentItemId, client);
  await q(`UPDATE catalog_items SET unit_price = $1, updated_at = NOW() WHERE id = $2`, [price, parentItemId]);
  return price;
}

async function assertKitDependencies(parentItemId, client = null) {
  const item = await fetchItemWithCategory(parentItemId, client);
  if (!item?.is_kit_category) return { ok: true };
  const deps = await fetchDirectDependencies(parentItemId, client);
  if (deps.length < 1) {
    return {
      ok: false,
      code: 'KIT_NEEDS_COMPONENTS',
      message: 'Un producto final (KIT) debe tener al menos un componente en catálogo',
    };
  }
  return { ok: true };
}

function buildDisplayName(baseDesc, instanceLabel) {
  const base = String(baseDesc || '').trim();
  const label = String(instanceLabel || '').trim();
  if (!label) return base;
  if (!base) return label;
  return `${label} - ${base}`;
}

/**
 * Plantilla para modal de instancia KIT en presupuesto.
 * @param {string} catalogItemId
 * @param {number} rootQty
 */
async function resolveKitTemplate(catalogItemId, rootQty = 1, client = null) {
  const item = await fetchItemWithCategory(catalogItemId, client);
  if (!item) return null;
  if (!item.is_kit_category) {
    const err = new Error('El ítem no pertenece a una categoría KIT');
    err.code = 'NOT_KIT_ITEM';
    throw err;
  }

  const deps = await fetchDirectDependencies(catalogItemId, client);
  const qtyMain = Math.max(0.001, Number(rootQty) || 1);

  const lines = deps.map((dep) => ({
    catalogItemId: dep.childItemId,
    codigo: dep.child?.codigo || '',
    descripcion: dep.child?.descripcion || '',
    unidad: dep.child?.unidad || 'UND',
    tipo: dep.child?.tipo || 'ACTIVO',
    unitPrice: dep.child?.unitPrice != null ? Number(dep.child.unitPrice) : 0,
    qtyPerMain: Number(dep.qty) || 1,
    qty: Math.round(Number(dep.qty) * qtyMain * 1000) / 1000,
    included: false,
    fromTemplate: true,
    componentGroupKey: 'template',
    componentGroupLabel: null,
    componentGroupSort: 0,
  }));

  const templatePrice = lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);

  return {
    catalogItemId,
    codigo: item.codigo,
    descripcion: item.descripcion,
    kitBaseDesc: item.descripcion,
    unidad: item.unidad,
    tipo: item.tipo,
    categoryId: item.category_id,
    categoryNombre: item.category_nombre,
    mainQty: qtyMain,
    templatePrice: Math.round(templatePrice * 100) / 100,
    lines,
  };
}

function computeLinesTotal(lines) {
  return Math.round(
    lines
      .filter((l) => l.included !== false)
      .reduce((s, l) => s + Number(l.qty) * Number(l.unitPrice), 0) * 100
  ) / 100;
}

module.exports = {
  fetchItemWithCategory,
  isKitItem,
  isKitCategory,
  computeKitCatalogPrice,
  recalcKitItemPrice,
  assertKitDependencies,
  buildDisplayName,
  resolveKitTemplate,
  computeLinesTotal,
};
