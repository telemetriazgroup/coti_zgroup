const { pool } = require('../config/db');

const MARKETS = ['NACIONAL', 'INTERNACIONAL'];

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

async function getUserPricingMarket(userId, client = pool) {
  const { rows } = await client.query(`SELECT pricing_market FROM users WHERE id = $1`, [userId]);
  return normalizeMarket(rows[0]?.pricing_market);
}

async function getProjectQuotationMarket(projectId, client = pool) {
  const { rows } = await client.query(`SELECT quotation_market FROM projects WHERE id = $1`, [projectId]);
  return normalizeMarket(rows[0]?.quotation_market);
}

/**
 * Recalcula precios de líneas de catálogo y cabeceras KIT al cambiar mercado del proyecto.
 * Piezas custom (is_custom) conservan su precio asumido.
 */
async function recalcProjectPricesForMarket(projectId, market, client = pool) {
  const q = client.query.bind(client);
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

  const { rows: bundles } = await q(`SELECT id FROM project_item_bundles WHERE project_id = $1`, [projectId]);
  for (const b of bundles) {
    const { rows: comps } = await q(
      `SELECT unit_price, qty FROM project_items
       WHERE bundle_id = $1 AND is_bundle_component = true`,
      [b.id]
    );
    const total =
      Math.round(comps.reduce((s, c) => s + Number(c.unit_price) * Number(c.qty), 0) * 100) / 100;
    await q(`UPDATE project_item_bundles SET unit_price = $1, updated_at = NOW() WHERE id = $2`, [
      total,
      b.id,
    ]);
    await q(
      `UPDATE project_items
       SET unit_price = $1, official_unit_price = $1, updated_at = NOW()
       WHERE bundle_id = $2 AND is_bundle_header = true`,
      [total, b.id]
    );
  }
}

module.exports = {
  MARKETS,
  normalizeMarket,
  resolveUnitPrice,
  getUserPricingMarket,
  getProjectQuotationMarket,
  recalcProjectPricesForMarket,
};
