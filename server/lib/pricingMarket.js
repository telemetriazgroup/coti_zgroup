const MARKETS = ['NACIONAL', 'INTERNACIONAL'];

function db(client) {
  return client || require('../config/db').pool;
}

function normalizeMarket(m) {
  return m === 'INTERNACIONAL' ? 'INTERNACIONAL' : 'NACIONAL';
}

/**
 * Precio de catálogo según mercado del proyecto.
 * Sin dual price: nacional = internacional.
 */
function resolveUnitPrice(catalogRow, market) {
  const national = Number(catalogRow?.unit_price ?? 0);
  if (normalizeMarket(market) === 'INTERNACIONAL') {
    if (catalogRow?.has_dual_price === true && catalogRow.unit_price_intl != null) {
      return Number(catalogRow.unit_price_intl);
    }
    return national;
  }
  return national;
}

async function getUserPricingMarket(userId, client) {
  const { rows } = await db(client).query(`SELECT pricing_market FROM users WHERE id = $1`, [userId]);
  return normalizeMarket(rows[0]?.pricing_market);
}

async function getProjectQuotationMarket(projectId, client) {
  const { rows } = await db(client).query(`SELECT quotation_market FROM projects WHERE id = $1`, [projectId]);
  return normalizeMarket(rows[0]?.quotation_market);
}

/** Aplica el precio de catálogo del mercado a líneas { catalogItemId, unitPrice }. */
async function applyLinePricesForMarket(lines, market, client) {
  const list = Array.isArray(lines) ? lines : [];
  const ids = [...new Set(list.map((l) => l.catalogItemId || l.catalog_item_id).filter(Boolean))];
  if (!ids.length) return list;
  const { rows } = await db(client).query(`SELECT * FROM catalog_items WHERE id = ANY($1::uuid[])`, [ids]);
  const catMap = new Map(rows.map((c) => [c.id, c]));
  return list.map((line) => {
    const cat = catMap.get(line.catalogItemId || line.catalog_item_id);
    if (!cat) return line;
    return { ...line, unitPrice: resolveUnitPrice(cat, market) };
  });
}

/**
 * Recalcula precios de líneas de catálogo y cabeceras KIT al cambiar mercado del proyecto.
 * Piezas custom (is_custom) conservan su precio asumido.
 */
async function recalcProjectPricesForMarket(projectId, market, client) {
  const conn = db(client);
  const q = conn.query.bind(conn);
  const { applyKitDiscount } = require('./catalogKit');
  const m = normalizeMarket(market);

  const { rows: items } = await q(
    `SELECT id, catalog_item_id, is_custom
     FROM project_items WHERE project_id = $1`,
    [projectId]
  );

  const catalogIds = [
    ...new Set(items.filter((i) => i.catalog_item_id && !i.is_custom).map((i) => i.catalog_item_id)),
  ];

  if (catalogIds.length) {
    const { rows: cats } = await q(`SELECT * FROM catalog_items WHERE id = ANY($1::uuid[])`, [catalogIds]);
    const catMap = new Map(cats.map((c) => [c.id, c]));

    for (const item of items) {
      if (item.is_custom || !item.catalog_item_id) continue;
      const cat = catMap.get(item.catalog_item_id);
      if (!cat) continue;
      const price = resolveUnitPrice(cat, m);
      await q(
        `UPDATE project_items
         SET unit_price = $1, official_unit_price = $1, updated_at = NOW()
         WHERE id = $2`,
        [price, item.id]
      );
    }
  }

  const { rows: bundles } = await q(
    `SELECT id, discount_pct FROM project_item_bundles WHERE project_id = $1`,
    [projectId]
  );
  for (const b of bundles) {
    const { rows: comps } = await q(
      `SELECT unit_price, qty FROM project_items
       WHERE bundle_id = $1 AND is_bundle_component = true`,
      [b.id]
    );
    const gross =
      Math.round(comps.reduce((s, c) => s + Number(c.unit_price) * Number(c.qty), 0) * 100) / 100;
    const { net } = applyKitDiscount(gross, b.discount_pct);
    await q(`UPDATE project_item_bundles SET unit_price = $1, updated_at = NOW() WHERE id = $2`, [
      net,
      b.id,
    ]);
    await q(
      `UPDATE project_items
       SET unit_price = $1, official_unit_price = $2, updated_at = NOW()
       WHERE bundle_id = $3 AND is_bundle_header = true`,
      [net, gross, b.id]
    );
  }
}

module.exports = {
  MARKETS,
  normalizeMarket,
  resolveUnitPrice,
  getUserPricingMarket,
  getProjectQuotationMarket,
  applyLinePricesForMarket,
  recalcProjectPricesForMarket,
};
