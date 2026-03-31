const XLSX = require('xlsx');
const { pool } = require('../config/db');

const EXPORT_HEADERS = [
  'Razón social',
  'RUC',
  'Contacto',
  'Email',
  'Teléfono',
  'Ciudad',
  'Dirección',
  'Notas',
];

function stripAccents(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function mapHeaderCell(h) {
  const s = stripAccents(h);
  if (s.includes('razon') && s.includes('social')) return 'razonSocial';
  if (s === 'ruc') return 'ruc';
  if ((s.includes('nombre') && s.includes('contacto')) || s === 'contacto') return 'contactoNombre';
  if (s.includes('contacto') && !s.includes('email')) return 'contactoNombre';
  if (s.includes('email') || s === 'correo') return 'contactoEmail';
  if (s.includes('telefono') || s.includes('tel')) return 'contactoTelefono';
  if (s.includes('ciudad')) return 'ciudad';
  if (s.includes('direccion')) return 'direccion';
  if (s.includes('nota')) return 'notas';
  return '';
}

/** RUC Perú: solo dígitos, 11 caracteres si viene informado. */
function normalizeRucDigits(raw) {
  if (raw == null || String(raw).trim() === '') return '';
  return String(raw).replace(/\D/g, '');
}

function parseImportBuffer(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
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
  if (col.razonSocial === undefined) {
    return {
      rows: [],
      parseError: 'La fila 1 debe incluir al menos la columna «Razón social».',
    };
  }
  const rows = [];
  for (let r = 1; r < matrix.length; r++) {
    const line = matrix[r] || [];
    const gv = (k) => {
      const i = col[k];
      return i === undefined ? '' : line[i];
    };
    const razonSocial = String(gv('razonSocial') ?? '').trim();
    const ruc = gv('ruc');
    if (!razonSocial && !String(ruc ?? '').trim() && !String(gv('contactoEmail') ?? '').trim()) continue;
    rows.push({
      rowIndex: r + 1,
      razonSocial,
      ruc: ruc != null ? String(ruc).trim() : '',
      contactoNombre: String(gv('contactoNombre') ?? '').trim(),
      contactoEmail: String(gv('contactoEmail') ?? '').trim(),
      contactoTelefono: String(gv('contactoTelefono') ?? '').trim(),
      ciudad: String(gv('ciudad') ?? '').trim(),
      direccion: String(gv('direccion') ?? '').trim(),
      notas: String(gv('notas') ?? '').trim(),
    });
  }
  return { rows, parseError: null };
}

function normRazonKey(s) {
  return String(s || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

async function validateImportRows(parsedRows) {
  const { rows: dbRows } = await pool.query(
    `SELECT id, razon_social, ruc FROM clients`
  );
  const razonSet = new Set(dbRows.map((r) => normRazonKey(r.razon_social)));
  const rucDbSet = new Set();
  for (const r of dbRows) {
    const d = normalizeRucDigits(r.ruc);
    if (d) rucDbSet.add(d);
  }

  const lotRazonCount = new Map();
  const lotRucCount = new Map();
  for (const r of parsedRows) {
    const rk = normRazonKey(r.razonSocial);
    if (rk) lotRazonCount.set(rk, (lotRazonCount.get(rk) || 0) + 1);
    const rd = normalizeRucDigits(r.ruc);
    if (rd) lotRucCount.set(rd, (lotRucCount.get(rd) || 0) + 1);
  }

  const out = [];
  for (const r of parsedRows) {
    const issues = [];
    if (!r.razonSocial || !String(r.razonSocial).trim()) {
      issues.push('FALTA_RAZON_SOCIAL');
    }

    const rk = normRazonKey(r.razonSocial);
    if (rk && (lotRazonCount.get(rk) || 0) > 1) {
      issues.push('RAZON_DUP_LOTE');
    }
    if (rk && razonSet.has(rk)) {
      issues.push('RAZON_EN_BD');
    }

    const rucDigits = normalizeRucDigits(r.ruc);
    if (r.ruc && String(r.ruc).trim() && !rucDigits) {
      issues.push('RUC_VACIO_INVALIDO');
    }
    if (rucDigits) {
      if (rucDigits.length !== 11) {
        issues.push('RUC_FORMATO');
      }
      if ((lotRucCount.get(rucDigits) || 0) > 1) {
        issues.push('RUC_DUP_LOTE');
      }
      if (rucDbSet.has(rucDigits)) {
        issues.push('RUC_EN_BD');
      }
    }

    const em = r.contactoEmail;
    if (em && String(em).trim()) {
      const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(em).trim());
      if (!ok) issues.push('EMAIL_INVALIDO');
    }

    const rucForDb = rucDigits.length === 11 ? rucDigits : null;

    out.push({
      rowIndex: r.rowIndex,
      razonSocial: String(r.razonSocial).trim(),
      rucForDb,
      rucDisplay: rucDigits || (r.ruc ? String(r.ruc).trim() : '') || '',
      contactoNombre: r.contactoNombre || null,
      contactoEmail: r.contactoEmail || null,
      contactoTelefono: r.contactoTelefono || null,
      ciudad: r.ciudad || null,
      direccion: r.direccion || null,
      notas: r.notas || null,
      issues: [...new Set(issues)],
    });
  }

  const canApply = out.length > 0 && out.every((row) => row.issues.length === 0);
  return { rows: out, canApply };
}

function buildClientsXlsx(rows) {
  const matrix = [EXPORT_HEADERS];
  for (const c of rows) {
    matrix.push([
      c.razon_social,
      c.ruc || '',
      c.contacto_nombre || '',
      c.contacto_email || '',
      c.contacto_telefono || '',
      c.ciudad || '',
      c.direccion || '',
      c.notas || '',
    ]);
  }
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(matrix);
  XLSX.utils.book_append_sheet(wb, ws, 'Clientes');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

async function fetchAllClientsForExport() {
  const { rows } = await pool.query(
    `SELECT * FROM clients ORDER BY razon_social ASC`
  );
  return rows;
}

async function applyImportRows(validatedRows, userId) {
  const client = await pool.connect();
  let inserted = 0;
  try {
    await client.query('BEGIN');
    for (const row of validatedRows) {
      if (row.issues && row.issues.length) continue;
      await client.query(
        `INSERT INTO clients
          (razon_social, ruc, contacto_nombre, contacto_email, contacto_telefono, direccion, ciudad, notas, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          row.razonSocial,
          row.rucForDb || null,
          row.contactoNombre || null,
          row.contactoEmail || null,
          row.contactoTelefono || null,
          row.direccion || null,
          row.ciudad || null,
          row.notas || null,
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
  EXPORT_HEADERS,
  parseImportBuffer,
  validateImportRows,
  buildClientsXlsx,
  fetchAllClientsForExport,
  applyImportRows,
  normalizeRucDigits,
};
