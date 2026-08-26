/**
 * Etapa 4: proyectar res.partner elegibles → clients, vincular RUC 1:1, typeahead del picker.
 * Solo PostgreSQL. Cero XML-RPC.
 */

const { pool } = require('../../config/db');
const { SYNC_MODEL_PARTNER, SYNC_ORIGIN, SYNC_STATUS } = require('./syncStatus');
const {
  ilikeContains,
  isEligibleCompany,
  partnerDisplayTags,
  addressFromRaw,
  clip,
  phoneFromPartner,
  eligibleCompanySql,
  visibleChildSql,
} = require('./partnerEligibility');
const { fetchClientFicha } = require('./partnerCard');

async function loadCategoryIds(client = pool) {
  const { rows } = await client.query(
    `SELECT category_cliente_id, category_proveedor_id, category_contacto_id
     FROM odoo_sync_state WHERE model = $1`,
    [SYNC_MODEL_PARTNER]
  );
  const r = rows[0] || {};
  return {
    cliente: r.category_cliente_id != null ? Number(r.category_cliente_id) : null,
    proveedor: r.category_proveedor_id != null ? Number(r.category_proveedor_id) : null,
    contacto: r.category_contacto_id != null ? Number(r.category_contacto_id) : null,
  };
}

function sqlTextFromRaw(rawExpr, key) {
  return `CASE WHEN jsonb_typeof(${rawExpr}->'${key}') = 'string' THEN NULLIF(TRIM(${rawExpr}->>'${key}'), '') ELSE NULL END`;
}

function addressSql(rawExpr) {
  return `NULLIF(TRIM(CONCAT_WS(', ', ${sqlTextFromRaw(rawExpr, 'street')}, ${sqlTextFromRaw(rawExpr, 'street2')})), '')`;
}

async function projectEligibleClients() {
  const cats = await loadCategoryIds();
  const elig = eligibleCompanySql('p', '$1');
  const addr = addressSql('p.raw');

  const link = await linkLocalClientsByRuc();

  const upsert = await pool.query(
    `INSERT INTO clients (
       razon_social, ruc, contacto_nombre, contacto_email, contacto_telefono,
       direccion, ciudad, odoo_id, odoo_parent_id, sync_origin, odoo_write_date, active
     )
     SELECT
       LEFT(COALESCE(p.name, p.display_name, 'Sin nombre'), 512),
       LEFT(p.vat, 32),
       LEFT(COALESCE(p.name, p.display_name), 150),
       LEFT(p.email, 255),
       LEFT(COALESCE(p.mobile, p.phone), 64),
       ${addr},
       LEFT(p.city, 128),
       p.odoo_id,
       p.parent_odoo_id,
       'odoo',
       p.odoo_write_date,
       true
     FROM odoo_partners p
     WHERE ${elig}
     ON CONFLICT (odoo_id) DO UPDATE SET
       razon_social = EXCLUDED.razon_social,
       ruc = EXCLUDED.ruc,
       direccion = EXCLUDED.direccion,
       ciudad = EXCLUDED.ciudad,
       odoo_parent_id = EXCLUDED.odoo_parent_id,
       odoo_write_date = EXCLUDED.odoo_write_date,
       active = EXCLUDED.active,
       contacto_nombre = CASE WHEN clients.odoo_contact_id IS NULL THEN EXCLUDED.contacto_nombre ELSE clients.contacto_nombre END,
       contacto_email = CASE WHEN clients.odoo_contact_id IS NULL THEN EXCLUDED.contacto_email ELSE clients.contacto_email END,
       contacto_telefono = CASE WHEN clients.odoo_contact_id IS NULL THEN EXCLUDED.contacto_telefono ELSE clients.contacto_telefono END,
       updated_at = NOW()`,
    [cats.cliente]
  );

  const deactivated = await pool.query(
    `UPDATE clients c
     SET active = false, updated_at = NOW()
     FROM odoo_partners p
     WHERE c.odoo_id = p.odoo_id
       AND c.active = true
       AND (
         p.active = false
         OR p.sync_status = $1
       )`,
    [SYNC_STATUS.BORRADO_EN_ODOO]
  );

  return {
    ok: true,
    upserted: upsert.rowCount || 0,
    deactivated: deactivated.rowCount || 0,
    link,
  };
}

async function linkLocalClientsByRuc({ apply = true } = {}) {
  const { rows: locals } = await pool.query(
    `SELECT id, ruc, regexp_replace(COALESCE(ruc, ''), '\\D', '', 'g') AS vat_digits
     FROM clients
     WHERE odoo_id IS NULL
       AND ruc IS NOT NULL
       AND regexp_replace(ruc, '\\D', '', 'g') ~ '^\\d{11}$'`
  );

  const { rows: odooRows } = await pool.query(
    `SELECT odoo_id, vat, regexp_replace(COALESCE(vat, ''), '\\D', '', 'g') AS vat_digits,
            odoo_write_date, parent_odoo_id
     FROM odoo_partners
     WHERE active = true
       AND sync_status IS DISTINCT FROM $1
       AND (is_company = true OR parent_odoo_id IS NULL)
       AND vat IS NOT NULL
       AND regexp_replace(vat, '\\D', '', 'g') ~ '^\\d{11}$'`,
    [SYNC_STATUS.BORRADO_EN_ODOO]
  );

  const odooByVat = new Map();
  for (const r of odooRows) {
    const k = r.vat_digits;
    if (!odooByVat.has(k)) odooByVat.set(k, []);
    odooByVat.get(k).push(r);
  }

  const localByVat = new Map();
  for (const r of locals) {
    const k = r.vat_digits;
    if (!localByVat.has(k)) localByVat.set(k, []);
    localByVat.get(k).push(r);
  }

  const ambiguous = [];
  let linked = 0;
  let unmatched = 0;
  const taken = new Set();

  const { rows: used } = await pool.query(
    `SELECT odoo_id FROM clients WHERE odoo_id IS NOT NULL`
  );
  for (const r of used) taken.add(Number(r.odoo_id));

  const allVats = new Set([...localByVat.keys()]);
  for (const vat of allVats) {
    const loc = localByVat.get(vat) || [];
    const od = odooByVat.get(vat) || [];
    if (od.length === 0) {
      unmatched += loc.length;
      continue;
    }
    if (loc.length !== 1 || od.length !== 1) {
      ambiguous.push({
        ruc: vat,
        localIds: loc.map((x) => x.id),
        localCount: loc.length,
        odooIds: od.map((x) => x.odoo_id),
        odooCount: od.length,
      });
      continue;
    }
    const odooId = Number(od[0].odoo_id);
    if (taken.has(odooId)) {
      ambiguous.push({
        ruc: vat,
        localIds: loc.map((x) => x.id),
        localCount: loc.length,
        odooIds: [odooId],
        odooCount: 1,
        reason: 'odoo_id_ya_asignado',
      });
      continue;
    }
    if (!apply) {
      linked += 1;
      taken.add(odooId);
      continue;
    }
    const res = await pool.query(
      `UPDATE clients SET
         odoo_id = $2,
         odoo_parent_id = $3,
         sync_origin = $4,
         odoo_write_date = $5,
         updated_at = NOW()
       WHERE id = $1 AND odoo_id IS NULL`,
      [loc[0].id, odooId, od[0].parent_odoo_id || null, SYNC_ORIGIN.LINKED, od[0].odoo_write_date]
    );
    if (res.rowCount) {
      linked += 1;
      taken.add(odooId);
    }
  }

  return { linked, unmatched, ambiguousN: ambiguous.length, ambiguous, applied: apply };
}

async function projectionCounts() {
  const { rows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE sync_origin = 'odoo')::int AS odoo_n,
       COUNT(*) FILTER (WHERE sync_origin = 'linked')::int AS linked_n,
       COUNT(*) FILTER (WHERE sync_origin = 'local')::int AS local_n,
       COUNT(*)::int AS total
     FROM clients`
  );
  return rows[0] || { odoo_n: 0, linked_n: 0, local_n: 0, total: 0 };
}

async function isSyncStale() {
  const { rows } = await pool.query(
    `SELECT last_ok_at FROM odoo_sync_state WHERE model = $1`,
    [SYNC_MODEL_PARTNER]
  );
  const lastOk = rows[0]?.last_ok_at;
  if (!lastOk) return { stale: false, lastOkAt: null };
  const age = Date.now() - new Date(lastOk).getTime();
  return { stale: age > 45 * 60 * 1000, lastOkAt: lastOk };
}

function mapPickerPartner(row, cats, extra = {}) {
  const p = {
    isCompany: row.is_company === true,
    parentOdooId: row.parent_odoo_id != null ? Number(row.parent_odoo_id) : null,
    categoryIds: Array.isArray(row.category_ids) ? row.category_ids.map(Number) : [],
    customerRank: Number(row.customer_rank) || 0,
    supplierRank: Number(row.supplier_rank) || 0,
  };
  return {
    key: extra.key,
    kind: extra.kind || 'odoo',
    clientId: extra.clientId || null,
    odooId: extra.odooId != null ? Number(extra.odooId) : Number(row.odoo_id),
    contactOdooId: extra.contactOdooId != null ? Number(extra.contactOdooId) : null,
    razonSocial: extra.razonSocial || row.name || row.display_name || '',
    contactName: extra.contactName || null,
    ruc: extra.ruc != null ? extra.ruc : row.vat,
    ciudad: extra.ciudad != null ? extra.ciudad : row.city,
    email: extra.email != null ? extra.email : row.email,
    isCompany: extra.isCompany != null ? extra.isCompany : row.is_company === true,
    indent: Boolean(extra.indent),
    tags: extra.tags || partnerDisplayTags(p, cats),
    syncOrigin: extra.syncOrigin || extra.clientSyncOrigin || null,
  };
}

function mapLocalPicker(row) {
  return {
    key: `local:${row.id}`,
    kind: 'local',
    clientId: row.id,
    odooId: null,
    contactOdooId: null,
    razonSocial: row.razon_social,
    contactName: row.contacto_nombre || null,
    ruc: row.ruc,
    ciudad: row.ciudad,
    email: row.contacto_email,
    isCompany: true,
    indent: false,
    tags: ['local'],
    syncOrigin: 'local',
  };
}

async function searchPicker({ q = '', limit = 30 } = {}) {
  const cats = await loadCategoryIds();
  const lim = Math.min(Math.max(Number(limit) || 30, 1), 50);
  const qq = String(q || '').trim();
  const staleInfo = await isSyncStale();
  const elig = eligibleCompanySql('co', '$1');
  const childOk = visibleChildSql('ch');

  const items = [];

  if (!qq) {
    const { rows: companies } = await pool.query(
      `SELECT co.*, c.id AS client_uuid, c.sync_origin AS client_sync_origin
       FROM odoo_partners co
       LEFT JOIN clients c ON c.odoo_id = co.odoo_id
       WHERE ${elig}
       ORDER BY COALESCE(co.name, co.display_name) ASC
       LIMIT $2`,
      [cats.cliente, lim]
    );
    const { rows: locals } = await pool.query(
      `SELECT * FROM clients
       WHERE odoo_id IS NULL AND active = true
       ORDER BY razon_social ASC
       LIMIT $1`,
      [Math.min(lim, 20)]
    );
    const mixed = [
      ...locals.map(mapLocalPicker),
      ...companies.map((row) =>
        mapPickerPartner(row, cats, {
          key: `co:${row.odoo_id}`,
          kind: 'odoo',
          clientId: row.client_uuid || null,
          odooId: row.odoo_id,
          razonSocial: row.name || row.display_name,
          syncOrigin: row.client_sync_origin || 'odoo',
        })
      ),
    ].sort((a, b) => String(a.razonSocial).localeCompare(String(b.razonSocial), 'es'));
    return { ...staleInfo, items: mixed.slice(0, lim) };
  }

  const like = ilikeContains(qq);

  const { rows: matched } = await pool.query(
    `SELECT p.odoo_id,
            p.is_company,
            p.parent_odoo_id,
            CASE
              WHEN p.is_company = true OR p.parent_odoo_id IS NULL THEN p.odoo_id
              ELSE p.parent_odoo_id
            END AS company_id,
            CASE
              WHEN p.is_company = true OR p.parent_odoo_id IS NULL THEN NULL
              ELSE p.odoo_id
            END AS contact_id
     FROM odoo_partners p
     WHERE p.active = true
       AND p.sync_status IS DISTINCT FROM 'borrado_en_odoo'
       AND (
         COALESCE(p.name, '') ILIKE $1
         OR COALESCE(p.display_name, '') ILIKE $1
         OR COALESCE(p.vat, '') ILIKE $1
         OR COALESCE(p.email, '') ILIKE $1
         OR COALESCE(p.city, '') ILIKE $1
       )
     LIMIT 80`,
    [like]
  );

  const companyIds = [];
  const childIdsByCompany = new Map();
  for (const m of matched) {
    const cid = Number(m.company_id);
    if (!Number.isFinite(cid)) continue;
    if (!companyIds.includes(cid)) companyIds.push(cid);
    if (m.contact_id != null) {
      if (!childIdsByCompany.has(cid)) childIdsByCompany.set(cid, new Set());
      childIdsByCompany.get(cid).add(Number(m.contact_id));
    }
  }

  let companies = [];
  if (companyIds.length) {
    const { rows } = await pool.query(
      `SELECT co.*, c.id AS client_uuid, c.sync_origin AS client_sync_origin
       FROM odoo_partners co
       LEFT JOIN clients c ON c.odoo_id = co.odoo_id
       WHERE co.odoo_id = ANY($2::int[])
         AND ${elig}`,
      [cats.cliente, companyIds]
    );
    companies = rows;
  }

  const eligibleCompanySet = new Set(companies.map((r) => Number(r.odoo_id)));
  const allChildIds = [];
  for (const [cid, set] of childIdsByCompany) {
    if (!eligibleCompanySet.has(Number(cid))) continue;
    for (const id of set) allChildIds.push(id);
  }

  let children = [];
  if (allChildIds.length) {
    const { rows } = await pool.query(
      `SELECT ch.* FROM odoo_partners ch
       WHERE ch.odoo_id = ANY($1::int[]) AND ${childOk}`,
      [allChildIds]
    );
    children = rows;
  }

  const childrenByParent = new Map();
  for (const ch of children) {
    const pid = Number(ch.parent_odoo_id);
    if (!childrenByParent.has(pid)) childrenByParent.set(pid, []);
    childrenByParent.get(pid).push(ch);
  }

  companies.sort((a, b) =>
    String(a.name || a.display_name || '').localeCompare(String(b.name || b.display_name || ''), 'es')
  );

  for (const co of companies) {
    const odooId = Number(co.odoo_id);
    items.push(
      mapPickerPartner(co, cats, {
        key: `co:${odooId}`,
        kind: 'odoo',
        clientId: co.client_uuid || null,
        odooId,
        razonSocial: co.name || co.display_name,
        syncOrigin: co.client_sync_origin || 'odoo',
      })
    );
    const kids = (childrenByParent.get(odooId) || []).sort((a, b) =>
      String(a.name || '').localeCompare(String(b.name || ''), 'es')
    );
    for (const ch of kids) {
      items.push(
        mapPickerPartner(ch, cats, {
          key: `ch:${odooId}:${ch.odoo_id}`,
          kind: 'odoo-contact',
          clientId: co.client_uuid || null,
          odooId,
          contactOdooId: ch.odoo_id,
          razonSocial: co.name || co.display_name,
          contactName: ch.name || ch.display_name,
          ruc: co.vat,
          ciudad: ch.city || co.city,
          email: ch.email || co.email,
          isCompany: false,
          indent: true,
          tags: partnerDisplayTags(
            {
              isCompany: false,
              parentOdooId: odooId,
              categoryIds: Array.isArray(ch.category_ids) ? ch.category_ids.map(Number) : [],
            },
            cats
          ),
          syncOrigin: co.client_sync_origin || 'odoo',
        })
      );
    }
  }

  const { rows: locals } = await pool.query(
    `SELECT * FROM clients
     WHERE odoo_id IS NULL AND active = true
       AND (
         razon_social ILIKE $1
         OR COALESCE(ruc, '') ILIKE $1
         OR COALESCE(contacto_nombre, '') ILIKE $1
         OR COALESCE(contacto_email, '') ILIKE $1
         OR COALESCE(ciudad, '') ILIKE $1
       )
     ORDER BY razon_social ASC
     LIMIT 20`,
    [like]
  );

  const mixed = [...locals.map(mapLocalPicker), ...items];
  return { ...staleInfo, items: mixed.slice(0, lim) };
}

function partnerToClientFields(partnerRow, contactRow = null) {
  const raw = partnerRow.raw || {};
  const contact = contactRow || partnerRow;
  return {
    razon_social: clip(partnerRow.name || partnerRow.display_name || 'Sin nombre', 512),
    ruc: clip(partnerRow.vat, 32),
    contacto_nombre: clip(contact.name || contact.display_name, 150),
    contacto_email: clip(contact.email, 255),
    contacto_telefono: phoneFromPartner(contact),
    direccion: clip(addressFromRaw(raw), 2000),
    ciudad: clip(partnerRow.city, 128),
    odoo_id: Number(partnerRow.odoo_id),
    odoo_parent_id: partnerRow.parent_odoo_id != null ? Number(partnerRow.parent_odoo_id) : null,
    odoo_contact_id: contactRow ? Number(contactRow.odoo_id) : null,
    sync_origin: SYNC_ORIGIN.ODOO,
    odoo_write_date: partnerRow.odoo_write_date,
    active: partnerRow.active !== false && partnerRow.sync_status !== SYNC_STATUS.BORRADO_EN_ODOO,
  };
}

async function loadPartner(odooId) {
  const { rows } = await pool.query(`SELECT * FROM odoo_partners WHERE odoo_id = $1`, [odooId]);
  return rows[0] || null;
}

async function resolveCompanyPartner(odooId) {
  const p = await loadPartner(odooId);
  if (!p) return { error: 'NOT_FOUND', message: 'Contacto no está en la caché local' };
  if (p.parent_odoo_id && p.is_company !== true) {
    const parent = await loadPartner(p.parent_odoo_id);
    if (!parent) {
      return { company: p, contact: null };
    }
    return { company: parent, contact: p };
  }
  return { company: p, contact: null };
}

async function ensureClientFromOdoo({ odooId, contactOdooId = null }) {
  const id = Number(odooId);
  if (!Number.isFinite(id)) {
    const err = new Error('odooId inválido');
    err.code = 'VALIDATION_ERROR';
    throw err;
  }

  let { company, contact, error, message } = await resolveCompanyPartner(id);
  if (error) {
    const err = new Error(message);
    err.code = error;
    throw err;
  }

  const cats = await loadCategoryIds();
  const companyMapped = {
    isCompany: company.is_company === true,
    parentOdooId: company.parent_odoo_id != null ? Number(company.parent_odoo_id) : null,
    categoryIds: Array.isArray(company.category_ids) ? company.category_ids.map(Number) : [],
    customerRank: Number(company.customer_rank) || 0,
    supplierRank: Number(company.supplier_rank) || 0,
    active: company.active !== false,
    syncStatus: company.sync_status,
  };
  if (!isEligibleCompany(companyMapped, cats.cliente)) {
    const err = new Error('Este contacto no es un cliente elegible (proveedor puro, archivado o sin etiqueta Cliente)');
    err.code = 'NOT_ELIGIBLE';
    throw err;
  }

  let contactRow = contact;
  if (contactOdooId) {
    const wanted = Number(contactOdooId);
    if (!contactRow || Number(contactRow.odoo_id) !== wanted) {
      contactRow = await loadPartner(wanted);
    }
    if (contactRow && Number(contactRow.parent_odoo_id) !== Number(company.odoo_id)) {
      contactRow = null;
    }
  } else if (contact && Number(odooId) === Number(contact.odoo_id)) {
    contactRow = contact;
  } else {
    contactRow = null;
  }

  const fields = partnerToClientFields(company, contactRow);

  const { rows } = await pool.query(
    `INSERT INTO clients (
       razon_social, ruc, contacto_nombre, contacto_email, contacto_telefono,
       direccion, ciudad, odoo_id, odoo_parent_id, odoo_contact_id,
       sync_origin, odoo_write_date, active
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (odoo_id) DO UPDATE SET
       razon_social = EXCLUDED.razon_social,
       ruc = EXCLUDED.ruc,
       direccion = EXCLUDED.direccion,
       ciudad = EXCLUDED.ciudad,
       odoo_parent_id = EXCLUDED.odoo_parent_id,
       odoo_contact_id = EXCLUDED.odoo_contact_id,
       odoo_write_date = EXCLUDED.odoo_write_date,
       active = EXCLUDED.active,
       contacto_nombre = EXCLUDED.contacto_nombre,
       contacto_email = EXCLUDED.contacto_email,
       contacto_telefono = EXCLUDED.contacto_telefono,
       sync_origin = CASE WHEN clients.sync_origin = 'linked' THEN clients.sync_origin ELSE EXCLUDED.sync_origin END,
       updated_at = NOW()
     RETURNING *`,
    [
      fields.razon_social,
      fields.ruc,
      fields.contacto_nombre,
      fields.contacto_email,
      fields.contacto_telefono,
      fields.direccion,
      fields.ciudad,
      fields.odoo_id,
      fields.odoo_parent_id,
      fields.odoo_contact_id,
      fields.sync_origin,
      fields.odoo_write_date,
      fields.active,
    ]
  );

  return rows[0];
}

async function fetchClientRow(id) {
  const { rows } = await pool.query(
    `SELECT c.*,
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
        (SELECT COUNT(*)::int FROM projects p
         WHERE p.client_id = c.id AND p.deleted_at IS NULL) AS project_count
     FROM clients c
     LEFT JOIN odoo_partners op ON op.odoo_id = c.odoo_id
     LEFT JOIN odoo_partners parent ON parent.odoo_id = COALESCE(c.odoo_parent_id, op.parent_odoo_id)
     LEFT JOIN LATERAL (
       SELECT o.op, o.status, o.last_error, o.attempts, o.next_attempt_at, o.created_at
         FROM odoo_outbox o
        WHERE o.client_id = c.id
        ORDER BY o.created_at DESC
        LIMIT 1
     ) ox ON true
     WHERE c.id = $1`,
    [id]
  );
  return rows[0] || null;
}

module.exports = {
  loadCategoryIds,
  projectEligibleClients,
  linkLocalClientsByRuc,
  projectionCounts,
  isSyncStale,
  searchPicker,
  ensureClientFromOdoo,
  fetchClientRow,
  fetchClientFicha,
};
