const XLSX = require('xlsx');
const bcrypt = require('bcrypt');
const { pool } = require('../config/db');

const EXPORT_HEADERS = ['Email', 'Rol', 'Activo', 'Nombres', 'Apellidos', 'Cargo', 'Teléfono', 'DNI'];

function stripAccents(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function mapHeaderCell(h) {
  const s = stripAccents(h);
  if (s.includes('email') || s === 'correo') return 'email';
  if (s.includes('contrasena') || s.includes('password') || s === 'clave') return 'password';
  if (s === 'rol' || s === 'role') return 'role';
  if (s.includes('nombre') && !s.includes('apellido')) return 'nombres';
  if (s.includes('apellido')) return 'apellidos';
  if (s.includes('cargo')) return 'cargo';
  if (s.includes('telefono') || s.includes('tel')) return 'telefono';
  if (s === 'dni') return 'dni';
  if (s.includes('activo')) return 'activo';
  return '';
}

function isValidEmail(s) {
  const t = String(s || '').trim().toLowerCase();
  if (!t) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
}

const ROLES = new Set(['ADMIN', 'COMERCIAL', 'VIEWER']);

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
  if (col.email === undefined) {
    return {
      rows: [],
      parseError: 'La fila 1 debe incluir la columna «Email».',
    };
  }
  const rows = [];
  for (let r = 1; r < matrix.length; r++) {
    const line = matrix[r] || [];
    const gv = (k) => {
      const i = col[k];
      return i === undefined ? '' : line[i];
    };
    const email = String(gv('email') ?? '').trim();
    const password = gv('password');
    const pwdStr = password != null ? String(password) : '';
    if (!email && !pwdStr && !String(gv('role') ?? '').trim()) continue;
    let role = String(gv('role') ?? '').trim().toUpperCase();
    if (role === 'COMERCIAL' || role === 'COM') role = 'COMERCIAL';
    const activoRaw = gv('activo');
    let activo = true;
    if (activoRaw !== '' && activoRaw !== undefined && activoRaw !== null) {
      const a = String(activoRaw).trim().toLowerCase();
      activo = !['no', 'false', '0', 'inactivo', 'n'].includes(a);
    }
    rows.push({
      rowIndex: r + 1,
      email,
      password: pwdStr,
      role,
      nombres: String(gv('nombres') ?? '').trim(),
      apellidos: String(gv('apellidos') ?? '').trim(),
      cargo: String(gv('cargo') ?? '').trim(),
      telefono: String(gv('telefono') ?? '').trim(),
      dni: String(gv('dni') ?? '').trim(),
      activoImport: activo,
    });
  }
  return { rows, parseError: null };
}

/**
 * Valida filas; devuelve vista previa (sin contraseña) y filas listas para insertar.
 */
async function validateImportRows(parsedRows) {
  const { rows: dbRows } = await pool.query(`SELECT LOWER(TRIM(email)) AS e FROM users`);
  const emailDb = new Set(dbRows.map((r) => r.e));

  const lotEmail = new Map();
  for (const r of parsedRows) {
    const ek = String(r.email || '')
      .trim()
      .toLowerCase();
    if (ek) lotEmail.set(ek, (lotEmail.get(ek) || 0) + 1);
  }

  const rowsForPreview = [];
  const rowsForInsert = [];

  for (const r of parsedRows) {
    const issues = [];
    const emailNorm = String(r.email || '')
      .trim()
      .toLowerCase();

    if (!emailNorm) {
      issues.push('FALTA_EMAIL');
    } else if (!isValidEmail(emailNorm)) {
      issues.push('EMAIL_INVALIDO');
    } else if ((lotEmail.get(emailNorm) || 0) > 1) {
      issues.push('EMAIL_DUP_LOTE');
    } else if (emailDb.has(emailNorm)) {
      issues.push('EMAIL_EN_BD');
    }

    const pwd = String(r.password || '');
    if (!pwd || pwd.length < 8) {
      issues.push('PASSWORD_INVALIDO');
    }

    if (!r.role || !ROLES.has(r.role)) {
      issues.push('ROL_INVALIDO');
    }

    if (r.role === 'ADMIN' || r.role === 'COMERCIAL') {
      if (!r.nombres || !String(r.nombres).trim()) issues.push('FALTA_NOMBRES');
      if (!r.apellidos || !String(r.apellidos).trim()) issues.push('FALTA_APELLIDOS');
    }

    const uniq = [...new Set(issues)];

    rowsForPreview.push({
      rowIndex: r.rowIndex,
      email: emailNorm,
      role: r.role || '',
      nombres: r.nombres || '',
      apellidos: r.apellidos || '',
      cargo: r.cargo || '',
      telefono: r.telefono || '',
      dni: r.dni || '',
      passwordOk: pwd.length >= 8,
      activoImport: r.activoImport !== false,
      issues: uniq,
    });

    rowsForInsert.push({
      rowIndex: r.rowIndex,
      email: emailNorm,
      password: pwd,
      role: r.role,
      nombres: r.nombres,
      apellidos: r.apellidos,
      cargo: r.cargo || null,
      telefono: r.telefono || null,
      dni: r.dni || null,
      activoImport: r.activoImport !== false,
      issues: uniq,
    });
  }

  const canApply =
    parsedRows.length > 0 && rowsForPreview.every((row) => row.issues.length === 0);

  return { rowsForPreview, rowsForInsert, canApply };
}

async function fetchAllUsersForExport() {
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.role, u.active,
            e.nombres, e.apellidos, e.cargo, e.telefono, e.dni
     FROM users u
     LEFT JOIN employees e ON e.user_id = u.id
     ORDER BY u.email ASC`
  );
  return rows;
}

function buildUsersXlsx(rows) {
  const matrix = [EXPORT_HEADERS];
  for (const u of rows) {
    matrix.push([
      u.email,
      u.role,
      u.active ? 'Sí' : 'No',
      u.nombres || '',
      u.apellidos || '',
      u.cargo || '',
      u.telefono || '',
      u.dni || '',
    ]);
  }
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(matrix);
  XLSX.utils.book_append_sheet(wb, ws, 'Usuarios');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

async function applyUserImport(rowsForInsert) {
  const client = await pool.connect();
  let inserted = 0;
  try {
    await client.query('BEGIN');
    for (const row of rowsForInsert) {
      if (row.issues && row.issues.length) continue;
      const passwordHash = await bcrypt.hash(row.password, 12);
      const { rows: ur } = await client.query(
        `INSERT INTO users (email, password_hash, role, active)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [row.email, passwordHash, row.role, row.activoImport !== false]
      );
      const userId = ur[0].id;
      if (row.role !== 'VIEWER') {
        await client.query(
          `INSERT INTO employees (user_id, nombres, apellidos, cargo, telefono, dni)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            userId,
            String(row.nombres).trim(),
            String(row.apellidos).trim(),
            row.cargo || null,
            row.telefono || null,
            row.dni || null,
          ]
        );
      }
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
  buildUsersXlsx,
  fetchAllUsersForExport,
  applyUserImport,
};
