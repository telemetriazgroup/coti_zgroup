const XLSX = require('xlsx');
const { pool } = require('../config/db');

const EXPORT_HEADERS = ['Categoría', 'Código', 'Descripción', 'Unidad', 'Tipo', 'Precio USD'];

function stripAccents(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function mapHeaderCell(h) {
  const s = stripAccents(h);
  if (s.includes('categor')) return 'categoria';
  if (s === 'codigo' || s.includes('codig')) return 'codigo';
  if (s.includes('descrip')) return 'descripcion';
  if (s.includes('unidad')) return 'unidad';
  if (s === 'tipo') return 'tipo';
  if (s.includes('precio')) return 'precio';
  return '';
}

function normalizeUnidad(u) {
  const s = String(u || 'UND').trim().toUpperCase().slice(0, 30);
  return s || 'UND';
}

/**
 * Genera buffer .xlsx desde el mismo shape que GET /api/catalog.
 */
function buildCatalogXlsx(data) {
  const { categories, items } = data;
  const catNameById = new Map((categories || []).map((c) => [c.id, c.nombre]));
  const matrix = [EXPORT_HEADERS];
  for (const it of items || []) {
    matrix.push([
      catNameById.get(it.categoryId) || '',
      it.codigo,
      it.descripcion,
      it.unidad,
      it.tipo,
      it.unitPrice != null ? Number(it.unitPrice) : 0,
    ]);
  }
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(matrix);
  XLSX.utils.book_append_sheet(wb, ws, 'Catálogo');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function parseImportBuffer(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
  if (!matrix.length) {
    return { rows: [], parseError: 'La hoja está vacía' };
  }
  const headerCells = matrix[0] || [];
  const col = {};
  headerCells.forEach((cell, i) => {
    const key = mapHeaderCell(cell);
    if (key && col[key] === undefined) col[key] = i;
  });
  if (col.categoria === undefined || col.codigo === undefined || col.descripcion === undefined) {
    return {
      rows: [],
      parseError:
        'La fila 1 debe incluir columnas: Categoría, Código, Descripción (y opcionalmente Unidad, Tipo, Precio USD).',
    };
  }
  const rows = [];
  for (let r = 1; r < matrix.length; r++) {
    const line = matrix[r] || [];
    const gv = (k) => {
      const i = col[k];
      return i === undefined ? '' : line[i];
    };
    const categoria = String(gv('categoria') ?? '').trim();
    const codigo = String(gv('codigo') ?? '').trim();
    const descripcion = String(gv('descripcion') ?? '').trim();
    const unidad = String(gv('unidad') ?? '').trim();
    const tipoRaw = gv('tipo');
    const precioRaw = gv('precio');
    if (!categoria && !codigo && !descripcion) continue;
    rows.push({
      rowIndex: r + 1,
      categoria,
      codigo,
      descripcion,
      unidad,
      tipoRaw,
      precioRaw,
    });
  }
  return { rows, parseError: null };
}

/**
 * Validación: duplicados en lote (código y descripción) y conflictos con BD.
 */
async function validateImportRows(parsedRows) {
  const { rows: catRows } = await pool.query(`SELECT id, nombre FROM catalog_categories WHERE active = true`);
  const catIdByLowerName = new Map(catRows.map((c) => [c.nombre.toLowerCase().trim(), c.id]));

  const { rows: dbItems } = await pool.query(
    `SELECT i.codigo, i.descripcion, i.category_id, c.nombre AS cat_nombre
     FROM catalog_items i
     JOIN catalog_categories c ON c.id = i.category_id
     WHERE i.active = true`
  );
  const dbByCatCode = new Set(
    dbItems.map((r) => `${r.category_id}::${String(r.codigo).toLowerCase().trim()}`)
  );
  const dbDescLower = new Set(dbItems.map((r) => String(r.descripcion).toLowerCase().trim()));

  const lotKeyCount = new Map();
  const lotDescCount = new Map();
  for (const r of parsedRows) {
    const catId = catIdByLowerName.get(r.categoria.toLowerCase().trim());
    const k = catId ? `${catId}::${r.codigo.toLowerCase()}` : `__nocat__::${r.codigo.toLowerCase()}`;
    lotKeyCount.set(k, (lotKeyCount.get(k) || 0) + 1);
    const d = r.descripcion.toLowerCase().trim();
    if (d) lotDescCount.set(d, (lotDescCount.get(d) || 0) + 1);
  }

  const out = [];
  for (const r of parsedRows) {
    const issues = [];
    if (!r.categoria) issues.push('FALTA_CATEGORIA');
    if (!r.codigo) issues.push('FALTA_CODIGO');
    if (!r.descripcion) issues.push('FALTA_DESCRIPCION');

    const catId = r.categoria ? catIdByLowerName.get(r.categoria.toLowerCase().trim()) : null;
    if (r.categoria && !catId) issues.push('CATEGORIA_NO_EXISTE');

    const tr = String(r.tipoRaw ?? '').trim().toUpperCase();
    let tipo = 'ACTIVO';
    if (!tr || tr === 'ACTIVO' || tr === 'A') {
      tipo = 'ACTIVO';
    } else if (tr === 'CONSUMIBLE') {
      tipo = 'CONSUMIBLE';
    } else {
      issues.push('TIPO_INVALIDO');
      tipo = 'ACTIVO';
    }

    const precio = parseFloat(String(r.precioRaw ?? '').replace(',', '.'));
    if (!Number.isFinite(precio) || precio < 0) issues.push('PRECIO_INVALIDO');

    if (catId && r.codigo) {
      const k = `${catId}::${r.codigo.toLowerCase().trim()}`;
      if ((lotKeyCount.get(k) || 0) > 1) issues.push('DUP_CODIGO_LOTE');
      if (dbByCatCode.has(k)) issues.push('CODIGO_EN_BD');
    }

    const dNorm = r.descripcion.toLowerCase().trim();
    if (dNorm) {
      if ((lotDescCount.get(dNorm) || 0) > 1) issues.push('DUP_DESC_LOTE');
      if (dbDescLower.has(dNorm)) issues.push('DESC_EN_BD');
    }

    out.push({
      rowIndex: r.rowIndex,
      categoria: r.categoria,
      codigo: r.codigo,
      descripcion: r.descripcion,
      unidad: normalizeUnidad(r.unidad),
      tipo,
      precio,
      issues: [...new Set(issues)],
    });
  }

  const canApply = out.length > 0 && out.every((row) => row.issues.length === 0);
  return { rows: out, canApply };
}

async function applyImportRows(validatedRows, userId) {
  const { rows: catRows } = await pool.query(`SELECT id, nombre FROM catalog_categories WHERE active = true`);
  const catIdByLowerName = new Map(catRows.map((c) => [c.nombre.toLowerCase().trim(), c.id]));

  const client = await pool.connect();
  let inserted = 0;
  try {
    await client.query('BEGIN');
    for (const row of validatedRows) {
      if (row.issues && row.issues.length) continue;
      const catId = catIdByLowerName.get(row.categoria.toLowerCase().trim());
      if (!catId) throw new Error('Categoría inválida');
      const { rows: so } = await client.query(
        `SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM catalog_items WHERE category_id = $1`,
        [catId]
      );
      await client.query(
        `INSERT INTO catalog_items
          (category_id, codigo, descripcion, unidad, tipo, unit_price, sort_order, active, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8)`,
        [
          catId,
          row.codigo.trim(),
          row.descripcion.trim(),
          row.unidad,
          row.tipo,
          row.precio,
          so[0].n,
          userId,
        ]
      );
      inserted += 1;
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  return { inserted };
}

module.exports = {
  buildCatalogXlsx,
  parseImportBuffer,
  validateImportRows,
  applyImportRows,
  EXPORT_HEADERS,
};
