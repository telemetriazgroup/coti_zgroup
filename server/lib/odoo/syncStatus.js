/** Constantes de sincronización Odoo (etapa 2+). El pull vive en etapa 3. */

const SYNC_MODEL_PARTNER = 'res.partner';
const LOCK_KEY_PARTNERS = 'sync_partners';

const SYNC_STATUS = Object.freeze({
  SINCRONIZADO: 'sincronizado',
  PENDIENTE: 'pendiente',
  CONFLICTO: 'conflicto',
  BORRADO_EN_ODOO: 'borrado_en_odoo',
});

const SYNC_ORIGIN = Object.freeze({
  LOCAL: 'local',
  ODOO: 'odoo',
  LINKED: 'linked',
});

function mapOdooPartnerRow(row) {
  if (!row) return null;
  return {
    odooId: row.odoo_id,
    xZtrackUid: row.x_ztrack_uid,
    name: row.name,
    displayName: row.display_name,
    vat: row.vat,
    email: row.email,
    phone: row.phone,
    mobile: row.mobile,
    city: row.city,
    isCompany: row.is_company === true,
    parentOdooId: row.parent_odoo_id,
    type: row.type,
    active: row.active !== false,
    customerRank: Number(row.customer_rank) || 0,
    supplierRank: Number(row.supplier_rank) || 0,
    categoryIds: Array.isArray(row.category_ids) ? row.category_ids.map(Number) : [],
    odooWriteDate: row.odoo_write_date,
    lastPushedWriteDate: row.last_pushed_write_date,
    syncStatus: row.sync_status,
    updatedAt: row.updated_at,
  };
}

function mapSyncStateRow(row) {
  if (!row) return null;
  return {
    model: row.model,
    watermark: row.watermark,
    lastRunAt: row.last_run_at,
    lastOkAt: row.last_ok_at,
    durationMs: row.duration_ms != null ? Number(row.duration_ms) : null,
    createdN: Number(row.created_n) || 0,
    updatedN: Number(row.updated_n) || 0,
    errorN: Number(row.error_n) || 0,
    lastError: row.last_error,
    categoryClienteId: row.category_cliente_id,
    categoryProveedorId: row.category_proveedor_id,
    categoryContactoId: row.category_contacto_id,
    updatedAt: row.updated_at,
  };
}

module.exports = {
  SYNC_MODEL_PARTNER,
  LOCK_KEY_PARTNERS,
  SYNC_STATUS,
  SYNC_ORIGIN,
  mapOdooPartnerRow,
  mapSyncStateRow,
};
