const crypto = require('crypto');

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

const ITEM_DIFF_FIELDS = [
  ['codigo', 'Código'],
  ['descripcion', 'Descripción'],
  ['unidad', 'Unidad'],
  ['tipo', 'Tipo'],
  ['unitPrice', 'Precio USD'],
  ['qty', 'Cantidad'],
  ['applyAdjustment', 'Ajuste M1'],
  ['isCustom', 'Custom'],
  ['bundleId', 'KIT'],
  ['componentGroupLabel', 'Grupo'],
];

function canonicalForHash(payload) {
  const items = [...(payload.items || [])]
    .map((i) => ({
      id: i.id,
      catalogItemId: i.catalogItemId || null,
      codigo: i.codigo,
      descripcion: i.descripcion,
      unidad: i.unidad,
      tipo: i.tipo,
      unitPrice: num(i.unitPrice),
      officialUnitPrice: i.officialUnitPrice != null ? num(i.officialUnitPrice) : null,
      qty: num(i.qty),
      isCustom: !!i.isCustom,
      categoryId: i.categoryId || null,
      sortOrder: num(i.sortOrder, 0),
      applyAdjustment: i.applyAdjustment !== false,
      bundleId: i.bundleId || null,
      isBundleHeader: !!i.isBundleHeader,
      isBundleComponent: !!i.isBundleComponent,
      componentGroupKey: i.componentGroupKey || null,
      componentGroupLabel: i.componentGroupLabel || null,
      componentGroupSort: num(i.componentGroupSort, 0),
    }))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const bundles = [...(payload.bundles || [])]
    .map((b) => ({
      id: b.id,
      catalogItemId: b.catalogItemId || null,
      instanceLabel: b.instanceLabel,
      displayName: b.displayName,
      unitPrice: num(b.unitPrice),
      qty: num(b.qty, 1),
      sortOrder: num(b.sortOrder, 0),
    }))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return { items, bundles, financeParams: payload.financeParams || {} };
}

function hashPayload(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalForHash(payload))).digest('hex');
}

function itemLabel(item) {
  if (!item) return '—';
  const code = item.codigo ? `${item.codigo} ` : '';
  return `${code}${item.descripcion || item.id}`.trim();
}

function valuesEqual(a, b) {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (typeof a === 'number' || typeof b === 'number') {
    return Math.abs(num(a) - num(b)) < 0.0005;
  }
  return String(a) === String(b);
}

function diffItems(prevItems, nextItems) {
  const prevMap = new Map((prevItems || []).map((i) => [i.id, i]));
  const nextMap = new Map((nextItems || []).map((i) => [i.id, i]));
  const added = [];
  const removed = [];
  const changed = [];

  for (const [id, item] of nextMap) {
    if (!prevMap.has(id)) {
      added.push({ id, label: itemLabel(item), qty: item.qty, unitPrice: item.unitPrice });
    }
  }
  for (const [id, item] of prevMap) {
    if (!nextMap.has(id)) {
      removed.push({ id, label: itemLabel(item), qty: item.qty, unitPrice: item.unitPrice });
    }
  }
  for (const [id, next] of nextMap) {
    const prev = prevMap.get(id);
    if (!prev) continue;
    const fields = [];
    for (const [key, label] of ITEM_DIFF_FIELDS) {
      if (!valuesEqual(prev[key], next[key])) {
        fields.push({ key, label, from: prev[key], to: next[key] });
      }
    }
    if (fields.length) {
      changed.push({ id, label: itemLabel(next), fields });
    }
  }
  return { added, removed, changed };
}

function diffBundles(prevBundles, nextBundles) {
  const prevMap = new Map((prevBundles || []).map((b) => [b.id, b]));
  const nextMap = new Map((nextBundles || []).map((b) => [b.id, b]));
  const added = [];
  const removed = [];
  const changed = [];
  for (const [id, b] of nextMap) {
    if (!prevMap.has(id)) added.push({ id, label: b.displayName || id, qty: b.qty });
  }
  for (const [id, b] of prevMap) {
    if (!nextMap.has(id)) removed.push({ id, label: b.displayName || id, qty: b.qty });
  }
  for (const [id, next] of nextMap) {
    const prev = prevMap.get(id);
    if (!prev) continue;
    const fields = [];
    for (const [key, label] of [
      ['displayName', 'Nombre'],
      ['instanceLabel', 'Instancia'],
      ['unitPrice', 'Precio USD'],
      ['qty', 'Cantidad'],
    ]) {
      if (!valuesEqual(prev[key], next[key])) fields.push({ key, label, from: prev[key], to: next[key] });
    }
    if (fields.length) changed.push({ id, label: next.displayName || id, fields });
  }
  return { added, removed, changed };
}

function diffBudgetPayloads(prevPayload, nextPayload) {
  const items = diffItems(prevPayload?.items, nextPayload?.items);
  const bundles = diffBundles(prevPayload?.bundles, nextPayload?.bundles);
  return {
    items,
    bundles,
    addedCount: items.added.length + bundles.added.length,
    removedCount: items.removed.length + bundles.removed.length,
    changedCount: items.changed.length + bundles.changed.length,
  };
}

/** Totales de lista como en presupuesto: excluye componentes KIT (el header ya carga el precio). */
function payloadLineTotals(payload) {
  const items = payload?.items || [];
  let lista = 0;
  let lineCount = 0;
  for (const i of items) {
    if (i.isBundleComponent) continue;
    lineCount += 1;
    lista += num(i.unitPrice) * num(i.qty, 1);
  }
  return {
    lineCount,
    itemCount: items.length,
    lista: Math.round(lista * 100) / 100,
  };
}

module.exports = { num, hashPayload, diffBudgetPayloads, payloadLineTotals };
