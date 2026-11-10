/**
 * Totales de presupuesto para M1/CP/LP.
 * La cabecera del KIT es el importe cobrado. Si el conjunto mezcla activos y
 * consumibles, ese importe se reparte en la misma proporción que sus componentes
 * (el descuento del kit no se carga solo a un tipo). Los componentes no se suman
 * otra vez.
 */

function lineSubtotal(row) {
  const n = row?.subtotal != null ? Number(row.subtotal) : 0;
  return Number.isFinite(n) ? n : 0;
}

function isComponent(row) {
  return row?.is_bundle_component === true || row?.isBundleComponent === true;
}

function isHeader(row) {
  return row?.is_bundle_header === true || row?.isBundleHeader === true;
}

function appliesAdjustment(row) {
  if (row?.apply_adjustment === false || row?.applyAdjustment === false) return false;
  return true;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function distributeShare(comps, target) {
  if (!comps.length) return [];
  const gross = comps.reduce((sum, comp) => sum + lineSubtotal(comp), 0);
  let assigned = 0;
  return comps.map((comp, idx) => {
    const isLast = idx === comps.length - 1;
    const share =
      isLast || gross <= 0 ? round2(target - assigned) : round2(target * (lineSubtotal(comp) / gross));
    if (!isLast) assigned = round2(assigned + share);
    return { comp, share };
  });
}

function pricedLine(comp, share, applies) {
  const qty = Number(comp.qty) || 0;
  const originalUnit = comp.unit_price != null ? Number(comp.unit_price) : share;
  const scaledUnit = qty ? round2(share / qty) : share;
  const changed = Math.abs(scaledUnit - originalUnit) > 0.005;
  return {
    ...comp,
    subtotal: share,
    unit_price: changed ? scaledUnit : originalUnit,
    official_unit_price: changed ? originalUnit : comp.official_unit_price,
    apply_adjustment: applies,
  };
}

/**
 * Líneas con el importe cobrado, ya separadas por tipo.
 * La cabecera del KIT no entra: sus componentes sí, con la parte proporcional
 * del precio del conjunto (descuento incluido).
 */
function chargedLinesByTipo(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const compsByBundle = new Map();
  for (const row of list) {
    if (!isComponent(row) || !row.bundle_id) continue;
    if (!compsByBundle.has(row.bundle_id)) compsByBundle.set(row.bundle_id, []);
    compsByBundle.get(row.bundle_id).push(row);
  }

  const activos = [];
  const consumibles = [];

  function pushShare(bucket, comp, share, applies) {
    const st = round2(share);
    if (!st) return;
    bucket.push(pricedLine(comp, st, applies));
  }

  for (const row of list) {
    if (isComponent(row)) continue;
    const st = round2(lineSubtotal(row));
    const applies = appliesAdjustment(row);
    const comps = row.bundle_id ? compsByBundle.get(row.bundle_id) : null;
    if (isHeader(row) && comps && comps.length) {
      const actComps = comps.filter((comp) => comp.tipo === 'ACTIVO');
      const consComps = comps.filter((comp) => comp.tipo === 'CONSUMIBLE');
      const gross =
        actComps.reduce((sum, comp) => sum + lineSubtotal(comp), 0) +
        consComps.reduce((sum, comp) => sum + lineSubtotal(comp), 0);
      if (gross > 0) {
        const cons = round2(st * (consComps.reduce((sum, comp) => sum + lineSubtotal(comp), 0) / gross));
        const act = round2(st - cons);
        for (const part of distributeShare(consComps, cons)) pushShare(consumibles, part.comp, part.share, applies);
        for (const part of distributeShare(actComps, act)) pushShare(activos, part.comp, part.share, applies);
        continue;
      }
    }
    if (row.tipo === 'CONSUMIBLE') pushShare(consumibles, row, st, applies);
    else if (row.tipo === 'ACTIVO') pushShare(activos, row, st, applies);
  }

  return { activos, consumibles };
}

function totalsFromRows(rows) {
  const { activos: activoLines, consumibles: consumibleLines } = chargedLinesByTipo(rows);
  let activos = 0;
  let consumibles = 0;
  let activosAdj = 0;
  let consumiblesAdj = 0;
  let activosExempt = 0;
  let consumiblesExempt = 0;

  function add(tipo, amount, applies) {
    const st = round2(amount);
    if (!st) return;
    if (tipo === 'CONSUMIBLE') {
      consumibles += st;
      if (applies) consumiblesAdj += st;
      else consumiblesExempt += st;
    } else if (tipo === 'ACTIVO') {
      activos += st;
      if (applies) activosAdj += st;
      else activosExempt += st;
    }
  }

  for (const line of activoLines) add('ACTIVO', line.subtotal, appliesAdjustment(line));
  for (const line of consumibleLines) add('CONSUMIBLE', line.subtotal, appliesAdjustment(line));

  const listaAdj = activosAdj + consumiblesAdj;
  const listaExempt = activosExempt + consumiblesExempt;
  return {
    activos: round2(activos),
    consumibles: round2(consumibles),
    lista: round2(activos + consumibles),
    activosAdj: round2(activosAdj),
    consumiblesAdj: round2(consumiblesAdj),
    activosExempt: round2(activosExempt),
    consumiblesExempt: round2(consumiblesExempt),
    listaAdj: round2(listaAdj),
    listaExempt: round2(listaExempt),
  };
}

module.exports = { totalsFromRows, chargedLinesByTipo };
