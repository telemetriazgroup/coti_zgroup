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
  if (s.includes('codig')) return 'codigo';
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
    rows.push({ rowIndex: r + 1, codigo, descripcion, qty, unitPrice, punitRaw: punitRaw || '' });
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
        matchType: m.matchType,
        message: m.message,
        catalogItem: m.catalogItem,
      });
    }
  }
  return results;
}

/** Solo cantidades e identificación — sin precios (intercambio con área de proyectos). */
function buildProjectItemsExportSheet(items) {
  const matrix = [['Código', 'Descripción', 'Unidad', 'Tipo', 'Cantidad', 'Origen catálogo']];
  for (const it of items) {
    matrix.push([
      it.codigo || '',
      it.descripcion || '',
      it.unidad || '',
      it.tipo || '',
      it.qty != null ? Number(it.qty) : 0,
      it.isCustom ? 'pieza propia' : 'catálogo',
    ]);
  }
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
  const lines = [
    'Código,Descripción,Unidad,Tipo,Cantidad,Origen catálogo',
    ...items.map((it) =>
      [
        esc(it.codigo),
        esc(it.descripcion),
        esc(it.unidad),
        esc(it.tipo),
        it.qty != null ? Number(it.qty) : 0,
        esc(it.isCustom ? 'pieza propia' : 'catálogo'),
      ].join(',')
    ),
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
};
