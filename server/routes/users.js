const express = require('express');
const multer = require('multer');
const bcrypt = require('bcrypt');
const { body, validationResult } = require('express-validator');
const { pool } = require('../config/db');
const { isAdminLikeRole } = require('../utils/userRoles');
const { requireAuth, requireRole } = require('../middleware/auth');
const { canCreateRole, allowedCreateRoles } = require('../lib/userCreation');
const {
  parseImportBuffer,
  validateImportRows,
  buildUsersXlsx,
  fetchAllUsersForExport,
  applyUserImport,
} = require('../lib/usersExcel');
const { buildDefaultPassword } = require('../lib/defaultPassword');
const { normalizeMarket, MARKETS } = require('../lib/pricingMarket');

function commercialFinanceFromBody(body) {
  const m1 = body.canSeeFinanceM1 === true;
  const cp = body.canSeeFinanceCp === true;
  const lp = body.canSeeFinanceLp === true;
  const est = body.canSeeFinanceEst === true;
  const legacy = body.canSeeFinanceSummary === true;
  return {
    m1: legacy || m1,
    cp: legacy || cp,
    lp: legacy || lp,
    est: legacy || est,
    summary: legacy || m1 || cp || lp || est,
  };
}

async function userManagedBy(actor, targetId) {
  if (actor.id === targetId) return true;
  if (actor.role === 'SUPERUSER') return true;
  if (isAdminLikeRole(actor.role)) {
    const { rows } = await pool.query(
      `SELECT 1 FROM users u WHERE u.id = $1 AND (
        u.created_by = $2 OR u.id = $2 OR EXISTS (
          SELECT 1 FROM admin_commercial_assignments a
          WHERE a.admin_id = $2 AND a.commercial_id = u.id
        )
      )`,
      [targetId, actor.id]
    );
    return rows.length > 0;
  }
  if (actor.role === 'COMERCIAL') {
    const { rows } = await pool.query(
      `SELECT 1 FROM users WHERE id = $1 AND created_by = $2`,
      [targetId, actor.id]
    );
    return rows.length > 0;
  }
  return false;
}

async function canResetUserPassword(actor, targetId) {
  if (actor.id === targetId) return false;
  if (actor.role === 'SUPERUSER') return true;
  const { rows } = await pool.query(`SELECT id FROM users WHERE id = $1 AND created_by = $2`, [
    targetId,
    actor.id,
  ]);
  return rows.length > 0;
}

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
router.get('/viewers', requireRole('ADMIN', 'SEMIADMIN', 'COMERCIAL', 'SUPERUSER'), async (req, res) => {
  try {
    let sql = `SELECT id, email FROM users WHERE role = 'VIEWER' AND active = true`;
    const params = [];
    if (req.user.role === 'COMERCIAL') {
      params.push(req.user.id);
      sql += ` AND created_by = $1::uuid`;
    } else if (isAdminLikeRole(req.user.role)) {
      params.push(req.user.id);
      sql += ` AND (created_by = $1::uuid OR created_by IS NULL)`;
    }
    sql += ` ORDER BY email`;
    const { rows } = await pool.query(sql, params);
    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error('[USERS] viewers:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// ─── GET /api/users/managed-commercials — equipo del ADMIN ─────
router.get('/managed-commercials', requireRole('ADMIN', 'SEMIADMIN', 'SUPERUSER'), async (req, res) => {
  try {
    const adminId = req.user.role === 'SUPERUSER' && req.query.adminId ? req.query.adminId : req.user.id;
    if (isAdminLikeRole(req.user.role) && adminId !== req.user.id) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Acceso denegado' } });
    }
    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.active, u.created_by, u.pricing_market, u.can_see_finance_summary,
              TRIM(CONCAT(e.nombres, ' ', e.apellidos)) AS nombre,
              (u.created_by = $1::uuid) AS created_by_me,
              EXISTS (
                SELECT 1 FROM admin_commercial_assignments a
                WHERE a.admin_id = $1::uuid AND a.commercial_id = u.id
              ) AS assigned_by_super
       FROM users u
       LEFT JOIN employees e ON e.user_id = u.id
       WHERE u.role = 'COMERCIAL' AND u.active = true AND (
         u.created_by = $1::uuid OR
         EXISTS (
           SELECT 1 FROM admin_commercial_assignments a
           WHERE a.admin_id = $1::uuid AND a.commercial_id = u.id
         )
       )
       ORDER BY u.email`,
      [adminId]
    );
    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error('[USERS] managed-commercials:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// ─── GET /api/users/shareable — buscar usuarios para compartir proyecto ───
router.get('/shareable', requireRole('ADMIN', 'SEMIADMIN', 'SUPERUSER'), async (req, res) => {
  try {
    const q = (req.query.q || '').trim().toLowerCase();
    let sql = `
      SELECT u.id, u.email, u.role,
             TRIM(CONCAT(e.nombres, ' ', e.apellidos)) AS nombre
      FROM users u
      LEFT JOIN employees e ON e.user_id = u.id
      WHERE u.active = true AND u.role IN ('ADMIN', 'COMERCIAL') AND u.id != $1`;
    const params = [req.user.id];
    if (q) {
      params.push(`%${q}%`);
      sql += ` AND (
        LOWER(u.email) LIKE $2 OR
        LOWER(COALESCE(e.nombres, '')) LIKE $2 OR
        LOWER(COALESCE(e.apellidos, '')) LIKE $2 OR
        LOWER(TRIM(CONCAT(COALESCE(e.nombres, ''), ' ', COALESCE(e.apellidos, '')))) LIKE $2
      )`;
    }
    sql += ` ORDER BY u.email LIMIT 50`;
    const { rows } = await pool.query(sql, params);
    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error('[USERS] shareable:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// ─── GET /api/users/allowed-roles — roles que puede crear el usuario actual ───
router.get('/allowed-roles', requireAuth, async (req, res) => {
  return res.json({ success: true, data: allowedCreateRoles(req.user.role) });
});

// ─── GET /api/users — Lista usuarios según rol ──────────
router.get('/', requireRole('ADMIN', 'SEMIADMIN', 'COMERCIAL', 'SUPERUSER'), async (req, res) => {
  try {
    let sql = `
      SELECT u.id, u.email, u.role, u.active, u.created_by, u.created_at,
              u.pricing_market, u.can_see_finance_summary,
              u.can_see_finance_m1, u.can_see_finance_cp, u.can_see_finance_lp, u.can_see_finance_est,
              e.nombres, e.apellidos, e.cargo, e.telefono, e.foto_url,
              cb.email AS created_by_email
       FROM users u
       LEFT JOIN employees e ON e.user_id = u.id
       LEFT JOIN users cb ON cb.id = u.created_by`;
    const params = [];

    if (req.user.role === 'ADMIN' || req.user.role === 'SEMIADMIN') {
      sql += `
       WHERE u.id = $1 OR u.created_by = $1 OR (
         u.role = 'COMERCIAL' AND EXISTS (
           SELECT 1 FROM admin_commercial_assignments a
           WHERE a.admin_id = $1 AND a.commercial_id = u.id
         )
       )`;
      params.push(req.user.id);
    } else if (req.user.role === 'COMERCIAL') {
      sql += ` WHERE u.created_by = $1`;
      params.push(req.user.id);
    }

    sql += ` ORDER BY u.created_at ASC`;

    const { rows } = await pool.query(sql, params);
    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error('[USERS] List error:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// ─── GET /api/users/export — Excel (ADMIN) ─────────────────────
router.get('/export', requireRole('ADMIN', 'SEMIADMIN', 'SUPERUSER'), async (req, res) => {
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
router.post('/import/preview', requireRole('ADMIN', 'SEMIADMIN', 'SUPERUSER'), upload.single('file'), async (req, res) => {
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
router.post('/import/apply', requireRole('ADMIN', 'SEMIADMIN', 'SUPERUSER'), upload.single('file'), async (req, res) => {
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

// ─── POST /api/users/:id/reset-password — reinicio a contraseña por defecto ───
router.post('/:id/reset-password', requireRole('ADMIN', 'SEMIADMIN', 'COMERCIAL', 'SUPERUSER'), async (req, res) => {
  try {
    const allowed = await canResetUserPassword(req.user, req.params.id);
    if (!allowed) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'No puede reiniciar la contraseña de este usuario' },
      });
    }

    const { rows } = await pool.query(`SELECT id, email FROM users WHERE id = $1 AND active = true`, [
      req.params.id,
    ]);
    if (!rows[0]) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Usuario no encontrado' },
      });
    }

    const defaultPassword = buildDefaultPassword(rows[0].email);
    const passwordHash = await bcrypt.hash(defaultPassword, 12);
    await pool.query(`UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`, [
      passwordHash,
      rows[0].id,
    ]);

    return res.json({
      success: true,
      data: {
        email: rows[0].email,
        defaultPassword,
        message: 'Contraseña reiniciada. Comunique la nueva contraseña al usuario de forma segura.',
      },
    });
  } catch (err) {
    console.error('[USERS] reset-password:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// ─── GET /api/users/:id — Ver usuario ──────────────────────────
router.get('/:id', async (req, res) => {
  if (req.user.id !== req.params.id) {
    if (req.user.role === 'SUPERUSER') {
      /* ok */
    } else if (isAdminLikeRole(req.user.role)) {
      const { rows: ok } = await pool.query(
        `SELECT 1 FROM users u WHERE u.id = $1 AND (
          u.created_by = $2 OR u.id = $2 OR EXISTS (
            SELECT 1 FROM admin_commercial_assignments a
            WHERE a.admin_id = $2 AND a.commercial_id = u.id
          )
        )`,
        [req.params.id, req.user.id]
      );
      if (!ok.length) {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Acceso denegado' } });
      }
    } else if (req.user.role === 'COMERCIAL') {
      const { rows: ok } = await pool.query(
        `SELECT 1 FROM users WHERE id = $1 AND created_by = $2`,
        [req.params.id, req.user.id]
      );
      if (!ok.length) {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Acceso denegado' } });
      }
    } else {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Acceso denegado' } });
    }
  }

  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.role, u.active, u.created_at, u.pricing_market, u.can_see_finance_summary,
              u.can_see_finance_m1, u.can_see_finance_cp, u.can_see_finance_lp, u.can_see_finance_est,
              e.nombres, e.apellidos, e.cargo, e.telefono, e.dni,
              e.foto_url, e.fecha_ingreso, e.notas
       FROM users u
       LEFT JOIN employees e ON e.user_id = u.id
       WHERE u.id = $1`,
      [req.params.id]
    );

    if (!rows[0]) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Usuario no encontrado' } });

    const r = rows[0];
    return res.json({
      success: true,
      data: {
        id: r.id,
        email: r.email,
        role: r.role,
        active: r.active,
        createdAt: r.created_at,
        pricingMarket: r.pricing_market || 'NACIONAL',
        canSeeFinanceSummary: r.can_see_finance_summary === true,
        canSeeFinanceM1: r.can_see_finance_m1 === true,
        canSeeFinanceCp: r.can_see_finance_cp === true,
        canSeeFinanceLp: r.can_see_finance_lp === true,
        canSeeFinanceEst: r.can_see_finance_est === true,
        nombres: r.nombres,
        apellidos: r.apellidos,
        cargo: r.cargo,
        telefono: r.telefono,
        dni: r.dni,
        fotoUrl: r.foto_url,
        fechaIngreso: r.fecha_ingreso,
        notas: r.notas,
      },
    });
  } catch (err) {
    console.error('[USERS] Get error:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// ─── POST /api/users — Crear usuario + empleado (ADMIN) ─────────
const createValidation = [
  body('email').isEmail().withMessage('Email inválido'),
  body('password').isLength({ min: 8 }).withMessage('Contraseña mínimo 8 caracteres'),
  body('role').isIn(['SUPERUSER', 'ADMIN', 'SEMIADMIN', 'COMERCIAL', 'VIEWER']).withMessage('Rol inválido'),
  body('nombres')
    .if((_, { req }) => ['ADMIN', 'COMERCIAL'].includes(req.body.role))
    .notEmpty()
    .withMessage('Nombres requeridos'),
  body('apellidos')
    .if((_, { req }) => ['ADMIN', 'COMERCIAL'].includes(req.body.role))
    .notEmpty()
    .withMessage('Apellidos requeridos'),
];

router.post('/', requireRole('ADMIN', 'SEMIADMIN', 'COMERCIAL', 'SUPERUSER'), createValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: errors.array()[0].msg }
    });
  }

  const {
    email,
    password,
    role,
    nombres,
    apellidos,
    cargo,
    telefono,
    dni,
    fechaIngreso,
    canSeeFinanceSummary,
    canSeeFinanceM1,
    canSeeFinanceCp,
    canSeeFinanceLp,
    canSeeFinanceEst,
  } = req.body;
  const isElevated = ['ADMIN', 'SUPERUSER'].includes(req.user.role);

  if (!canCreateRole(req.user.role, role)) {
    return res.status(403).json({
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: `No puede crear usuarios con rol ${role}. Permitidos: ${allowedCreateRoles(req.user.role).join(', ')}`,
      },
    });
  }

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

      const financeAccess =
        role === 'COMERCIAL' && isElevated
          ? commercialFinanceFromBody({
              canSeeFinanceSummary,
              canSeeFinanceM1,
              canSeeFinanceCp,
              canSeeFinanceLp,
              canSeeFinanceEst,
            })
          : { m1: false, cp: false, lp: false, est: false, summary: false };

      const { rows: userRows } = await client.query(
        `INSERT INTO users (
           email, password_hash, role, created_by,
           can_see_finance_summary, can_see_finance_m1, can_see_finance_cp,
           can_see_finance_lp, can_see_finance_est
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [
          email.toLowerCase().trim(),
          passwordHash,
          role,
          req.user.id,
          financeAccess.summary,
          financeAccess.m1,
          financeAccess.cp,
          financeAccess.lp,
          financeAccess.est,
        ]
      );
      const userId = userRows[0].id;

      // Solo ADMIN y COMERCIAL tienen registro de empleado
      if (role !== 'VIEWER' && role !== 'SUPERUSER') {
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
  const isSelf = req.user.id === req.params.id;
  const canManage = await userManagedBy(req.user, req.params.id);
  if (!isSelf && !canManage) {
    return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Acceso denegado' } });
  }

  const {
    nombres,
    apellidos,
    cargo,
    telefono,
    dni,
    fechaIngreso,
    notas,
    password,
    role,
    active,
    pricingMarket,
    canSeeFinanceSummary,
    canSeeFinanceM1,
    canSeeFinanceCp,
    canSeeFinanceLp,
    canSeeFinanceEst,
  } = req.body;
  const isElevated = ['ADMIN', 'SUPERUSER'].includes(req.user.role);
  const hasFinanceUpdate =
    canSeeFinanceSummary !== undefined ||
    canSeeFinanceM1 !== undefined ||
    canSeeFinanceCp !== undefined ||
    canSeeFinanceLp !== undefined ||
    canSeeFinanceEst !== undefined;

  try {
    if (active === false && isSelf) {
      return res.status(400).json({
        success: false,
        error: { code: 'SELF_DEACTIVATE', message: 'No puedes desactivar tu propio usuario' },
      });
    }

    if (
      password ||
      (role && isElevated) ||
      (active !== undefined && (isElevated || req.user.role === 'COMERCIAL')) ||
      pricingMarket !== undefined ||
      hasFinanceUpdate
    ) {
      const updates = [];
      const params = [];
      let idx = 1;

      if (pricingMarket !== undefined) {
        if (req.user.role !== 'SUPERUSER') {
          return res.status(403).json({
            success: false,
            error: { code: 'FORBIDDEN', message: 'Solo el superusuario puede cambiar el mercado del usuario' },
          });
        }
        if (!MARKETS.includes(pricingMarket)) {
          return res.status(400).json({
            success: false,
            error: { code: 'VALIDATION_ERROR', message: 'Mercado inválido' },
          });
        }
        updates.push(`pricing_market = $${idx++}`);
        params.push(normalizeMarket(pricingMarket));
      }

      if (hasFinanceUpdate) {
        if (!isElevated) {
          return res.status(403).json({
            success: false,
            error: { code: 'FORBIDDEN', message: 'Acceso denegado' },
          });
        }
        const { rows: targetRows } = await pool.query(`SELECT role FROM users WHERE id = $1`, [req.params.id]);
        if (!targetRows[0] || targetRows[0].role !== 'COMERCIAL') {
          return res.status(400).json({
            success: false,
            error: { code: 'VALIDATION_ERROR', message: 'Solo aplica a usuarios comerciales' },
          });
        }
        const access = commercialFinanceFromBody({
          canSeeFinanceSummary,
          canSeeFinanceM1,
          canSeeFinanceCp,
          canSeeFinanceLp,
          canSeeFinanceEst,
        });
        updates.push(`can_see_finance_summary = $${idx++}`);
        params.push(access.summary);
        updates.push(`can_see_finance_m1 = $${idx++}`);
        params.push(access.m1);
        updates.push(`can_see_finance_cp = $${idx++}`);
        params.push(access.cp);
        updates.push(`can_see_finance_lp = $${idx++}`);
        params.push(access.lp);
        updates.push(`can_see_finance_est = $${idx++}`);
        params.push(access.est);
      }

      if (password) {
        if (isSelf) {
          return res.status(400).json({
            success: false,
            error: {
              code: 'USE_PROFILE_PASSWORD',
              message: 'Use Mi perfil para cambiar su contraseña con verificación de la actual',
            },
          });
        }
        updates.push(`password_hash = $${idx++}`);
        params.push(await bcrypt.hash(password, 12));
      }
      if (role && isElevated && !isSelf) {
        if (!canCreateRole(req.user.role, role)) {
          return res.status(403).json({
            success: false,
            error: { code: 'FORBIDDEN', message: 'No puede asignar ese rol' },
          });
        }
        updates.push(`role = $${idx++}`);
        params.push(role);
      }
      if (active !== undefined && (isElevated || (req.user.role === 'COMERCIAL' && canManage && !isSelf))) {
        updates.push(`active = $${idx++}`);
        params.push(active);
      }

      if (updates.length > 0) {
        params.push(req.params.id);
        await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${idx}`, params);
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
router.delete('/:id', requireRole('ADMIN', 'SEMIADMIN', 'COMERCIAL', 'SUPERUSER'), async (req, res) => {
  if (req.params.id === req.user.id) {
    return res.status(400).json({
      success: false,
      error: { code: 'SELF_DELETE', message: 'No puedes desactivar tu propio usuario' }
    });
  }

  try {
    if (req.user.role === 'COMERCIAL') {
      const { rows } = await pool.query(
        `SELECT id FROM users WHERE id = $1 AND created_by = $2 AND role = 'VIEWER'`,
        [req.params.id, req.user.id]
      );
      if (!rows.length) {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Acceso denegado' } });
      }
    } else if (isAdminLikeRole(req.user.role)) {
      const { rows } = await pool.query(
        `SELECT id FROM users WHERE id = $1 AND (created_by = $2 OR id IN (
          SELECT commercial_id FROM admin_commercial_assignments WHERE admin_id = $2
        ))`,
        [req.params.id, req.user.id]
      );
      if (!rows.length && req.params.id !== req.user.id) {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Acceso denegado' } });
      }
    }

    await pool.query('UPDATE users SET active = false WHERE id = $1', [req.params.id]);
    return res.json({ success: true, data: { message: 'Usuario desactivado' } });
  } catch (err) {
    console.error('[USERS] Delete error:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

module.exports = router;
