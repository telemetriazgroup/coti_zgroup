/** Instancias de conjunto KIT en presupuesto de proyecto. */

const { pool } = require('../config/db');
const { logAuditEvent } = require('../middleware/audit');
const {
  isKitItem,
  buildDisplayName,
  computeLinesTotal,
  fetchItemWithCategory,
} = require('./catalogKit');

async function suggestNextInstanceLabel(projectId, catalogItemId, client = null) {
  const q = client ? client.query.bind(client) : pool.query.bind(pool);
  const { rows } = await q(
    `SELECT COUNT(*)::int AS n FROM project_item_bundles
     WHERE project_id = $1 AND catalog_item_id = $2`,
    [projectId, catalogItemId]
  );
  const n = (rows[0]?.n || 0) + 1;
  return String(n);
}

async function resolveDefaultApplyAdjustment(client, categoryId) {
  if (!categoryId) return true;
  const { rows } = await client.query(
    `SELECT default_apply_adjustment FROM catalog_categories WHERE id = $1`,
    [categoryId]
  );
  return rows[0]?.default_apply_adjustment !== false;
}

/**
 * @param {import('pg').PoolClient} client
 */
async function createProjectBundle(
  client,
  { projectId, userId, catalogItemId, instanceLabel, displayName, qty, lines, ip }
) {
  const kit = await fetchItemWithCategory(catalogItemId, client);
  if (!kit?.is_kit_category) {
    return { errorCode: 'NOT_KIT_ITEM', message: 'El ítem no es un producto final (KIT)' };
  }

  const included = (lines || []).filter((l) => l.included !== false && l.catalogItemId);
  if (included.length < 1) {
    return { errorCode: 'KIT_EMPTY', message: 'Seleccione al menos un componente para el conjunto' };
  }

  const label = String(instanceLabel || '').trim() || '1';
  const name = String(displayName || '').trim() || buildDisplayName(kit.descripcion, label);
  const bundleQty = Math.max(0.001, Number(qty) || 1);
  const unitPrice = computeLinesTotal(included);

  const { rows: bundleSort } = await client.query(
    `SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM project_item_bundles WHERE project_id = $1`,
    [projectId]
  );

  const { rows: bundleIns } = await client.query(
    `INSERT INTO project_item_bundles
      (project_id, catalog_item_id, instance_label, display_name, unit_price, qty, sort_order, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [projectId, catalogItemId, label, name, unitPrice, bundleQty, bundleSort[0].n, userId]
  );
  const bundle = bundleIns[0];

  const { rows: lineSort } = await client.query(
    `SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM project_items WHERE project_id = $1`,
    [projectId]
  );
  let sortOrder = lineSort[0].n;
  const applyAdjustment = await resolveDefaultApplyAdjustment(client, kit.category_id);
  const listPrice = Number(kit.unit_price);

  const { rows: headerIns } = await client.query(
    `INSERT INTO project_items
      (project_id, catalog_item_id, codigo, descripcion, unidad, tipo, unit_price, official_unit_price,
       qty, is_custom, sort_order, category_id, apply_adjustment, created_by,
       bundle_id, is_bundle_header, is_bundle_component)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false, $10, $11, $12, $13, $14, true, false)
     RETURNING id`,
    [
      projectId,
      catalogItemId,
      kit.codigo,
      name,
      kit.unidad,
      kit.tipo,
      unitPrice,
      listPrice,
      bundleQty,
      sortOrder++,
      kit.category_id,
      applyAdjustment,
      userId,
      bundle.id,
    ]
  );

  const componentIds = [];
  for (const line of included) {
    const { rows: compRows } = await client.query(
      `SELECT * FROM catalog_items WHERE id = $1 AND active = true`,
      [line.catalogItemId]
    );
    const comp = compRows[0];
    if (!comp) {
      return { errorCode: 'INVALID_COMPONENT', message: 'Componente de catálogo no válido' };
    }
    const cQty = Math.max(0.001, Number(line.qty) || 0);
    const cPrice =
      line.unitPrice != null && Number.isFinite(Number(line.unitPrice))
        ? Number(line.unitPrice)
        : Number(comp.unit_price);
    const { rows: compIns } = await client.query(
      `INSERT INTO project_items
        (project_id, catalog_item_id, codigo, descripcion, unidad, tipo, unit_price, official_unit_price,
         qty, is_custom, sort_order, category_id, apply_adjustment, created_by,
         bundle_id, is_bundle_header, is_bundle_component)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false, $10, $11, false, $12, $13, false, true)
       RETURNING id`,
      [
        projectId,
        comp.id,
        comp.codigo,
        comp.descripcion,
        comp.unidad,
        comp.tipo,
        cPrice,
        Number(comp.unit_price),
        cQty,
        sortOrder++,
        comp.category_id,
        userId,
        bundle.id,
      ]
    );
    componentIds.push(compIns[0].id);
  }

  logAuditEvent({
    projectId,
    eventType: 'BUDGET_BUNDLE_ADD',
    actorId: userId,
    prevData: null,
    newData: {
      bundleId: bundle.id,
      displayName: name,
      instanceLabel: label,
      unitPrice,
      componentCount: componentIds.length,
    },
    ip,
  });

  return {
    bundleId: bundle.id,
    headerItemId: headerIns[0].id,
    componentItemIds: componentIds,
    displayName: name,
    unitPrice,
  };
}

async function deleteBundleByItemId(client, projectId, itemId) {
  const { rows } = await client.query(
    `SELECT bundle_id, is_bundle_header, is_bundle_component FROM project_items
     WHERE id = $1 AND project_id = $2`,
    [itemId, projectId]
  );
  const row = rows[0];
  if (!row?.bundle_id) return { deletedBundle: false };
  await client.query(`DELETE FROM project_item_bundles WHERE id = $1 AND project_id = $2`, [
    row.bundle_id,
    projectId,
  ]);
  return { deletedBundle: true, bundleId: row.bundle_id };
}

module.exports = {
  suggestNextInstanceLabel,
  createProjectBundle,
  deleteBundleByItemId,
};
