const express = require('express');
const multer = require('multer');
const { body, validationResult } = require('express-validator');
const { pool } = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const {
  parseImportBuffer,
  validateImportRows,
  applyImportRows,
  buildClientsXlsx,
  fetchAllClientsForExport,
} = require('../lib/clientsExcel');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok =
      /\.(xlsx|xls)$/i.test(file.originalname) ||
      [
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel',
      ].includes(file.mimetype);
    cb(null, ok);
  },
});

const router = express.Router();
router.use(requireAuth);

function mapClient(row) {
  return {
    id: row.id,
    razonSocial: row.razon_social,
    ruc: row.ruc,
    contactoNombre: row.contacto_nombre,
    contactoEmail: row.contacto_email,
    contactoTelefono: row.contacto_telefono,
    direccion: row.direccion,
    ciudad: row.ciudad,
    notas: row.notas,
    createdBy: row.created_by,
    projectCount: row.project_count != null ? Number(row.project_count) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── GET /api/clients — lista + búsqueda (todos los roles autenticados) ───
router.get('/', async (req, res) => {
  const q = (req.query.q || '').trim();
  try {
    let sql = `
      SELECT c.*,
        (SELECT COUNT(*)::int FROM projects p
         WHERE p.client_id = c.id AND p.deleted_at IS NULL) AS project_count
      FROM clients c
      WHERE 1=1`;
    const params = [];
    if (q) {
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
      sql += ` AND (
        c.razon_social ILIKE $1 OR
        COALESCE(c.ruc, '') ILIKE $2 OR
        COALESCE(c.contacto_nombre, '') ILIKE $3
      )`;
    }
    sql += ` ORDER BY c.razon_social ASC`;
    const { rows } = await pool.query(sql, params);
    return res.json({ success: true, data: rows.map(mapClient) });
  } catch (err) {
    console.error('[CLIENTS] list:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// ─── GET /api/clients/export — Excel ───────────────────────────
router.get('/export', async (req, res) => {
  try {
    const rows = await fetchAllClientsForExport();
    const buf = buildClientsXlsx(rows);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="zgroup-clientes.xlsx"');
    return res.send(buf);
  } catch (err) {
    console.error('[CLIENTS] export:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// ─── POST /api/clients/import/preview — ADMIN + COMERCIAL ──────
router.post('/import/preview', requireRole('ADMIN', 'COMERCIAL'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({
        success: false,
        error: { code: 'NO_FILE', message: 'Adjunte un archivo .xlsx' },
      });
    }
    const { rows: parsed, parseError } = parseImportBuffer(req.file.buffer);
    if (parseError) {
      return res.status(400).json({ success: false, error: { code: 'PARSE_ERROR', message: parseError } });
    }
    if (parsed.length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'EMPTY', message: 'No hay filas de datos.' },
      });
    }
    const { rows, canApply } = await validateImportRows(parsed);
    return res.json({ success: true, data: { rows, canApply, total: rows.length } });
  } catch (err) {
    console.error('[CLIENTS] import preview:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// ─── POST /api/clients/import/apply — ADMIN + COMERCIAL ──────
router.post('/import/apply', requireRole('ADMIN', 'COMERCIAL'), async (req, res) => {
  try {
    const incoming = req.body?.rows;
    if (!Array.isArray(incoming) || incoming.length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Envíe rows[] con la previsualización' },
      });
    }
    const reparsed = incoming.map((r) => ({
      rowIndex: r.rowIndex,
      razonSocial: r.razonSocial,
      ruc: r.rucDisplay != null ? String(r.rucDisplay) : '',
      contactoNombre: r.contactoNombre || '',
      contactoEmail: r.contactoEmail || '',
      contactoTelefono: r.contactoTelefono || '',
      ciudad: r.ciudad || '',
      direccion: r.direccion || '',
      notas: r.notas || '',
    }));
    const { rows, canApply } = await validateImportRows(reparsed);
    if (!canApply) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'IMPORT_INVALID',
          message: 'La validación falló. Vuelva a previsualizar.',
          data: { rows },
        },
      });
    }
    const { inserted } = await applyImportRows(rows, req.user.id);
    return res.json({ success: true, data: { inserted } });
  } catch (err) {
    console.error('[CLIENTS] import apply:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// ─── GET /api/clients/:id ──────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.*,
        (SELECT COUNT(*)::int FROM projects p
         WHERE p.client_id = c.id AND p.deleted_at IS NULL) AS project_count
       FROM clients c WHERE c.id = $1`,
      [req.params.id]
    );
    if (!rows[0]) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Cliente no encontrado' } });
    }
    return res.json({ success: true, data: mapClient(rows[0]) });
  } catch (err) {
    console.error('[CLIENTS] get:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

const writeValidation = [
  body('razonSocial').notEmpty().withMessage('Razón social requerida'),
  body('ruc').optional().isString(),
  body('contactoNombre').optional().isString(),
  body('contactoEmail')
    .optional({ checkFalsy: true })
    .isEmail()
    .withMessage('Email de contacto inválido'),
  body('contactoTelefono').optional().isString(),
  body('direccion').optional().isString(),
  body('ciudad').optional().isString(),
  body('notas').optional().isString(),
];

// ─── POST /api/clients — ADMIN + COMERCIAL ─────────────────────
router.post('/', requireRole('ADMIN', 'COMERCIAL'), writeValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: errors.array()[0].msg },
    });
  }

  const {
    razonSocial,
    ruc,
    contactoNombre,
    contactoEmail,
    contactoTelefono,
    direccion,
    ciudad,
    notas,
  } = req.body;

  try {
    const { rows } = await pool.query(
      `INSERT INTO clients
        (razon_social, ruc, contacto_nombre, contacto_email, contacto_telefono, direccion, ciudad, notas, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        razonSocial.trim(),
        ruc || null,
        contactoNombre || null,
        contactoEmail || null,
        contactoTelefono || null,
        direccion || null,
        ciudad || null,
        notas || null,
        req.user.id,
      ]
    );
    const full = await pool.query(
      `SELECT c.*,
        (SELECT COUNT(*)::int FROM projects p
         WHERE p.client_id = c.id AND p.deleted_at IS NULL) AS project_count
       FROM clients c WHERE c.id = $1`,
      [rows[0].id]
    );
    return res.status(201).json({ success: true, data: mapClient(full.rows[0]) });
  } catch (err) {
    console.error('[CLIENTS] create:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// ─── PUT /api/clients/:id — ADMIN + COMERCIAL ──────────────────
router.put('/:id', requireRole('ADMIN', 'COMERCIAL'), writeValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: errors.array()[0].msg },
    });
  }

  const {
    razonSocial,
    ruc,
    contactoNombre,
    contactoEmail,
    contactoTelefono,
    direccion,
    ciudad,
    notas,
  } = req.body;

  try {
    const { rows: ex } = await pool.query(`SELECT id FROM clients WHERE id = $1`, [req.params.id]);
    if (!ex.length) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Cliente no encontrado' } });
    }

    await pool.query(
      `UPDATE clients SET
         razon_social = $1,
         ruc = $2,
         contacto_nombre = $3,
         contacto_email = $4,
         contacto_telefono = $5,
         direccion = $6,
         ciudad = $7,
         notas = $8
       WHERE id = $9`,
      [
        razonSocial.trim(),
        ruc || null,
        contactoNombre || null,
        contactoEmail || null,
        contactoTelefono || null,
        direccion || null,
        ciudad || null,
        notas || null,
        req.params.id,
      ]
    );

    const { rows } = await pool.query(
      `SELECT c.*,
        (SELECT COUNT(*)::int FROM projects p
         WHERE p.client_id = c.id AND p.deleted_at IS NULL) AS project_count
       FROM clients c WHERE c.id = $1`,
      [req.params.id]
    );
    return res.json({ success: true, data: mapClient(rows[0]) });
  } catch (err) {
    console.error('[CLIENTS] update:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

module.exports = router;
