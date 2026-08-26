const XLSX = require('xlsx');

function stripAccents(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Mapea celdas de encabezado a campos. Acepta plantillas de proyectos (código, descripción, cantidad).
 */
function mapBudgetImportHeader(h) {
  const raw = String(h ?? '').trim();
  const s = stripAccents(raw);
  if (!s) return '';
  if (s.includes('descrip')) return 'descripcion';
  if (s.includes('codig') && !s.includes('kit')) return 'codigo';
  if (s === 'kit' || s.includes('conjunto') || s === 'kit codigo' || s === 'codigo kit') return 'kit';
  if (s.includes('zona') || s.includes('instancia') || s === 'instance') return 'zona';
  if (s === 'rol' || s === 'role' || s.includes('tipo linea') || s === 'tipo de linea') return 'rol';
  if ((s.includes('grupo') || s === 'group') && !s.includes('descrip')) return 'grupo';
  if (s === 'orden' || s === 'order' || s === 'sort') return 'orden';
  if (s.match(/^cant$/) || s.includes('cant') || s.includes('qty') || s === 'q' || s.includes('qte'))
    return 'cantidad';
  if (s.includes('p.unit') || s.includes('p unit') || (s.includes('unitario') && s.includes('precio'))) return 'punit';
  if (s === 'pu' || (s.includes('precio') && s.includes('unit') && !s.includes('total'))) return 'punit';
  if (s.includes('precio') && !s.includes('subtotal') && !s.match(/sub\s*tot/)) return 'punit';
  return '';
}

/**
 * @param {Buffer} buffer
 * @param {string} [filename] para inferir .csv
 */
function parseBudgetImportBuffer(buffer, filename = '') {
  const isCsv = /\.csv$/i.test(filename);
  const wb = XLSX.read(buffer, {
    type: 'buffer',
    cellDates: true,
    raw: isCsv,
    codepage: isCsv ? 65001 : undefined,
  });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
  if (!matrix.length) {
    return { rows: [], parseError: 'La hoja está vacía' };
  }
  const headerCells = matrix[0] || [];
  const col = {};
  headerCells.forEach((cell) => {
    const key = mapBudgetImportHeader(cell);
    if (key && col[key] === undefined) col[key] = headerCells.indexOf(cell);
  });
  if (col.cantidad === undefined) {
    return {
      rows: [],
      parseError: 'Fila 1: se requiere columna Cantidad (o Qty / cant).',
    };
  }
  if (col.codigo === undefined && col.descripcion === undefined) {
    return {
      rows: [],
      parseError: 'Fila 1: se requiere Código o Descripción (al menos una) además de Cantidad.',
    };
  }

  const rows = [];
  for (let r = 1; r < matrix.length; r++) {
    const line = matrix[r] || [];
    const gv = (k) => {
      const i = col[k];
      return i === undefined ? '' : line[i];
    };
    const codigo = String(gv('codigo') ?? '').trim();
    const descripcion = String(gv('descripcion') ?? '').trim();
    const cantRaw = gv('cantidad');
    const punitRaw = col.punit !== undefined ? gv('punit') : '';
    if (!codigo && !descripcion) continue;
    let qty = parseFloat(String(cantRaw).replace(',', '.'));
    if (Number.isNaN(qty) || qty <= 0) {
      rows.push({ rowIndex: r + 1, codigo, descripcion, qty: null, punitRaw, parseError: 'Cantidad inválida' });
      continue;
    }
    if (qty < 0.001) {
      rows.push({ rowIndex: r + 1, codigo, descripcion, qty, punitRaw, parseError: 'Cantidad mínima 0.001' });
      continue;
    }
    let unitPrice = null;
    if (punitRaw !== '' && punitRaw != null) {
      const p = parseFloat(String(punitRaw).replace(',', '.'));
      if (!Number.isNaN(p) && p >= 0) unitPrice = p;
    }
    rows.push({
      rowIndex: r + 1,
      codigo,
      descripcion,
      qty,
      unitPrice,
      punitRaw: punitRaw || '',
      kit: String(gv('kit') ?? '').trim(),
      zona: String(gv('zona') ?? '').trim(),
      rol: String(gv('rol') ?? '').trim(),
      grupo: String(gv('grupo') ?? '').trim(),
      orden: String(gv('orden') ?? '').trim(),
    });
  }
  return { rows, parseError: null };
}

/**
 * Construye mapas de búsqueda exacta. Código: case-insensitive trim. Descripción: trim exacto (sensible a mayúsculas).
 */
function buildCatalogMatchMaps(catalogRows) {
  const byCode = new Map();
  const byDesc = new Map();
  for (const row of catalogRows) {
    const c = String(row.codigo || '').trim();
    const d = String(row.descripcion || '').trim();
    const item = {
      id: row.id,
      codigo: row.codigo,
      descripcion: row.descripcion,
      unidad: row.unidad,
      tipo: row.tipo,
      unitPrice: row.unit_price != null ? Number(row.unit_price) : 0,
      categoryId: row.category_id,
    };
    if (c) {
      const k = c.toLowerCase();
      if (byCode.has(k)) {
        byCode.set(k, { ambiguous: true, item: null });
      } else {
        byCode.set(k, { ambiguous: false, item });
      }
    }
    if (d) {
      if (byDesc.has(d)) {
        byDesc.set(d, { ambiguous: true, item: null });
      } else {
        byDesc.set(d, { ambiguous: false, item });
      }
    }
  }
  return { byCode, byDesc };
}

/**
 * Intenta: 1) código exacto (sin distinguir mayúsculas en catálogo vs archivo); 2) descripción exacta (trim, mismas tildes/mayúsculas).
 */
function matchLineToCatalog({ codigo, descripcion }, maps) {
  const c = String(codigo || '').trim();
  const d = String(descripcion || '').trim();
  if (c) {
    const hit = maps.byCode.get(c.toLowerCase());
    if (hit?.ambiguous) {
      return { matchType: 'ambiguous', field: 'codigo', message: 'Varios ítems comparten el mismo código en el catálogo' };
    }
    if (hit?.item) {
      return { matchType: 'codigo', catalogItem: hit.item, message: 'Coincidencia exacta por código' };
    }
  }
  if (d) {
    const hit = maps.byDesc.get(d);
    if (hit?.ambiguous) {
      return { matchType: 'ambiguous', field: 'descripcion', message: 'Varias filas en catálogo con la misma descripción' };
    }
    if (hit?.item) {
      return { matchType: 'descripcion', catalogItem: hit.item, message: 'Coincidencia exacta por descripción' };
    }
  }
  return { matchType: 'none', message: 'Sin coincidencia en catálogo (revise código o descripción exactos)' };
}

/**
 * @param {Array} importRows
 * @param {{ byCode: Map, byDesc: Map }} matchMaps
 */
function validateImportRows(importRows, matchMaps) {
  const results = [];
  for (const row of importRows) {
    if (row.parseError) {
      results.push({
        rowIndex: row.rowIndex,
        inputCodigo: row.codigo,
        inputDescripcion: row.descripcion,
        qty: row.qty,
        matchType: 'parse',
        message: row.parseError,
        catalogItem: null,
      });
      continue;
    }
    const m = matchLineToCatalog(
      { codigo: row.codigo, descripcion: row.descripcion },
      matchMaps
    );
    if (m.matchType === 'ambiguous') {
      results.push({
        rowIndex: row.rowIndex,
        inputCodigo: row.codigo,
        inputDescripcion: row.descripcion,
        qty: row.qty,
        unitPrice: row.unitPrice,
        matchType: 'ambiguous',
        field: m.field,
        message: m.message,
        catalogItem: null,
      });
    } else if (m.matchType === 'none') {
      results.push({
        rowIndex: row.rowIndex,
        inputCodigo: row.codigo,
        inputDescripcion: row.descripcion,
        qty: row.qty,
        unitPrice: row.unitPrice,
        kit: row.kit || '',
        zona: row.zona || '',
        rol: row.rol || '',
        grupo: row.grupo || '',
        matchType: 'none',
        message: m.message,
        catalogItem: null,
      });
    } else {
      results.push({
        rowIndex: row.rowIndex,
        inputCodigo: row.codigo,
        inputDescripcion: row.descripcion,
        qty: row.qty,
        unitPrice: row.unitPrice,
        kit: row.kit || '',
        zona: row.zona || '',
        rol: row.rol || '',
        grupo: row.grupo || '',
        orden: row.orden || '',
        matchType: m.matchType,
        message: m.message,
        catalogItem: m.catalogItem,
      });
    }
  }
  return results;
}

/** Identificación, cantidades, zona/KIT y orden — sin precios. */
function kitExportMeta(items) {
  const headerByBundle = new Map();
  for (const it of items || []) {
    if (it.isBundleHeader && it.bundleId) headerByBundle.set(it.bundleId, it);
  }
  return headerByBundle;
}

function exportRowRole(it) {
  if (it.isBundleHeader) return 'KIT';
  if (it.isBundleComponent) return 'COMPONENTE';
  return 'LINEA';
}

function orderItemsForExport(items) {
  const list = Array.isArray(items) ? items : [];
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
  for (const b of byBundle.values()) {
    b.comps.sort(
      (a, c) =>
        Number(a.sortOrder ?? 0) - Number(c.sortOrder ?? 0) ||
        String(a.codigo || '').localeCompare(String(c.codigo || ''), 'es', { numeric: true })
    );
  }
  const events = [
    ...[...byBundle.values()].map((b) => ({
      sort: b.header != null ? Number(b.header.sortOrder ?? b.minSort) : b.minSort,
      idx: b.minIdx,
      rows: [...(b.header ? [b.header] : []), ...b.comps],
    })),
    ...standalones.map((s) => ({ sort: s.sort, idx: s.idx, rows: [s.row] })),
  ];
  events.sort((a, b) => a.sort - b.sort || a.idx - b.idx);
  return events.flatMap((e) => e.rows);
}

function buildProjectItemsExportSheet(items) {
  const headers = kitExportMeta(items);
  const ordered = orderItemsForExport(items);
  const matrix = [
    ['Orden', 'Código', 'Descripción', 'Unidad', 'Tipo', 'Cantidad', 'Rol', 'Kit', 'Zona', 'Grupo', 'Origen catálogo'],
  ];
  (ordered || []).forEach((it, idx) => {
    const hdr = it.bundleId ? headers.get(it.bundleId) : null;
    matrix.push([
      idx + 1,
      it.codigo || '',
      it.descripcion || '',
      it.unidad || '',
      it.tipo || '',
      it.qty != null ? Number(it.qty) : 0,
      exportRowRole(it),
      it.isBundleHeader ? it.codigo || '' : hdr?.codigo || '',
      it.bundleInstanceLabel || '',
      it.componentGroupLabel || '',
      it.isCustom ? 'pieza propia' : 'catálogo',
    ]);
  });
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(matrix);
  XLSX.utils.book_append_sheet(wb, ws, 'Presupuesto');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function buildProjectItemsExportCsv(items) {
  const esc = (v) => {
    const s = String(v ?? '');
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const headers = kitExportMeta(items);
  const ordered = orderItemsForExport(items);
  const lines = [
    'Orden,Código,Descripción,Unidad,Tipo,Cantidad,Rol,Kit,Zona,Grupo,Origen catálogo',
    ...(ordered || []).map((it, idx) => {
      const hdr = it.bundleId ? headers.get(it.bundleId) : null;
      return [
        idx + 1,
        esc(it.codigo),
        esc(it.descripcion),
        esc(it.unidad),
        esc(it.tipo),
        it.qty != null ? Number(it.qty) : 0,
        esc(exportRowRole(it)),
        esc(it.isBundleHeader ? it.codigo || '' : hdr?.codigo || ''),
        esc(it.bundleInstanceLabel || ''),
        esc(it.componentGroupLabel || ''),
        esc(it.isCustom ? 'pieza propia' : 'catálogo'),
      ].join(',');
    }),
  ];
  return Buffer.from(['\uFEFF', ...lines].join('\r\n'), 'utf8');
}

module.exports = {
  parseBudgetImportBuffer,
  buildCatalogMatchMaps,
  matchLineToCatalog,
  validateImportRows,
  buildProjectItemsExportSheet,
  buildProjectItemsExportCsv,
  mapBudgetImportHeader,
  partitionImportItems,
};

/** Agrupa filas de importación con Kit/Zona/Rol para reconstruir conjuntos. */
function partitionImportItems(toApply) {
  const list = Array.isArray(toApply) ? toApply : [];
  const hasKitMeta = list.some(
    (l) =>
      String(l.kit || '').trim() ||
      String(l.zona || '').trim() ||
      /^(KIT|COMPONENTE)$/i.test(String(l.rol || '').trim())
  );
  if (!hasKitMeta) return { stand: list, kitGroups: [] };

  const groups = new Map();
  const stand = [];
  for (const line of list) {
    const rol = String(line.rol || '').trim().toUpperCase();
    const kit = String(line.kit || '').trim();
    const zona = String(line.zona || '').trim();
    if (rol === 'LINEA' || (!kit && !zona && rol !== 'KIT' && rol !== 'COMPONENTE')) {
      stand.push(line);
      continue;
    }
    const key = `${kit.toLowerCase()}||${zona.toLowerCase()}`;
    if (!groups.has(key)) groups.set(key, { kit, zona: zona || 'ZONA 1', header: null, comps: [] });
    const g = groups.get(key);
    if (rol === 'KIT') g.header = line;
    else g.comps.push(line);
  }
  return { stand, kitGroups: [...groups.values()] };
}
