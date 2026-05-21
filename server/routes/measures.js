const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { pool } = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

function mapRow(row) {
  return {
    id: row.id,
    suffix: row.suffix,
    nombre: row.nombre,
    sortOrder: row.sort_order,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeSuffix(s) {
  return String(s || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .slice(0, 30);
}

// GET /api/measures
router.get('/', async (req, res) => {
  try {
    const activeOnly = req.query.includeInactive !== 'true';
    const sql = activeOnly
      ? `SELECT * FROM measure_units WHERE active = true ORDER BY sort_order, suffix`
      : `SELECT * FROM measure_units ORDER BY sort_order, suffix`;
    const { rows } = await pool.query(sql);
    return res.json({ success: true, data: rows.map(mapRow) });
  } catch (err) {
    console.error('[MEASURES] list:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// POST /api/measures — ADMIN
router.post(
  '/',
  requireRole('ADMIN', 'SUPERUSER'),
  [
    body('suffix').isString().trim().notEmpty(),
    body('nombre').isString().trim().notEmpty(),
    body('sortOrder').optional().isInt({ min: 0 }),
    body('active').optional().isBoolean(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: errors.array()[0].msg },
      });
    }
    const suffix = normalizeSuffix(req.body.suffix);
    const { nombre, sortOrder, active } = req.body;
    if (!suffix) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Sufijo inválido' },
      });
    }
    try {
      const { rows } = await pool.query(
        `INSERT INTO measure_units (suffix, nombre, sort_order, active)
         VALUES ($1, $2, COALESCE($3, 0), COALESCE($4, true))
         RETURNING *`,
        [suffix, nombre.trim(), sortOrder, active]
      );
      return res.status(201).json({ success: true, data: mapRow(rows[0]) });
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({
          success: false,
          error: { code: 'DUPLICATE_SUFFIX', message: 'Ya existe una medida con ese sufijo' },
        });
      }
      console.error('[MEASURES] create:', err);
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
    }
  }
);

// PUT /api/measures/:id — ADMIN
router.put(
  '/:id',
  requireRole('ADMIN', 'SUPERUSER'),
  [
    param('id').isUUID(),
    body('suffix').optional().isString(),
    body('nombre').optional().isString(),
    body('sortOrder').optional().isInt({ min: 0 }),
    body('active').optional().isBoolean(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: errors.array()[0].msg },
      });
    }
    const { nombre, sortOrder, active } = req.body;
    const fields = [];
    const vals = [];
    let i = 1;

    if (req.body.suffix !== undefined) {
      const suffix = normalizeSuffix(req.body.suffix);
      if (!suffix) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Sufijo inválido' },
        });
      }
      fields.push(`suffix = $${i++}`);
      vals.push(suffix);
    }
    if (nombre !== undefined) {
      fields.push(`nombre = $${i++}`);
      vals.push(nombre.trim());
    }
    if (sortOrder !== undefined) {
      fields.push(`sort_order = $${i++}`);
      vals.push(sortOrder);
    }
    if (active !== undefined) {
      fields.push(`active = $${i++}`);
      vals.push(active);
    }
    if (!fields.length) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Sin cambios' },
      });
    }
    fields.push('updated_at = NOW()');
    vals.push(req.params.id);

    try {
      const { rows } = await pool.query(
        `UPDATE measure_units SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
        vals
      );
      if (!rows[0]) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Medida no encontrada' } });
      }
      return res.json({ success: true, data: mapRow(rows[0]) });
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({
          success: false,
          error: { code: 'DUPLICATE_SUFFIX', message: 'Ya existe una medida con ese sufijo' },
        });
      }
      console.error('[MEASURES] update:', err);
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
    }
  }
);

module.exports = router;
