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
const { partnerDisplayTags } = require('../lib/odoo/partnerEligibility');
const { isOdooWriteAllowed } = require('../lib/odoo/config');
const { validatePartnerWrite, normalizeVat, shouldConsultSunat } = require('../lib/odoo/partnerValidate');
const { enqueueCreate, enqueueWrite } = require('../lib/odoo/pushPartners');
const { randomUUID } = require('crypto');
const {
  logClientCreate,
  logClientChanges,
  clientUpdateChanges,
  fetchClientHistory,
} = require('../lib/clientChangeLog');
const {
  searchPicker,
  ensureClientFromOdoo,
  fetchClientRow,
  loadCategoryIds,
  fetchClientFicha,
} = require('../lib/odoo/projectClients');
const { lookupPartnersByQuery } = require('../lib/odoo/pullPartners');
const { CircuitOpenError } = require('../lib/odoo/circuitBreaker');
const { XmlrpcFault } = require('../lib/odoo/xmlrpcCodec');

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
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

const WRITE_ROLES = ['ADMIN', 'SEMIADMIN', 'COMERCIAL', 'SUPERUSER'];
const HISTORY_ROLES = ['ADMIN', 'SEMIADMIN', 'COMERCIAL', 'SUPERUSER'];

const CLIENT_SELECT = `
      SELECT c.*,
        op.is_company,
        op.category_ids,
        op.parent_odoo_id AS partner_parent_id,
        parent.name AS parent_name,
        ox.op AS outbox_op,
        ox.status AS outbox_status,
        ox.last_error AS outbox_last_error,
        ox.attempts AS outbox_attempts,
        ox.next_attempt_at AS outbox_next_attempt,
        ox.created_at AS outbox_at,
        ox.outbox_sunat,
        (SELECT COUNT(*)::int FROM projects p
         WHERE p.client_id = c.id AND p.deleted_at IS NULL) AS project_count
      FROM clients c
      LEFT JOIN odoo_partners op ON op.odoo_id = c.odoo_id
      LEFT JOIN odoo_partners parent ON parent.odoo_id = COALESCE(c.odoo_parent_id, op.parent_odoo_id)
      LEFT JOIN LATERAL (
        SELECT o.op, o.status, o.last_error, o.attempts, o.next_attempt_at, o.created_at,
               COALESCE((o.payload->>'consultarSunat') = 'true', false) AS outbox_sunat
          FROM odoo_outbox o
         WHERE o.client_id = c.id
         ORDER BY o.created_at DESC
         LIMIT 1
      ) ox ON true`;

function mapOutbox(row) {
  if (!row.outbox_status) return null;
  return {
    op: row.outbox_op,
    status: row.outbox_status,
    lastError: row.outbox_last_error || null,
    attempts: Number(row.outbox_attempts) || 0,
    nextAttemptAt: row.outbox_next_attempt || null,
    at: row.outbox_at || null,
    consultarSunat: row.outbox_sunat === true,
  };
}

function requireOdooConfigured(res) {
  const gate = isOdooWriteAllowed();
  if (gate.ok) return false;
  const status = gate.code === 'ODOO_NOT_CONFIGURED' ? 503 : 403;
  res.status(status).json({
    success: false,
    error: { code: gate.code, message: gate.message },
  });
  return true;
}

function payloadFromBody(body) {
  const p = {};
  if (body.razonSocial !== undefined) p.razonSocial = body.razonSocial;
  if (body.ruc !== undefined) p.ruc = body.ruc;
  if (body.contactoNombre !== undefined) p.contactoNombre = body.contactoNombre;
  if (body.contactoEmail !== undefined) p.contactoEmail = body.contactoEmail;
  if (body.contactoTelefono !== undefined) p.contactoTelefono = body.contactoTelefono;
  if (body.direccion !== undefined) p.direccion = body.direccion;
  if (body.ciudad !== undefined) p.ciudad = body.ciudad;
  if (body.street2 !== undefined) p.street2 = body.street2;
  if (body.zip !== undefined) p.zip = body.zip;
  if (body.website !== undefined) p.website = body.website;
  if (body.mobile !== undefined) p.mobile = body.mobile;
  if (body.notas !== undefined) p.notas = body.notas;
  return p;
}

function hasOdooPushFields(payload) {
  return [
    'razonSocial',
    'ruc',
    'contactoEmail',
    'contactoTelefono',
    'direccion',
    'ciudad',
    'street2',
    'zip',
    'website',
    'mobile',
    'notas',
  ].some((k) => payload[k] !== undefined);
}

function mapClient(row, catIds = {}) {
  const origin = row.sync_origin || 'local';
  const tags = partnerDisplayTags(
    {
      isCompany: row.is_company === true,
      parentOdooId:
        row.partner_parent_id != null
          ? Number(row.partner_parent_id)
          : row.odoo_parent_id != null
            ? Number(row.odoo_parent_id)
            : null,
      categoryIds: Array.isArray(row.category_ids) ? row.category_ids.map(Number) : [],
    },
    catIds
  );
  if (origin === 'local' && row.odoo_id == null && !tags.includes('local')) {
    tags.unshift('local');
  }
  return {
    id: row.id,
    active: row.active !== false,
    razonSocial: row.razon_social,
    ruc: row.ruc,
    contactoNombre: row.contacto_nombre,
    contactoEmail: row.contacto_email,
    contactoTelefono: row.contacto_telefono,
    direccion: row.direccion,
    ciudad: row.ciudad,
    notas: row.notas,
    createdBy: row.created_by,
    odooId: row.odoo_id != null ? Number(row.odoo_id) : null,
    odooParentId: row.odoo_parent_id != null ? Number(row.odoo_parent_id) : null,
    odooContactId: row.odoo_contact_id != null ? Number(row.odoo_contact_id) : null,
    syncOrigin: origin,
    odooWriteDate: row.odoo_write_date || null,
    isCompany: row.is_company == null ? true : row.is_company === true,
    parentName: row.parent_name || null,
    tags,
    odooOwned: origin === 'odoo' || origin === 'linked',
    xZtrackUid: row.x_ztrack_uid || null,
    outbox: mapOutbox(row),
    projectCount: row.project_count != null ? Number(row.project_count) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── GET /api/clients — lista + búsqueda (todos los roles autenticados) ───
router.get('/', async (req, res) => {
  const q = (req.query.q || '').trim();
  const includeInactive = req.query.includeInactive === 'true';
  const limitRaw = req.query.limit != null ? parseInt(String(req.query.limit), 10) : null;
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : null;
  try {
    const catIds = await loadCategoryIds();
    let sql = `${CLIENT_SELECT} WHERE 1=1`;
    const params = [];
    if (!includeInactive) {
      sql += ` AND c.active = true`;
    }
    if (q) {
      params.push(`%${q.replace(/[%_]/g, ' ')}%`);
      const p = `$${params.length}`;
      sql += ` AND (
        c.razon_social ILIKE ${p} OR
        COALESCE(c.ruc, '') ILIKE ${p} OR
        COALESCE(c.contacto_nombre, '') ILIKE ${p} OR
        COALESCE(c.contacto_email, '') ILIKE ${p} OR
        COALESCE(c.ciudad, '') ILIKE ${p} OR
        (
          c.odoo_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM odoo_partners ch
            WHERE ch.parent_odoo_id = c.odoo_id
              AND (
                COALESCE(ch.name, '') ILIKE ${p}
                OR COALESCE(ch.email, '') ILIKE ${p}
              )
          )
        )
      )`;
    }
    sql += ` ORDER BY c.razon_social ASC`;
    if (limit) {
      params.push(limit);
      sql += ` LIMIT $${params.length}`;
    }
    const { rows } = await pool.query(sql, params);
    return res.json({ success: true, data: rows.map((r) => mapClient(r, catIds)) });
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

// ─── GET /api/clients/picker — typeahead (caché PG, sin XML-RPC) ──
router.get('/picker', async (req, res) => {
  const q = (req.query.q || '').trim();
  const limitRaw = req.query.limit != null ? parseInt(String(req.query.limit), 10) : 30;
  try {
    const data = await searchPicker({ q, limit: limitRaw });
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[CLIENTS] picker:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// ─── POST /api/clients/picker/refresh — busca en Odoo y actualiza caché ──
router.post('/picker/refresh', requireRole(...WRITE_ROLES), async (req, res) => {
  const q = String(req.body?.q || '').trim();
  try {
    const lookup = await lookupPartnersByQuery(q);
    const picker = await searchPicker({ q, limit: 30 });
    const visible = Array.isArray(picker.items) ? picker.items.length : 0;
    let hintCode = 'OK';
    let hint;
    if (lookup.fetched === 0) {
      hintCode = 'NOT_IN_ODOO';
      hint =
        `«${q}» no aparece en Odoo. Verifique el nombre o RUC, créelo allí y pulse Actualizar de nuevo.`;
    } else if (visible === 0) {
      hintCode = 'NOT_ELIGIBLE';
      hint =
        'Odoo tiene coincidencias, pero no califican como cliente de proyecto (empresa activa con etiqueta Cliente). Revíselo en Odoo y actualice.';
    } else {
      hint = `Caché actualizada desde Odoo. ${visible} coincidencia(s) para seleccionar.`;
    }
    return res.json({
      success: true,
      data: {
        ...lookup,
        items: picker.items || [],
        stale: Boolean(picker.stale),
        visible,
        hintCode,
        hint,
      },
    });
  } catch (err) {
    if (err instanceof CircuitOpenError) {
      return res.status(503).json({
        success: false,
        error: { code: 'ODOO_CIRCUIT_OPEN', message: err.message },
      });
    }
    if (err instanceof XmlrpcFault) {
      return res.status(502).json({
        success: false,
        error: { code: err.odooErrorKind || 'ODOO_FAULT', message: err.message.split('\n')[0] },
      });
    }
    const code = err.code || 'ODOO_SYNC_ERROR';
    const status = code === 'QUERY_TOO_SHORT' || code === 'ODOO_NOT_CONFIGURED' ? 400 : 500;
    if (status === 500) console.error('[CLIENTS] picker refresh:', err);
    return res.status(status).json({
      success: false,
      error: { code, message: err.message || 'No se pudo consultar Odoo' },
    });
  }
});

// ─── POST /api/clients/from-odoo — proyecta empresa y opcionalmente el hijo ──
router.post('/from-odoo', requireRole(...WRITE_ROLES), async (req, res) => {
  const odooId = Number(req.body?.odooId);
  const contactOdooId =
    req.body?.contactOdooId != null && req.body.contactOdooId !== ''
      ? Number(req.body.contactOdooId)
      : null;
  if (!Number.isFinite(odooId)) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'odooId requerido' },
    });
  }
  try {
    const row = await ensureClientFromOdoo({
      odooId,
      contactOdooId: Number.isFinite(contactOdooId) ? contactOdooId : null,
    });
    const full = await fetchClientRow(row.id);
    const catIds = await loadCategoryIds();
    return res.json({ success: true, data: mapClient(full, catIds) });
  } catch (err) {
    const code = err.code || 'SERVER_ERROR';
    const status = code === 'NOT_FOUND' || code === 'NOT_ELIGIBLE' ? 400 : 500;
    if (status === 500) console.error('[CLIENTS] from-odoo:', err);
    return res.status(status).json({
      success: false,
      error: { code, message: err.message || 'No se pudo vincular el contacto' },
    });
  }
});

// ─── POST /api/clients/import/preview — ADMIN + COMERCIAL + SUPERUSER ──────
router.post('/import/preview', requireRole('SUPERUSER'), upload.single('file'), async (req, res) => {
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

// ─── POST /api/clients/import/apply — ADMIN + COMERCIAL + SUPERUSER ──────
router.post('/import/apply', requireRole('SUPERUSER'), async (req, res) => {
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

// ─── GET /api/clients/:id/history ──────────────────────────────
router.get('/:id/history', requireRole(...HISTORY_ROLES), async (req, res) => {
  try {
    const { rows: ex } = await pool.query(`SELECT id FROM clients WHERE id = $1`, [req.params.id]);
    if (!ex.length) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Cliente no encontrado' } });
    }
    const data = await fetchClientHistory(req.params.id);
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[CLIENTS] history:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// ─── GET /api/clients/:id ──────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const row = await fetchClientRow(req.params.id);
    if (!row) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Cliente no encontrado' } });
    }
    const catIds = await loadCategoryIds();
    const ficha = await fetchClientFicha(pool, row, catIds);
    return res.json({ success: true, data: { ...mapClient(row, catIds), ficha } });
  } catch (err) {
    console.error('[CLIENTS] get:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

const writeValidation = [
  body('razonSocial').optional({ nullable: true, checkFalsy: true }).isString(),
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

// ─── POST /api/clients — alta local + outbox create (worker XML-RPC) ──
router.post('/', requireRole(...WRITE_ROLES), writeValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: errors.array()[0].msg },
    });
  }
  if (requireOdooConfigured(res)) return;

  const payload = payloadFromBody(req.body);
  const checked = validatePartnerWrite(payload);
  if (!checked.ok) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: checked.errors[0] },
    });
  }

  const xZtrackUid = randomUUID();
  try {
    const { rows } = await pool.query(
      `INSERT INTO clients
        (razon_social, ruc, contacto_nombre, contacto_email, contacto_telefono, direccion, ciudad, notas,
         created_by, active, sync_origin, x_ztrack_uid)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, 'local', $10)
       RETURNING *`,
      [
        checked.name,
        checked.vat,
        payload.contactoNombre || null,
        checked.email,
        payload.contactoTelefono || null,
        payload.direccion || null,
        payload.ciudad || null,
        payload.notas || null,
        req.user.id,
        xZtrackUid,
      ]
    );
    const created = rows[0];
    await logClientCreate(created, req.user.id, 'DIRECT');
    await enqueueCreate({
      clientId: created.id,
      payload: {
        ...payload,
        razonSocial: checked.name,
        ruc: checked.vat,
        xZtrackUid,
        consultarSunat: checked.consultarSunat,
      },
      actorId: req.user.id,
    });

    const full = await fetchClientRow(created.id);
    const catIds = await loadCategoryIds();
    return res.status(201).json({ success: true, data: mapClient(full, catIds) });
  } catch (err) {
    if (err.code === 'VALIDATION_ERROR') {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: err.message },
      });
    }
    console.error('[CLIENTS] create:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// ─── PUT /api/clients/:id — update local + outbox write/create ──
router.put('/:id', requireRole(...WRITE_ROLES), async (req, res) => {
  const payload = payloadFromBody(req.body);
  if (hasOdooPushFields(payload) && requireOdooConfigured(res)) return;

  if (payload.razonSocial != null || payload.ruc != null || payload.contactoEmail != null) {
    const checked = validatePartnerWrite({
      razonSocial: payload.razonSocial !== undefined ? payload.razonSocial : 'ok',
      ruc: payload.ruc,
      contactoEmail: payload.contactoEmail,
    });
    if (payload.razonSocial !== undefined && !String(payload.razonSocial || '').trim()) {
      if (!shouldConsultSunat({ ruc: payload.ruc, consultarSunat: true })) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Razón social o RUC peruano de 11 dígitos requerido' },
        });
      }
    }
    if (!checked.ok && (payload.ruc !== undefined || payload.contactoEmail !== undefined || payload.razonSocial !== undefined)) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: checked.errors[0] },
      });
    }
  }

  try {
    const before = await fetchClientRow(req.params.id);
    if (!before) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Cliente no encontrado' } });
    }

    const next = {
      razon_social:
        payload.razonSocial !== undefined
          ? String(payload.razonSocial).trim() ||
            (shouldConsultSunat({ ruc: payload.ruc !== undefined ? payload.ruc : before.ruc })
              ? `RUC ${normalizeVat(payload.ruc !== undefined ? payload.ruc : before.ruc)}`
              : '')
          : before.razon_social,
      ruc: payload.ruc !== undefined ? normalizeVat(payload.ruc) : before.ruc,
      contacto_nombre:
        payload.contactoNombre !== undefined ? payload.contactoNombre || null : before.contacto_nombre,
      contacto_email:
        payload.contactoEmail !== undefined ? payload.contactoEmail || null : before.contacto_email,
      contacto_telefono:
        payload.contactoTelefono !== undefined ? payload.contactoTelefono || null : before.contacto_telefono,
      direccion: payload.direccion !== undefined ? payload.direccion || null : before.direccion,
      ciudad: payload.ciudad !== undefined ? payload.ciudad || null : before.ciudad,
      notas: payload.notas !== undefined ? payload.notas || null : before.notas,
    };

    const { rows } = await pool.query(
      `UPDATE clients SET
         razon_social = $2,
         ruc = $3,
         contacto_nombre = $4,
         contacto_email = $5,
         contacto_telefono = $6,
         direccion = $7,
         ciudad = $8,
         notas = $9,
         updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        before.id,
        next.razon_social,
        next.ruc,
        next.contacto_nombre,
        next.contacto_email,
        next.contacto_telefono,
        next.direccion,
        next.ciudad,
        next.notas,
      ]
    );
    const after = rows[0];
    const changes = clientUpdateChanges(before, after);
    if (changes.length) {
      await logClientChanges({
        clientId: after.id,
        clientLabel: after.razon_social,
        actorId: req.user.id,
        changeSource: 'DIRECT',
        changes,
      });
    }

    if (hasOdooPushFields(payload)) {
      const pushPayload = {};
      if (payload.razonSocial !== undefined) pushPayload.razonSocial = next.razon_social;
      if (payload.ruc !== undefined) pushPayload.ruc = next.ruc;
      if (payload.contactoEmail !== undefined) pushPayload.contactoEmail = next.contacto_email;
      if (payload.contactoTelefono !== undefined) pushPayload.contactoTelefono = next.contacto_telefono;
      if (payload.direccion !== undefined) pushPayload.direccion = next.direccion;
      if (payload.ciudad !== undefined) pushPayload.ciudad = next.ciudad;
      if (payload.street2 !== undefined) pushPayload.street2 = payload.street2;
      if (payload.zip !== undefined) pushPayload.zip = payload.zip;
      if (payload.website !== undefined) pushPayload.website = payload.website;
      if (payload.mobile !== undefined) pushPayload.mobile = payload.mobile;
      if (payload.notas !== undefined) pushPayload.notas = next.notas;
      const rucChanged =
        payload.ruc !== undefined &&
        String(normalizeVat(payload.ruc) || '') !== String(normalizeVat(before.ruc) || '');
      if (rucChanged && shouldConsultSunat({ ruc: next.ruc })) {
        pushPayload.consultarSunat = true;
        pushPayload.ruc = next.ruc;
      }
      if (before.odoo_id) {
        await enqueueWrite({
          clientId: before.id,
          odooId: Number(before.odoo_id),
          xZtrackUid: before.x_ztrack_uid,
          payload: pushPayload,
          expectedWriteDate: before.odoo_write_date,
          actorId: req.user.id,
        });
      } else {
        let uid = before.x_ztrack_uid;
        if (!uid) {
          uid = randomUUID();
          await pool.query(`UPDATE clients SET x_ztrack_uid = $2 WHERE id = $1`, [before.id, uid]);
        }
        await enqueueCreate({
          clientId: before.id,
          payload: {
            razonSocial: next.razon_social,
            ruc: next.ruc,
            contactoEmail: next.contacto_email,
            contactoTelefono: next.contacto_telefono,
            direccion: next.direccion,
            ciudad: next.ciudad,
            street2: payload.street2,
            zip: payload.zip,
            website: payload.website,
            mobile: payload.mobile,
            notas: next.notas,
            xZtrackUid: uid,
            consultarSunat: shouldConsultSunat({ ruc: next.ruc }),
          },
          actorId: req.user.id,
        });
      }
    }

    const full = await fetchClientRow(before.id);
    const catIds = await loadCategoryIds();
    const ficha = await fetchClientFicha(pool, full, catIds);
    return res.json({ success: true, data: { ...mapClient(full, catIds), ficha } });
  } catch (err) {
    if (err.code === 'VALIDATION_ERROR') {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: err.message },
      });
    }
    console.error('[CLIENTS] update:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

// ─── POST /api/clients/:id/sunat — Consulta SUNAT vía Odoo (outbox) ──
router.post('/:id/sunat', requireRole(...WRITE_ROLES), async (req, res) => {
  if (requireOdooConfigured(res)) return;
  try {
    const row = await fetchClientRow(req.params.id);
    if (!row) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Cliente no encontrado' } });
    }
    const vat = normalizeVat(row.ruc);
    if (!shouldConsultSunat({ ruc: vat, consultarSunat: true })) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Ingrese un RUC peruano de 11 dígitos válido para consultar SUNAT.' },
      });
    }
    if (row.odoo_id) {
      await enqueueWrite({
        clientId: row.id,
        odooId: Number(row.odoo_id),
        xZtrackUid: row.x_ztrack_uid,
        payload: { ruc: vat, consultarSunat: true },
        expectedWriteDate: row.odoo_write_date,
        actorId: req.user.id,
      });
    } else {
      let uid = row.x_ztrack_uid;
      if (!uid) {
        uid = randomUUID();
        await pool.query(`UPDATE clients SET x_ztrack_uid = $2 WHERE id = $1`, [row.id, uid]);
      }
      await enqueueCreate({
        clientId: row.id,
        payload: {
          razonSocial: row.razon_social,
          ruc: vat,
          contactoEmail: row.contacto_email,
          contactoTelefono: row.contacto_telefono,
          direccion: row.direccion,
          ciudad: row.ciudad,
          notas: row.notas,
          xZtrackUid: uid,
          consultarSunat: true,
        },
        actorId: req.user.id,
      });
    }
    const full = await fetchClientRow(row.id);
    const catIds = await loadCategoryIds();
    const ficha = await fetchClientFicha(pool, full, catIds);
    return res.json({ success: true, data: { ...mapClient(full, catIds), ficha } });
  } catch (err) {
    if (err.code === 'VALIDATION_ERROR') {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: err.message },
      });
    }
    console.error('[CLIENTS] sunat:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

module.exports = router;
