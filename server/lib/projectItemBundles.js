/** Instancias de conjunto KIT en presupuesto de proyecto. */

const { pool } = require('../config/db');
const { logAuditEvent } = require('../middleware/audit');
const { fetchDirectDependencies } = require('./catalogItemDependencies');
const {
  buildDisplayName,
  computeLinesTotal,
  fetchItemWithCategory,
} = require('./catalogKit');
const { resolveUnitPrice, getProjectQuotationMarket } = require('./pricingMarket');

const INSTANCE_LABEL_MAX = 50;

function parseInstanceLabel(raw, fallback) {
  if (raw === undefined || raw === null) {
    return fallback ?? null;
  }
  const label = String(raw).trim();
  if (!label) {
    return {
      errorCode: 'INSTANCE_LABEL_INVALID',
      message: 'Indique una etiqueta de instancia (zona)',
    };
  }
  if (label.length > INSTANCE_LABEL_MAX) {
    return {
      errorCode: 'INSTANCE_LABEL_INVALID',
      message: `La etiqueta no puede superar ${INSTANCE_LABEL_MAX} caracteres`,
    };
  }
  return label;
}

async function suggestNextInstanceLabel(projectId, _catalogItemId, client = null) {
  const q = client ? client.query.bind(client) : pool.query.bind(pool);
  const { rows } = await q(
    `SELECT COUNT(*)::int AS n FROM project_item_bundles WHERE project_id = $1`,
    [projectId]
  );
  const n = (rows[0]?.n || 0) + 1;
  return `ZONA ${n}`;
}

async function resolveDefaultApplyAdjustment(client, categoryId) {
  if (!categoryId) return true;
  const { rows } = await client.query(
    `SELECT default_apply_adjustment FROM catalog_categories WHERE id = $1`,
    [categoryId]
  );
  return rows[0]?.default_apply_adjustment !== false;
}

async function resolveKitLinesForMarket(client, lines, market, { preserveOverrides = false } = {}) {
  const included = (lines || []).filter((l) => l.included !== false && l.catalogItemId);
  const out = [];
  for (const line of included) {
    const { rows: catRows } = await client.query(`SELECT * FROM catalog_items WHERE id = $1`, [
      line.catalogItemId,
    ]);
    const cat = catRows[0];
    if (!cat) continue;
    let price = resolveUnitPrice(cat, market);
    if (preserveOverrides && line.unitPrice != null && Number.isFinite(Number(line.unitPrice))) {
      price = Number(line.unitPrice);
    }
    out.push({ ...line, unitPrice: price });
  }
  return out;
}

async function insertBundleComponents(client, { projectId, userId, bundleId, lines, startSortOrder, market }) {
  let sortOrder = startSortOrder;
  const componentIds = [];
  const m = market || 'NACIONAL';
  for (const line of lines) {
    const { rows: compRows } = await client.query(
      `SELECT * FROM catalog_items WHERE id = $1 AND active = true`,
      [line.catalogItemId]
    );
    const comp = compRows[0];
    if (!comp) {
      return { errorCode: 'INVALID_COMPONENT', message: 'Componente de catálogo no válido' };
    }
    const cQty = Math.max(0.001, Number(line.qty) || 0);
    const resolved = resolveUnitPrice(comp, m);
    const cPrice =
      line.unitPrice != null && Number.isFinite(Number(line.unitPrice))
        ? Number(line.unitPrice)
        : resolved;
    const { rows: compIns } = await client.query(
      `INSERT INTO project_items
        (project_id, catalog_item_id, codigo, descripcion, unidad, tipo, unit_price, official_unit_price,
         qty, is_custom, sort_order, category_id, apply_adjustment, created_by, updated_by,
         bundle_id, is_bundle_header, is_bundle_component,
         component_group_key, component_group_label, component_group_sort)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false, $10, $11, false, $12, $12, $13, false, true, $14, $15, $16)
       RETURNING id`,
      [
        projectId,
        comp.id,
        comp.codigo,
        comp.descripcion,
        comp.unidad,
        comp.tipo,
        cPrice,
        resolved,
        cQty,
        sortOrder++,
        comp.category_id,
        userId,
        bundleId,
        line.componentGroupKey || 'template',
        line.componentGroupLabel || null,
        Number(line.componentGroupSort) || 0,
      ]
    );
    componentIds.push(compIns[0].id);
  }
  return { componentIds, nextSortOrder: sortOrder };
}

function mapCompRowToLine(r, { fromTemplate }) {
  return {
    lineId: r.id,
    catalogItemId: r.catalog_item_id,
    codigo: r.codigo,
    descripcion: r.descripcion,
    unidad: r.unidad,
    tipo: r.tipo,
    unitPrice: r.unit_price != null ? Number(r.unit_price) : 0,
    qty: r.qty != null ? Number(r.qty) : 1,
    included: true,
    fromTemplate,
    componentGroupKey: r.component_group_key || 'template',
    componentGroupLabel: r.component_group_label || null,
    componentGroupSort: r.component_group_sort != null ? Number(r.component_group_sort) : 0,
  };
}

function isTemplateGroupRow(r) {
  const key = r.component_group_key || 'template';
  const sort = Number(r.component_group_sort) || 0;
  return key === 'template' && sort === 0;
}

/**
 * Carga datos del conjunto para edición en presupuesto.
 */
async function fetchBundleEditPayload(projectId, bundleId, client = null) {
  const q = client ? client.query.bind(client) : pool.query.bind(pool);
  const { rows: bundleRows } = await q(
    `SELECT b.*, i.codigo, i.descripcion AS kit_descripcion, i.unidad, i.tipo
     FROM project_item_bundles b
     LEFT JOIN catalog_items i ON i.id = b.catalog_item_id
     WHERE b.id = $1 AND b.project_id = $2`,
    [bundleId, projectId]
  );
  const bundle = bundleRows[0];
  if (!bundle) return null;

  const deps = bundle.catalog_item_id
    ? await fetchDirectDependencies(bundle.catalog_item_id, client)
    : [];

  const mainQty = bundle.qty != null ? Number(bundle.qty) : 1;

  const { rows: compRows } = await q(
    `SELECT * FROM project_items
     WHERE bundle_id = $1 AND is_bundle_component = true AND project_id = $2
     ORDER BY component_group_sort ASC, sort_order ASC, created_at ASC`,
    [bundleId, projectId]
  );

  const templateRows = compRows.filter(isTemplateGroupRow);
  const extraRows = compRows.filter((r) => !isTemplateGroupRow(r));
  const lines = [];
  const usedTemplateRowIds = new Set();

  for (const dep of deps) {
    const existing = templateRows.find(
      (r) => r.catalog_item_id === dep.childItemId && !usedTemplateRowIds.has(r.id)
    );
    if (existing) {
      usedTemplateRowIds.add(existing.id);
      lines.push(mapCompRowToLine(existing, { fromTemplate: true }));
    } else {
      lines.push({
        catalogItemId: dep.childItemId,
        codigo: dep.child?.codigo || '',
        descripcion: dep.child?.descripcion || '',
        unidad: dep.child?.unidad || 'UND',
        tipo: dep.child?.tipo || 'ACTIVO',
        unitPrice: dep.child?.unitPrice != null ? Number(dep.child.unitPrice) : 0,
        qtyPerMain: Number(dep.qty) || 1,
        qty: Math.round(Number(dep.qty) * mainQty * 1000) / 1000,
        included: false,
        fromTemplate: true,
        componentGroupKey: 'template',
        componentGroupLabel: null,
        componentGroupSort: 0,
      });
    }
  }

  for (const r of templateRows) {
    if (usedTemplateRowIds.has(r.id)) continue;
    lines.push(mapCompRowToLine(r, { fromTemplate: true }));
  }

  for (const r of extraRows) {
    lines.push(mapCompRowToLine(r, { fromTemplate: false }));
  }

  lines.sort((a, b) => {
    const ga = Number(a.componentGroupSort) || 0;
    const gb = Number(b.componentGroupSort) || 0;
    if (ga !== gb) return ga - gb;
    return String(a.codigo || '').localeCompare(String(b.codigo || ''));
  });

  return {
    bundleId: bundle.id,
    catalogItemId: bundle.catalog_item_id,
    codigo: bundle.codigo || '',
    kitBaseDesc: bundle.kit_descripcion || '',
    descripcion: bundle.kit_descripcion || bundle.display_name,
    unidad: bundle.unidad || 'UND',
    tipo: bundle.tipo || 'ACTIVO',
    instanceLabel: bundle.instance_label,
    displayName: bundle.display_name,
    mainQty: bundle.qty != null ? Number(bundle.qty) : 1,
    unitPrice: bundle.unit_price != null ? Number(bundle.unit_price) : 0,
    lines,
  };
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

  const market = await getProjectQuotationMarket(projectId, client);
  const included = await resolveKitLinesForMarket(client, lines, market, { preserveOverrides: false });

  const parsedLabel = parseInstanceLabel(instanceLabel, 'ZONA 1');
  if (typeof parsedLabel === 'object' && parsedLabel.errorCode) return parsedLabel;
  const label = parsedLabel;
  const kitBase = String(kit.descripcion || '').trim();
  const name = buildDisplayName(kitBase, label);
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
  const listPrice = resolveUnitPrice(kit, market);

  const { rows: headerIns } = await client.query(
    `INSERT INTO project_items
      (project_id, catalog_item_id, codigo, descripcion, unidad, tipo, unit_price, official_unit_price,
       qty, is_custom, sort_order, category_id, apply_adjustment, created_by, updated_by,
       bundle_id, is_bundle_header, is_bundle_component)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false, $10, $11, $12, $13, $13, $14, true, false)
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
  const sortedIncluded = [...included].sort((a, b) => {
    const ga = Number(a.componentGroupSort) || 0;
    const gb = Number(b.componentGroupSort) || 0;
    if (ga !== gb) return ga - gb;
    return String(a.codigo || '').localeCompare(String(b.codigo || ''));
  });
  const compResult = await insertBundleComponents(client, {
    projectId,
    userId,
    bundleId: bundle.id,
    lines: sortedIncluded,
    startSortOrder: sortOrder,
    market,
  });
  if (compResult.errorCode) return compResult;
  componentIds.push(...compResult.componentIds);

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

/**
 * Actualiza instancia KIT en presupuesto (componentes, nombre, precio).
 */
async function updateProjectBundle(
  client,
  { projectId, userId, bundleId, instanceLabel, displayName, qty, lines, ip, preservePriceOverrides = true }
) {
  const { rows: bundleRows } = await client.query(
    `SELECT b.*, i.descripcion AS kit_descripcion, i.codigo AS kit_codigo, i.unidad, i.tipo
     FROM project_item_bundles b
     LEFT JOIN catalog_items i ON i.id = b.catalog_item_id
     WHERE b.id = $1 AND b.project_id = $2`,
    [bundleId, projectId]
  );
  const bundle = bundleRows[0];
  if (!bundle) {
    return { errorCode: 'NOT_FOUND', message: 'Conjunto no encontrado' };
  }

  const market = await getProjectQuotationMarket(projectId, client);
  const included = await resolveKitLinesForMarket(client, lines, market, {
    preserveOverrides: preservePriceOverrides,
  });

  const parsedLabel = parseInstanceLabel(instanceLabel, bundle.instance_label || 'ZONA 1');
  if (typeof parsedLabel === 'object' && parsedLabel.errorCode) return parsedLabel;
  const label = parsedLabel;
  const kitBase = String(bundle.kit_descripcion || '').trim();
  const name = buildDisplayName(kitBase, label);
  const bundleQty = Math.max(0.001, Number(qty) || Number(bundle.qty) || 1);
  const unitPrice = computeLinesTotal(included);

  const { rows: headerRows } = await client.query(
    `SELECT id, sort_order FROM project_items
     WHERE bundle_id = $1 AND is_bundle_header = true AND project_id = $2`,
    [bundleId, projectId]
  );
  const header = headerRows[0];
  if (!header) {
    return { errorCode: 'NOT_FOUND', message: 'Cabecera del conjunto no encontrada' };
  }

  await client.query(`DELETE FROM project_items WHERE bundle_id = $1 AND is_bundle_component = true`, [
    bundleId,
  ]);

  const sortedIncluded = [...included].sort((a, b) => {
    const ga = Number(a.componentGroupSort) || 0;
    const gb = Number(b.componentGroupSort) || 0;
    if (ga !== gb) return ga - gb;
    return String(a.codigo || '').localeCompare(String(b.codigo || ''));
  });

  let sortOrder = Number(header.sort_order) + 1;
  const compResult = await insertBundleComponents(client, {
    projectId,
    userId,
    bundleId,
    lines: sortedIncluded,
    startSortOrder: sortOrder,
    market,
  });
  if (compResult.errorCode) return compResult;

  await client.query(
    `UPDATE project_item_bundles SET
       instance_label = $1, display_name = $2, unit_price = $3, qty = $4, updated_at = NOW()
     WHERE id = $5`,
    [label, name, unitPrice, bundleQty, bundleId]
  );

  await client.query(
    `UPDATE project_items SET
       descripcion = $1, unit_price = $2, qty = $3, updated_at = NOW(), updated_by = $4
     WHERE id = $5`,
    [name, unitPrice, bundleQty, userId, header.id]
  );

  logAuditEvent({
    projectId,
    eventType: 'BUDGET_BUNDLE_UPDATE',
    actorId: userId,
    prevData: { bundleId, displayName: bundle.display_name },
    newData: {
      bundleId,
      displayName: name,
      instanceLabel: label,
      unitPrice,
      componentCount: compResult.componentIds.length,
    },
    ip,
  });

  return {
    bundleId,
    headerItemId: header.id,
    componentItemIds: compResult.componentIds,
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
  fetchBundleEditPayload,
  createProjectBundle,
  updateProjectBundle,
  deleteBundleByItemId,
};
