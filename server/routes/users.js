const express = require('express');
const multer = require('multer');
const bcrypt = require('bcrypt');
const { body, validationResult } = require('express-validator');
const { pool } = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const {
  parseImportBuffer,
  validateImportRows,
  buildUsersXlsx,
  fetchAllUsersForExport,
  applyUserImport,
} = require('../lib/usersExcel');

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
// Todas las rutas requieren auth
router.use(requireAuth);

// ─── GET /api/users/viewers — VIEWER activos (asignación a proyectos) ───
router.get('/viewers', requireRole('ADMIN', 'COMERCIAL'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, email FROM users WHERE role = 'VIEWER' AND active = true ORDER BY email`
    );
    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error('[USERS] viewers:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// ─── GET /api/users — Lista todos los usuarios (ADMIN) ──────────
router.get('/', requireRole('ADMIN'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.role, u.active, u.created_at,
              e.nombres, e.apellidos, e.cargo, e.telefono, e.foto_url
       FROM users u
       LEFT JOIN employees e ON e.user_id = u.id
       ORDER BY u.created_at ASC`
    );

    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error('[USERS] List error:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// ─── GET /api/users/export — Excel (ADMIN) ─────────────────────
router.get('/export', requireRole('ADMIN'), async (req, res) => {
  try {
    const rows = await fetchAllUsersForExport();
    const buf = buildUsersXlsx(rows);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="zgroup-usuarios.xlsx"');
    return res.send(buf);
  } catch (err) {
    console.error('[USERS] export:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// ─── POST /api/users/import/preview — ADMIN ───────────────────
router.post('/import/preview', requireRole('ADMIN'), upload.single('file'), async (req, res) => {
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
    const { rowsForPreview, canApply } = await validateImportRows(parsed);
    return res.json({
      success: true,
      data: { rows: rowsForPreview, canApply, total: rowsForPreview.length },
    });
  } catch (err) {
    console.error('[USERS] import preview:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// ─── POST /api/users/import/apply — mismo archivo otra vez (ADMIN)
router.post('/import/apply', requireRole('ADMIN'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({
        success: false,
        error: { code: 'NO_FILE', message: 'Vuelva a adjuntar el mismo archivo .xlsx' },
      });
    }
    const { rows: parsed, parseError } = parseImportBuffer(req.file.buffer);
    if (parseError) {
      return res.status(400).json({ success: false, error: { code: 'PARSE_ERROR', message: parseError } });
    }
    const { rowsForInsert, canApply } = await validateImportRows(parsed);
    if (!canApply) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'IMPORT_INVALID',
          message: 'La validación falló. Revise el archivo y la vista previa.',
        },
      });
    }
    const { inserted } = await applyUserImport(rowsForInsert);
    return res.json({ success: true, data: { inserted } });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({
        success: false,
        error: { code: 'DUPLICATE_EMAIL', message: 'Email duplicado al insertar' },
      });
    }
    console.error('[USERS] import apply:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// ─── GET /api/users/:id — Ver usuario ──────────────────────────
router.get('/:id', async (req, res) => {
  // ADMIN puede ver cualquiera; otros solo a sí mismos
  if (req.user.role !== 'ADMIN' && req.user.id !== req.params.id) {
    return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Acceso denegado' } });
  }

  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.role, u.active, u.created_at,
              e.nombres, e.apellidos, e.cargo, e.telefono, e.dni,
              e.foto_url, e.fecha_ingreso, e.notas
       FROM users u
       LEFT JOIN employees e ON e.user_id = u.id
       WHERE u.id = $1`,
      [req.params.id]
    );

    if (!rows[0]) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Usuario no encontrado' } });

    return res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('[USERS] Get error:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// ─── POST /api/users — Crear usuario + empleado (ADMIN) ─────────
const createValidation = [
  body('email').isEmail().withMessage('Email inválido'),
  body('password').isLength({ min: 8 }).withMessage('Contraseña mínimo 8 caracteres'),
  body('role').isIn(['ADMIN', 'COMERCIAL', 'VIEWER']).withMessage('Rol inválido'),
  body('nombres')
    .if((_, { req }) => ['ADMIN', 'COMERCIAL'].includes(req.body.role))
    .notEmpty()
    .withMessage('Nombres requeridos'),
  body('apellidos')
    .if((_, { req }) => ['ADMIN', 'COMERCIAL'].includes(req.body.role))
    .notEmpty()
    .withMessage('Apellidos requeridos'),
];

router.post('/', requireRole('ADMIN'), createValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: errors.array()[0].msg }
    });
  }

  const { email, password, role, nombres, apellidos, cargo, telefono, dni, fechaIngreso } = req.body;

  try {
    // Verificar email único
    const { rows: existing } = await pool.query(
      'SELECT id FROM users WHERE email = $1', [email.toLowerCase().trim()]
    );
    if (existing.length > 0) {
      return res.status(409).json({
        success: false,
        error: { code: 'DUPLICATE_EMAIL', message: 'El email ya está registrado' }
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    // Crear usuario + empleado en transacción
    const client = await require('../config/db').pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: userRows } = await client.query(
        `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id`,
        [email.toLowerCase().trim(), passwordHash, role]
      );
      const userId = userRows[0].id;

      // Solo ADMIN y COMERCIAL tienen registro de empleado
      if (role !== 'VIEWER') {
        await client.query(
          `INSERT INTO employees (user_id, nombres, apellidos, cargo, telefono, dni, fecha_ingreso)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [userId, nombres, apellidos, cargo || null, telefono || null, dni || null, fechaIngreso || null]
        );
      }

      await client.query('COMMIT');

      return res.status(201).json({
        success: true,
        data: { id: userId, email: email.toLowerCase().trim(), role }
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

  } catch (err) {
    console.error('[USERS] Create error:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// ─── PUT /api/users/:id — Editar usuario ────────────────────────
router.put('/:id', async (req, res) => {
  // ADMIN puede editar cualquiera; otros solo a sí mismos (sin cambiar rol)
  if (req.user.role !== 'ADMIN' && req.user.id !== req.params.id) {
    return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Acceso denegado' } });
  }

  const { nombres, apellidos, cargo, telefono, dni, fechaIngreso, notas, password, role, active } = req.body;

  try {
    if (active === false && req.params.id === req.user.id) {
      return res.status(400).json({
        success: false,
        error: { code: 'SELF_DEACTIVATE', message: 'No puedes desactivar tu propio usuario' },
      });
    }

    // Actualizar datos de usuario si aplica
    if (password || (role && req.user.role === 'ADMIN') || active !== undefined) {
      const updates = [];
      const params = [];
      let idx = 1;

      if (password) {
        updates.push(`password_hash = $${idx++}`);
        params.push(await bcrypt.hash(password, 12));
      }
      if (role && req.user.role === 'ADMIN') {
        updates.push(`role = $${idx++}`);
        params.push(role);
      }
      if (active !== undefined && req.user.role === 'ADMIN') {
        updates.push(`active = $${idx++}`);
        params.push(active);
      }

      if (updates.length > 0) {
        params.push(req.params.id);
        await pool.query(
          `UPDATE users SET ${updates.join(', ')} WHERE id = $${idx}`,
          params
        );
      }
    }

    // Actualizar datos de empleado
    if (nombres || apellidos || cargo || telefono || dni || fechaIngreso || notas) {
      await pool.query(
        `UPDATE employees SET
           nombres = COALESCE($1, nombres),
           apellidos = COALESCE($2, apellidos),
           cargo = COALESCE($3, cargo),
           telefono = COALESCE($4, telefono),
           dni = COALESCE($5, dni),
           fecha_ingreso = COALESCE($6, fecha_ingreso),
           notas = COALESCE($7, notas)
         WHERE user_id = $8`,
        [nombres, apellidos, cargo, telefono, dni, fechaIngreso, notas, req.params.id]
      );
    }

    return res.json({ success: true, data: { message: 'Usuario actualizado' } });
  } catch (err) {
    console.error('[USERS] Update error:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// ─── DELETE /api/users/:id — Desactivar usuario (ADMIN) ─────────
router.delete('/:id', requireRole('ADMIN'), async (req, res) => {
  if (req.params.id === req.user.id) {
    return res.status(400).json({
      success: false,
      error: { code: 'SELF_DELETE', message: 'No puedes desactivar tu propio usuario' }
    });
  }

  try {
    await pool.query('UPDATE users SET active = false WHERE id = $1', [req.params.id]);
    return res.json({ success: true, data: { message: 'Usuario desactivado' } });
  } catch (err) {
    console.error('[USERS] Delete error:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

module.exports = router;
