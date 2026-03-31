const express = require('express');
const { body, validationResult } = require('express-validator');
const { pool } = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

function mapEmployee(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    nombres: row.nombres,
    apellidos: row.apellidos,
    cargo: row.cargo,
    telefono: row.telefono,
    dni: row.dni,
    fotoUrl: row.foto_url,
    fechaIngreso: row.fecha_ingreso,
    notas: row.notas,
    email: row.email,
    role: row.role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── GET /api/employees/me — perfil del usuario autenticado ───
router.get('/me', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT e.*, u.email, u.role
       FROM employees e
       JOIN users u ON u.id = e.user_id
       WHERE e.user_id = $1`,
      [req.user.id]
    );
    if (!rows[0]) {
      return res.json({ success: true, data: { employee: null } });
    }
    return res.json({ success: true, data: { employee: mapEmployee(rows[0]) } });
  } catch (err) {
    console.error('[EMPLOYEES] me:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

const mePutValidation = [
  body('nombres').optional().isString(),
  body('apellidos').optional().isString(),
  body('cargo').optional().isString(),
  body('telefono').optional().isString(),
  body('dni').optional().isString(),
  body('fotoUrl').optional().isString(),
  body('fechaIngreso').optional({ checkFalsy: true }).isISO8601(),
  body('notas').optional().isString(),
];

router.put('/me', mePutValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: errors.array()[0].msg },
    });
  }

  const { nombres, apellidos, cargo, telefono, dni, fotoUrl, fechaIngreso, notas } = req.body;

  try {
    const { rowCount } = await pool.query(
      `UPDATE employees SET
         nombres = COALESCE($1, nombres),
         apellidos = COALESCE($2, apellidos),
         cargo = COALESCE($3, cargo),
         telefono = COALESCE($4, telefono),
         dni = COALESCE($5, dni),
         foto_url = COALESCE($6, foto_url),
         fecha_ingreso = COALESCE($7::date, fecha_ingreso),
         notas = COALESCE($8, notas)
       WHERE user_id = $9`,
      [
        nombres ?? null,
        apellidos ?? null,
        cargo ?? null,
        telefono ?? null,
        dni ?? null,
        fotoUrl ?? null,
        fechaIngreso ?? null,
        notas ?? null,
        req.user.id,
      ]
    );
    if (rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: { code: 'NO_EMPLOYEE', message: 'No hay ficha de empleado asociada' },
      });
    }
    const { rows } = await pool.query(
      `SELECT e.*, u.email, u.role FROM employees e JOIN users u ON u.id = e.user_id WHERE e.user_id = $1`,
      [req.user.id]
    );
    return res.json({ success: true, data: { employee: mapEmployee(rows[0]) } });
  } catch (err) {
    console.error('[EMPLOYEES] put me:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// ─── GET /api/employees — lista (ADMIN) ─────────────────────────
router.get('/', requireRole('ADMIN'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT e.*, u.email, u.role, u.active as user_active
       FROM employees e
       JOIN users u ON u.id = e.user_id
       ORDER BY e.apellidos, e.nombres`
    );
    return res.json({
      success: true,
      data: rows.map((r) => ({ ...mapEmployee(r), userActive: r.user_active })),
    });
  } catch (err) {
    console.error('[EMPLOYEES] list:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

const createValidation = [
  body('userId').isUUID().withMessage('userId inválido'),
  body('nombres').notEmpty().withMessage('Nombres requeridos'),
  body('apellidos').notEmpty().withMessage('Apellidos requeridos'),
];

// ─── POST /api/employees — crear ficha para usuario sin empleado (ADMIN) ───
router.post('/', requireRole('ADMIN'), createValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: errors.array()[0].msg },
    });
  }

  const { userId, nombres, apellidos, cargo, telefono, dni, fotoUrl, fechaIngreso, notas } = req.body;

  try {
    const { rows: uRows } = await pool.query(`SELECT id, role FROM users WHERE id = $1`, [userId]);
    if (!uRows[0]) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Usuario no encontrado' } });
    }
    if (uRows[0].role === 'VIEWER') {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_ROLE', message: 'Los VIEWER no tienen ficha de empleado' },
      });
    }
    const { rows: ex } = await pool.query(`SELECT id FROM employees WHERE user_id = $1`, [userId]);
    if (ex.length) {
      return res.status(409).json({
        success: false,
        error: { code: 'DUPLICATE', message: 'El usuario ya tiene ficha de empleado' },
      });
    }

    const { rows } = await pool.query(
      `INSERT INTO employees
        (user_id, nombres, apellidos, cargo, telefono, dni, foto_url, fecha_ingreso, notas)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        userId,
        nombres.trim(),
        apellidos.trim(),
        cargo || null,
        telefono || null,
        dni || null,
        fotoUrl || null,
        fechaIngreso || null,
        notas || null,
      ]
    );
    const { rows: full } = await pool.query(
      `SELECT e.*, u.email, u.role FROM employees e JOIN users u ON u.id = e.user_id WHERE e.id = $1`,
      [rows[0].id]
    );
    return res.status(201).json({ success: true, data: { employee: mapEmployee(full[0]) } });
  } catch (err) {
    console.error('[EMPLOYEES] create:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// ─── GET /api/employees/:id — ADMIN o propio empleado ──────────
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT e.*, u.email, u.role FROM employees e JOIN users u ON u.id = e.user_id WHERE e.id = $1`,
      [req.params.id]
    );
    if (!rows[0]) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'No encontrado' } });
    }
    if (req.user.role !== 'ADMIN' && rows[0].user_id !== req.user.id) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Acceso denegado' } });
    }
    return res.json({ success: true, data: { employee: mapEmployee(rows[0]) } });
  } catch (err) {
    console.error('[EMPLOYEES] get:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// ─── PUT /api/employees/:id — ADMIN o propio ───────────────────
router.put('/:id', mePutValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: errors.array()[0].msg },
    });
  }

  try {
    const { rows: cur } = await pool.query(`SELECT user_id FROM employees WHERE id = $1`, [req.params.id]);
    if (!cur[0]) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'No encontrado' } });
    }
    if (req.user.role !== 'ADMIN' && cur[0].user_id !== req.user.id) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Acceso denegado' } });
    }

    const { nombres, apellidos, cargo, telefono, dni, fotoUrl, fechaIngreso, notas } = req.body;

    await pool.query(
      `UPDATE employees SET
         nombres = COALESCE($1, nombres),
         apellidos = COALESCE($2, apellidos),
         cargo = COALESCE($3, cargo),
         telefono = COALESCE($4, telefono),
         dni = COALESCE($5, dni),
         foto_url = COALESCE($6, foto_url),
         fecha_ingreso = COALESCE($7::date, fecha_ingreso),
         notas = COALESCE($8, notas)
       WHERE id = $9`,
      [
        nombres ?? null,
        apellidos ?? null,
        cargo ?? null,
        telefono ?? null,
        dni ?? null,
        fotoUrl ?? null,
        fechaIngreso ?? null,
        notas ?? null,
        req.params.id,
      ]
    );

    const { rows } = await pool.query(
      `SELECT e.*, u.email, u.role FROM employees e JOIN users u ON u.id = e.user_id WHERE e.id = $1`,
      [req.params.id]
    );
    return res.json({ success: true, data: { employee: mapEmployee(rows[0]) } });
  } catch (err) {
    console.error('[EMPLOYEES] put:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

module.exports = router;
