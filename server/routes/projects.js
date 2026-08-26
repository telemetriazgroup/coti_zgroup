const express = require('express');
const { body, validationResult } = require('express-validator');
const { pool } = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { canViewArchivedProjects, isSuperuser } = require('../utils/userRoles');
const { logAuditEvent } = require('../middleware/audit');
const { getClientIp } = require('../utils/ip');
const {
  canReadProject,
  canWriteProject,
  canManageProject,
  canCloneProject,
  canEditProjectMetadata,
  canViewProjectAudit,
} = require('../utils/projectAccess');
const { loadProjectAccessContext } = require('../utils/projectShare');
const { mapProject, PROJECT_SELECT, projectVisibilityWhere } = require('../utils/projectHelpers');
const { isValidStatusTransition } = require('../utils/projectStatusTransitions');
const {
  getUserPricingMarket,
  normalizeMarket,
  recalcProjectPricesForMarket,
} = require('../lib/pricingMarket');

const router = express.Router();
router.use(requireAuth);

// ─── GET /api/projects — listado filtrado por rol ───────────────
router.get('/', async (req, res) => {
  const includeDeleted =
    req.query.includeDeleted === 'true' && canViewArchivedProjects(req.user);

  const q = (req.query.q || '').trim();
  const clientId = (req.query.clientId || '').trim();
  const createdBy = (req.query.createdBy || '').trim();
  const dateFrom = (req.query.dateFrom || '').trim();
  const dateTo = (req.query.dateTo || '').trim();

  try {
    const uid = req.user.id;
    const role = req.user.role;

    const filters = [];
    const params = [uid, role, includeDeleted];
    let idx = 4;

    if (q) {
      filters.push(`(p.nombre ILIKE $${idx} OR p.odoo_ref ILIKE $${idx})`);
      params.push(`%${q}%`);
      idx++;
    }
    if (clientId) {
      filters.push(`p.client_id = $${idx}::uuid`);
      params.push(clientId);
      idx++;
    }
    if (createdBy && (role === 'SUPERUSER' || role === 'ADMIN' || role === 'SEMIADMIN')) {
      filters.push(`p.created_by = $${idx}::uuid`);
      params.push(createdBy);
      idx++;
    }
    if (dateFrom) {
      filters.push(`p.created_at >= $${idx}::date`);
      params.push(dateFrom);
      idx++;
    }
    if (dateTo) {
      filters.push(`p.created_at < ($${idx}::date + INTERVAL '1 day')`);
      params.push(dateTo);
      idx++;
    }

    const filterSql = filters.length ? ` AND ${filters.join(' AND ')}` : '';

    const sql = `
      ${PROJECT_SELECT}
      WHERE ${projectVisibilityWhere('$2', '$1', '$3')}${filterSql}
      ORDER BY p.updated_at DESC`;

    const { rows } = await pool.query(sql, params);
    return res.json({ success: true, data: rows.map((r) => mapProject(r, uid, role)) });
  } catch (err) {
    console.error('[PROJECTS] list:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// ─── GET /api/projects/:id/audit — solo SUPERUSER ──────────────
router.get('/:id/audit', requireRole('SUPERUSER'), async (req, res) => {
  try {
    const { rows: pr } = await pool.query(`SELECT * FROM projects WHERE id = $1`, [req.params.id]);
    if (!pr[0]) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Proyecto no encontrado' } });
    }
    if (!canViewProjectAudit(req.user)) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'No puede ver el historial de este proyecto' },
      });
    }

    const { rows } = await pool.query(
      `SELECT a.id, a.project_id, a.event_type, a.actor_id, a.prev_data, a.new_data, a.ip_address, a.created_at,
              u.email AS actor_email,
              TRIM(CONCAT(e.nombres, ' ', e.apellidos)) AS actor_name
       FROM project_audit_log a
       LEFT JOIN users u ON u.id = a.actor_id
       LEFT JOIN employees e ON e.user_id = a.actor_id
       WHERE a.project_id = $1
       ORDER BY a.created_at DESC
       LIMIT 500`,
      [req.params.id]
    );

    return res.json({
      success: true,
      data: rows.map((r) => ({
        id: r.id,
        projectId: r.project_id,
        eventType: r.event_type,
        actorId: r.actor_id,
        actorEmail: r.actor_email,
        actorName: r.actor_name,
        prevData: r.prev_data,
        newData: r.new_data,
        ipAddress: r.ip_address,
        createdAt: r.created_at,
      })),
    });
  } catch (err) {
    console.error('[PROJECTS] audit:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// ─── GET /api/projects/:id/shares ───────────────────────────────
router.get('/:id/shares', requireRole('ADMIN', 'SEMIADMIN', 'SUPERUSER'), async (req, res) => {
  try {
    const { rows: pr } = await pool.query(`SELECT * FROM projects WHERE id = $1`, [req.params.id]);
    if (!pr[0]) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Proyecto no encontrado' } });
    }
    if (!canManageProject(req.user, pr[0])) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Acceso denegado' } });
    }

    const { rows } = await pool.query(
      `SELECT ps.user_id, ps.shared_by, ps.created_at,
              u.email, u.role,
              TRIM(CONCAT(e.nombres, ' ', e.apellidos)) AS nombre
       FROM project_shares ps
       JOIN users u ON u.id = ps.user_id
       LEFT JOIN employees e ON e.user_id = ps.user_id
       WHERE ps.project_id = $1
       ORDER BY u.email`,
      [req.params.id]
    );

    return res.json({
      success: true,
      data: rows.map((r) => ({
        userId: r.user_id,
        email: r.email,
        role: r.role,
        nombre: r.nombre || r.email,
        sharedBy: r.shared_by,
        createdAt: r.created_at,
      })),
    });
  } catch (err) {
    console.error('[PROJECTS] shares get:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// ─── PUT /api/projects/:id/shares — reemplaza colaboradores ─────
router.put(
  '/:id/shares',
  requireRole('ADMIN', 'SEMIADMIN', 'SUPERUSER'),
  [body('userIds').isArray()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: errors.array()[0].msg },
      });
    }

    const userIds = [...new Set((req.body.userIds || []).filter(Boolean))];

    try {
      const { rows: pr } = await pool.query(`SELECT * FROM projects WHERE id = $1`, [req.params.id]);
      if (!pr[0]) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Proyecto no encontrado' } });
      }
      if (!canManageProject(req.user, pr[0])) {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Solo el dueño puede compartir' } });
      }
      if (pr[0].deleted_at) {
        return res.status(400).json({ success: false, error: { code: 'DELETED', message: 'Proyecto archivado' } });
      }

      if (userIds.includes(pr[0].created_by)) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_SHARE', message: 'No se comparte con el dueño del proyecto' },
        });
      }

      if (userIds.length) {
        const { rows: valid } = await pool.query(
          `SELECT id FROM users WHERE id = ANY($1::uuid[]) AND active = true AND role IN ('ADMIN', 'COMERCIAL')`,
          [userIds]
        );
        if (valid.length !== userIds.length) {
          return res.status(400).json({
            success: false,
            error: { code: 'INVALID_USERS', message: 'Solo usuarios ADMIN o COMERCIAL activos' },
          });
        }
      }

      const { rows: prevShares } = await pool.query(
        `SELECT user_id FROM project_shares WHERE project_id = $1`,
        [req.params.id]
      );
      const prevIds = prevShares.map((r) => r.user_id);

      await pool.query(`DELETE FROM project_shares WHERE project_id = $1`, [req.params.id]);

      for (const uid of userIds) {
        await pool.query(
          `INSERT INTO project_shares (project_id, user_id, shared_by) VALUES ($1, $2, $3)`,
          [req.params.id, uid, req.user.id]
        );
      }

      const ip = getClientIp(req);
      logAuditEvent({
        projectId: req.params.id,
        eventType: 'PROJECT_SHARE',
        actorId: req.user.id,
        prevData: { userIds: prevIds },
        newData: { userIds },
        ip,
      });

      const { rows: shares } = await pool.query(
        `SELECT ps.user_id, u.email, u.role
         FROM project_shares ps JOIN users u ON u.id = ps.user_id
         WHERE ps.project_id = $1 ORDER BY u.email`,
        [req.params.id]
      );

      return res.json({
        success: true,
        data: shares.map((s) => ({ userId: s.user_id, email: s.email, role: s.role })),
      });
    } catch (err) {
      console.error('[PROJECTS] shares put:', err);
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
    }
  }
);

const cloneValidation = [
  body('nombre').optional().isString(),
  body('clientId').optional({ nullable: true }).isUUID(),
  body('itemIds').optional().isArray().withMessage('itemIds debe ser un array'),
  body('itemIds.*').optional().isUUID(),
];

// ─── POST /api/projects/:id/clone ──────────────────────────────
router.post(
  '/:id/clone',
  requireRole('ADMIN', 'SEMIADMIN', 'COMERCIAL', 'SUPERUSER'),
  cloneValidation,
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: errors.array()[0].msg },
      });
    }

    const client = await pool.connect();
    try {
      const { rows: srcRows } = await client.query(`SELECT * FROM projects WHERE id = $1`, [req.params.id]);
      const src = srcRows[0];
      if (!src) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Proyecto no encontrado' } });
      }
      const shareCtx = await loadProjectAccessContext(req.user, src);
      if (!canCloneProject(req.user, src, shareCtx)) {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Acceso denegado' } });
      }
      if (src.deleted_at) {
        return res.status(400).json({
          success: false,
          error: { code: 'DELETED', message: 'No se puede clonar un proyecto archivado' },
        });
      }

      const nombre = (req.body.nombre && String(req.body.nombre).trim()) || `Copia de ${src.nombre}`;

      let targetClientId = src.client_id;
      if (Object.prototype.hasOwnProperty.call(req.body, 'clientId')) {
        targetClientId = req.body.clientId || null;
        if (targetClientId) {
          const { rows: c } = await client.query(`SELECT id FROM clients WHERE id = $1`, [targetClientId]);
          if (!c.length) {
            return res.status(400).json({
              success: false,
              error: { code: 'INVALID_CLIENT', message: 'Cliente no existe' },
            });
          }
        }
      }

      const itemIdsRaw = req.body.itemIds;
      const filterByIds = Array.isArray(itemIdsRaw);

      await client.query('BEGIN');

      const fp =
        src.finance_params && typeof src.finance_params === 'object'
          ? src.finance_params
          : {};

      const { rows: ins } = await client.query(
        `INSERT INTO projects
          (nombre, odoo_ref, client_id, status, created_by, assigned_viewer, currency, tc, finance_params, quotation_market)
         VALUES ($1, $2, $3, 'BORRADOR', $4, NULL, $5, $6, $7::jsonb, $8)
         RETURNING *`,
        [
          nombre,
          src.odoo_ref,
          targetClientId,
          req.user.id,
          src.currency,
          src.tc,
          JSON.stringify(fp),
          src.quotation_market || 'NACIONAL',
        ]
      );
      const newId = ins[0].id;

      const { rows: allItems } = await client.query(
        `SELECT * FROM project_items WHERE project_id = $1 ORDER BY sort_order ASC, created_at ASC`,
        [req.params.id]
      );

      let items;
      if (filterByIds && itemIdsRaw.length === 0) {
        items = [];
      } else if (filterByIds) {
        const selected = new Set(itemIdsRaw);
        const found = allItems.filter((it) => selected.has(it.id));
        if (found.length !== itemIdsRaw.length) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            error: { code: 'INVALID_ITEMS', message: 'Algunas partidas no pertenecen a este proyecto' },
          });
        }
        const bundleIds = new Set(found.map((it) => it.bundle_id).filter(Boolean));
        items = allItems.filter(
          (it) => selected.has(it.id) || (it.bundle_id && bundleIds.has(it.bundle_id))
        );
      } else {
        items = allItems;
      }

      const neededBundleIds = new Set(items.map((it) => it.bundle_id).filter(Boolean));
      const { rows: srcBundles } = await client.query(
        `SELECT * FROM project_item_bundles WHERE project_id = $1 ORDER BY sort_order ASC, created_at ASC`,
        [req.params.id]
      );
      const bundleIdMap = new Map();
      for (const b of srcBundles) {
        if (!neededBundleIds.has(b.id)) continue;
        const { rows: nb } = await client.query(
          `INSERT INTO project_item_bundles
             (project_id, catalog_item_id, instance_label, display_name, unit_price, qty, sort_order, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id`,
          [
            newId,
            b.catalog_item_id,
            b.instance_label,
            b.display_name,
            b.unit_price,
            b.qty,
            b.sort_order,
            req.user.id,
          ]
        );
        bundleIdMap.set(b.id, nb[0].id);
      }

      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const newBundleId = it.bundle_id ? bundleIdMap.get(it.bundle_id) || null : null;
        await client.query(
          `INSERT INTO project_items
            (project_id, catalog_item_id, codigo, descripcion, unidad, tipo, unit_price, official_unit_price,
             qty, is_custom, sort_order, category_id, apply_adjustment, created_by, updated_by,
             bundle_id, is_bundle_header, is_bundle_component,
             component_group_key, component_group_label, component_group_sort)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14, $15, $16, $17, $18, $19, $20)`,
          [
            newId,
            it.catalog_item_id,
            it.codigo,
            it.descripcion,
            it.unidad,
            it.tipo,
            it.unit_price,
            it.official_unit_price != null ? it.official_unit_price : it.unit_price,
            it.qty,
            it.is_custom,
            i,
            it.category_id,
            it.apply_adjustment !== false,
            req.user.id,
            newBundleId,
            it.is_bundle_header === true,
            it.is_bundle_component === true,
            it.component_group_key || null,
            it.component_group_label || null,
            it.component_group_sort != null ? it.component_group_sort : 0,
          ]
        );
      }

      await client.query('COMMIT');

      const ip = getClientIp(req);
      logAuditEvent({
        projectId: newId,
        eventType: 'PROJECT_CLONE',
        actorId: req.user.id,
        prevData: { sourceProjectId: req.params.id },
        newData: {
          id: newId,
          nombre,
          clientId: targetClientId,
          itemCount: items.length,
          subset: filterByIds,
        },
        ip,
      });

      const { rows: full } = await pool.query(
        `${PROJECT_SELECT} WHERE p.id = $3`,
        [req.user.id, req.user.role, newId]
      );

      return res.status(201).json({ success: true, data: mapProject(full[0], req.user.id, req.user.role) });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[PROJECTS] clone:', err);
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
    } finally {
      client.release();
    }
  }
);

const createValidation = [
  body('nombre')
    .trim()
    .notEmpty()
    .withMessage('Nombre requerido')
    .isLength({ max: 200 })
    .withMessage('Nombre máximo 200 caracteres'),
  body('odooRef')
    .optional({ values: 'falsy' })
    .isString()
    .trim()
    .isLength({ max: 50 })
    .withMessage('Referencia Odoo máximo 50 caracteres'),
  body('clientId').optional({ nullable: true }).isUUID(),
  body('status').optional().isIn([
    'BORRADOR',
    'EN_SEGUIMIENTO',
    'PRESENTADA',
    'ACEPTADA',
    'RECHAZADA',
    'EN_NEGOCIACION',
  ]),
];

// ─── POST /api/projects ────────────────────────────────────────
router.post('/', requireRole('ADMIN', 'SEMIADMIN', 'COMERCIAL', 'SUPERUSER'), createValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: errors.array()[0].msg },
    });
  }

  const { nombre, odooRef, clientId, status } = req.body;
  const odooRefNorm = odooRef != null && String(odooRef).trim() !== '' ? String(odooRef).trim() : null;

  try {
    if (clientId) {
      const { rows: c } = await pool.query(`SELECT id FROM clients WHERE id = $1`, [clientId]);
      if (!c.length) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_CLIENT', message: 'Cliente no existe' },
        });
      }
    }

    const creatorMarket = await getUserPricingMarket(req.user.id);

    const { rows } = await pool.query(
      `INSERT INTO projects (nombre, odoo_ref, client_id, status, created_by, quotation_market)
       VALUES ($1, $2, $3, COALESCE($4::project_status, 'BORRADOR'::project_status), $5, $6)
       RETURNING *`,
      [nombre.trim(), odooRefNorm, clientId || null, status || null, req.user.id, creatorMarket]
    );

    const ip = getClientIp(req);
    logAuditEvent({
      projectId: rows[0].id,
      eventType: 'PROJECT_CREATE',
      actorId: req.user.id,
      prevData: null,
      newData: mapProject(rows[0]),
      ip,
    });

    const { rows: full } = await pool.query(`${PROJECT_SELECT} WHERE p.id = $3`, [req.user.id, req.user.role, rows[0].id]);
    if (!full[0]) {
      console.error('[PROJECTS] create: fila no encontrada tras INSERT', rows[0]?.id);
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
    }
    return res.status(201).json({ success: true, data: mapProject(full[0], req.user.id, req.user.role) });
  } catch (err) {
    const code = err && err.code;
    console.error('[PROJECTS] create:', code || err.message, err.detail || '');
    if (code === '22001') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Nombre u Odoo superan el tamaño permitido en base de datos',
        },
      });
    }
    if (code === '23503') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_REFERENCE',
          message:
            'No se pudo vincular el proyecto (usuario o cliente). Cierra sesión y vuelve a entrar, o revisa el cliente seleccionado.',
        },
      });
    }
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

const updateValidation = [
  body('nombre').optional().isString(),
  body('odooRef').optional().isString(),
  body('clientId').optional({ nullable: true }).isUUID(),
  body('status').optional().isIn([
    'BORRADOR',
    'EN_SEGUIMIENTO',
    'PRESENTADA',
    'ACEPTADA',
    'RECHAZADA',
    'EN_NEGOCIACION',
  ]),
  body('currency').optional().isString(),
  body('tc').optional().isNumeric(),
  body('financeParams').optional().isObject(),
  body('quotationMarket').optional().isIn(['NACIONAL', 'INTERNACIONAL']),
];

// ─── PUT /api/projects/:id ─────────────────────────────────────
router.put('/:id', requireRole('ADMIN', 'SEMIADMIN', 'COMERCIAL', 'SUPERUSER'), updateValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: errors.array()[0].msg },
    });
  }

  try {
    const { rows: pr } = await pool.query(`SELECT * FROM projects WHERE id = $1`, [req.params.id]);
    if (!pr[0]) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Proyecto no encontrado' } });
    }
    const shareCtx = await loadProjectAccessContext(req.user, pr[0]);
    if (!canWriteProject(req.user, pr[0], shareCtx)) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Acceso denegado' } });
    }
    if (pr[0].deleted_at) {
      return res.status(400).json({
        success: false,
        error: { code: 'DELETED', message: 'El proyecto está eliminado' },
      });
    }

    const { nombre, odooRef, clientId, status, currency, tc, financeParams, quotationMarket } = req.body;

    if (clientId) {
      const { rows: c } = await pool.query(`SELECT id FROM clients WHERE id = $1`, [clientId]);
      if (!c.length) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_CLIENT', message: 'Cliente no existe' },
        });
      }
    }

    const prevSnapshot = mapProject(pr[0], req.user.id, req.user.role);

    const fields = [];
    const vals = [];
    let i = 1;

    const metadataChange =
      nombre !== undefined || odooRef !== undefined || clientId !== undefined;

    if (metadataChange) {
      if (req.user.role === 'COMERCIAL') {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Solo administradores pueden editar nombre, cliente u Odoo' },
        });
      }
      if (!canEditProjectMetadata(req.user, pr[0], shareCtx)) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Solo puede editar proyectos propios o de comerciales de su equipo',
          },
        });
      }
    }

    if (nombre !== undefined) {
      fields.push(`nombre = $${i++}`);
      vals.push(nombre.trim());
    }
    if (odooRef !== undefined) {
      fields.push(`odoo_ref = $${i++}`);
      vals.push(odooRef || null);
    }
    if (clientId !== undefined) {
      fields.push(`client_id = $${i++}`);
      vals.push(clientId || null);
    }
    if (status !== undefined) {
      if (!isValidStatusTransition(pr[0].status, status)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_STATUS_TRANSITION',
            message: `Transición no permitida: ${pr[0].status} → ${status}`,
          },
        });
      }
      fields.push(`status = $${i++}`);
      vals.push(status);
    }
    if (currency !== undefined) {
      fields.push(`currency = $${i++}`);
      vals.push(currency);
    }
    if (tc !== undefined) {
      fields.push(`tc = $${i++}`);
      vals.push(tc);
    }
    if (financeParams !== undefined) {
      if (req.user.role === 'COMERCIAL') {
        /* Comercial no altera módulos financieros ni «Vista comercial» del proyecto */
      } else {
        fields.push(`finance_params = $${i++}`);
        vals.push(JSON.stringify(financeParams));
      }
    }
    if (quotationMarket !== undefined) {
      if (!isSuperuser(req.user)) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Solo el superusuario puede cambiar el mercado de la cotización',
          },
        });
      }
      const nextMarket = normalizeMarket(quotationMarket);
      if (nextMarket !== normalizeMarket(pr[0].quotation_market)) {
        fields.push(`quotation_market = $${i++}`);
        vals.push(nextMarket);
      }
    }

    if (fields.length === 0) {
      const { rows: full } = await pool.query(`${PROJECT_SELECT} WHERE p.id = $3`, [req.user.id, req.user.role, req.params.id]);
      return res.json({ success: true, data: mapProject(full[0], req.user.id, req.user.role) });
    }

    vals.push(req.params.id);
    await pool.query(`UPDATE projects SET ${fields.join(', ')} WHERE id = $${i}`, vals);

    if (quotationMarket !== undefined && isSuperuser(req.user)) {
      const nextMarket = normalizeMarket(quotationMarket);
      if (nextMarket !== normalizeMarket(pr[0].quotation_market)) {
        await recalcProjectPricesForMarket(req.params.id, nextMarket);
      }
    }

    const { rows: newRows } = await pool.query(`SELECT * FROM projects WHERE id = $1`, [req.params.id]);
    const ip = getClientIp(req);
    logAuditEvent({
      projectId: req.params.id,
      eventType: 'PROJECT_UPDATE',
      actorId: req.user.id,
      prevData: prevSnapshot,
      newData: mapProject(newRows[0], req.user.id, req.user.role),
      ip,
    });

    const { rows: full } = await pool.query(`${PROJECT_SELECT} WHERE p.id = $3`, [req.user.id, req.user.role, req.params.id]);
    return res.json({ success: true, data: mapProject(full[0], req.user.id, req.user.role) });
  } catch (err) {
    console.error('[PROJECTS] update:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// ─── DELETE /api/projects/:id — soft delete ───────────────────
router.delete('/:id', requireRole('ADMIN', 'SEMIADMIN', 'SUPERUSER'), async (req, res) => {
  try {
    const { rows: pr } = await pool.query(`SELECT * FROM projects WHERE id = $1`, [req.params.id]);
    if (!pr[0]) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Proyecto no encontrado' } });
    }
    if (!canManageProject(req.user, pr[0])) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Acceso denegado' } });
    }
    if (pr[0].deleted_at) {
      return res.json({ success: true, data: { message: 'Ya estaba eliminado' } });
    }

    await pool.query(`UPDATE projects SET deleted_at = NOW() WHERE id = $1`, [req.params.id]);

    const ip = getClientIp(req);
    logAuditEvent({
      projectId: req.params.id,
      eventType: 'PROJECT_DELETE',
      actorId: req.user.id,
      prevData: mapProject(pr[0], req.user.id, req.user.role),
      newData: { deletedAt: new Date().toISOString() },
      ip,
    });

    return res.json({ success: true, data: { message: 'Proyecto archivado' } });
  } catch (err) {
    console.error('[PROJECTS] delete:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// ─── POST /api/projects/:id/restore — desarchivar (solo SUPERUSER) ─
router.post('/:id/restore', requireRole('SUPERUSER'), async (req, res) => {
  try {
    const { rows: pr } = await pool.query(`SELECT * FROM projects WHERE id = $1`, [req.params.id]);
    if (!pr[0]) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Proyecto no encontrado' } });
    }
    if (!pr[0].deleted_at) {
      return res.json({ success: true, data: { message: 'El proyecto no estaba archivado', id: pr[0].id } });
    }

    await pool.query(`UPDATE projects SET deleted_at = NULL, updated_at = NOW() WHERE id = $1`, [req.params.id]);

    const ip = getClientIp(req);
    logAuditEvent({
      projectId: req.params.id,
      eventType: 'PROJECT_RESTORE',
      actorId: req.user.id,
      prevData: { deletedAt: pr[0].deleted_at },
      newData: { deletedAt: null },
      ip,
    });

    const { rows: full } = await pool.query(`${PROJECT_SELECT} WHERE p.id = $3`, [
      req.user.id,
      req.user.role,
      req.params.id,
    ]);
    return res.json({
      success: true,
      data: full[0] ? mapProject(full[0], req.user.id, req.user.role) : { id: req.params.id },
    });
  } catch (err) {
    console.error('[PROJECTS] restore:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// ─── GET /api/projects/:id ─────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(`${PROJECT_SELECT} WHERE p.id = $3`, [req.user.id, req.user.role, req.params.id]);
    if (!rows[0]) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Proyecto no encontrado' } });
    }
    const shareCtx = await loadProjectAccessContext(req.user, rows[0]);
    if (!canReadProject(req.user, rows[0], shareCtx)) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Acceso denegado' } });
    }
    if (rows[0].deleted_at && !isSuperuser(req.user)) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Proyecto no encontrado' } });
    }

    return res.json({ success: true, data: mapProject(rows[0], req.user.id, req.user.role) });
  } catch (err) {
    console.error('[PROJECTS] get:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

module.exports = router;
