/**
 * Vista de presupuesto: un KIT es un bloque (cabecera + componentes),
 * aunque en BD el sort_order esté intercalado con otro conjunto.
 */

function mergeKitComponents(comps) {
  const merged = new Map();
  for (const c of comps) {
    const k = c.catalogItemId || `id:${c.id}`;
    if (!merged.has(k)) {
      merged.set(k, {
        ...c,
        qty: Number(c.qty) || 0,
        subtotal: Number(c.subtotal) || 0,
        kitConsolidated: true,
      });
    } else {
      const ex = merged.get(k);
      ex.qty = Math.round((Number(ex.qty) + Number(c.qty || 0)) * 1000) / 1000;
      ex.subtotal = Math.round((Number(ex.subtotal) + Number(c.subtotal || 0)) * 100) / 100;
    }
  }
  return [...merged.values()].sort((a, b) =>
    String(a.codigo || '').localeCompare(String(b.codigo || ''), 'es', { numeric: true })
  );
}

/**
 * @param {Array} sorted líneas ya ordenadas por sortOrder (se reagrupan por bundleId)
 */
export function buildConsolidatedKitBudgetRows(sorted) {
  const list = Array.isArray(sorted) ? sorted : [];
  const byBundle = new Map();
  const standalones = [];

  list.forEach((row, idx) => {
    const sort = Number(row.sortOrder ?? idx);
    if (row.bundleId && (row.isBundleHeader || row.isBundleComponent)) {
      if (!byBundle.has(row.bundleId)) {
        byBundle.set(row.bundleId, { header: null, comps: [], minSort: sort, minIdx: idx });
      }
      const b = byBundle.get(row.bundleId);
      b.minSort = Math.min(b.minSort, sort);
      b.minIdx = Math.min(b.minIdx, idx);
      if (row.isBundleHeader) b.header = row;
      else b.comps.push(row);
      return;
    }
    standalones.push({ row, sort, idx });
  });

  const events = [
    ...[...byBundle.values()].map((b) => ({
      sort: b.header != null ? Number(b.header.sortOrder ?? b.minSort) : b.minSort,
      idx: b.minIdx,
      rows: [...(b.header ? [b.header] : []), ...mergeKitComponents(b.comps)],
    })),
    ...standalones.map((s) => ({ sort: s.sort, idx: s.idx, rows: [s.row] })),
  ];
  events.sort((a, b) => a.sort - b.sort || a.idx - b.idx);
  return events.flatMap((e) => e.rows);
}

export { mergeKitComponents };
