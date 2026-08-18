/**
 * Reglas de negocio etapa 4: quién entra al picker de proyecto y al CRM.
 * Puro: sin I/O. Los IDs de etiqueta salen de odoo_sync_state (no hardcode).
 */

const { SYNC_STATUS } = require('./syncStatus');

function vatDigits(vat) {
  if (vat == null || vat === false) return '';
  return String(vat).replace(/\D/g, '');
}

function isPeruRuc(digits) {
  return /^\d{11}$/.test(String(digits || ''));
}

function ilikeContains(q) {
  const safe = String(q || '')
    .replace(/[%_]/g, ' ')
    .trim();
  return safe ? `%${safe}%` : '%';
}

function hasCategory(categoryIds, tagId) {
  if (tagId == null || !Number.isFinite(Number(tagId))) return false;
  const id = Number(tagId);
  return (categoryIds || []).map(Number).includes(id);
}

function isCompanyLike(p) {
  if (!p) return false;
  return p.isCompany === true || p.parentOdooId == null;
}

/**
 * Empresa (o persona standalone) visible como cliente de proyecto.
 * Prioridad: tag Cliente; respaldo customer_rank > 0.
 * Excluye proveedor puro, archivados y borrados en Odoo.
 */
function isEligibleCompany(p, clienteTagId) {
  if (!p) return false;
  if (p.active === false) return false;
  if (p.syncStatus === SYNC_STATUS.BORRADO_EN_ODOO) return false;
  if (!isCompanyLike(p)) return false;
  const taggedCliente = hasCategory(p.categoryIds, clienteTagId);
  const customer = (Number(p.customerRank) || 0) > 0;
  if (!taggedCliente && !customer) return false;
  const supplier = (Number(p.supplierRank) || 0) > 0;
  const customerRank = Number(p.customerRank) || 0;
  if (supplier && customerRank === 0 && !taggedCliente) return false;
  return true;
}

function partnerDisplayTags(p, catIds = {}) {
  const tags = [];
  if (hasCategory(p?.categoryIds, catIds.cliente)) tags.push('cliente');
  if (hasCategory(p?.categoryIds, catIds.proveedor)) tags.push('proveedor');
  if (hasCategory(p?.categoryIds, catIds.contacto)) tags.push('contacto');
  if (p && p.isCompany !== true && p.parentOdooId != null && !tags.includes('contacto')) {
    tags.push('contacto');
  }
  return tags;
}

function jsonText(raw, key) {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw[key];
  if (v === false || v == null || v === '') return null;
  return String(v);
}

function addressFromRaw(raw) {
  const street = jsonText(raw, 'street');
  const street2 = jsonText(raw, 'street2');
  const joined = [street, street2].filter(Boolean).join(', ');
  return joined || null;
}

function clip(s, max) {
  if (s == null) return null;
  const t = String(s).trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max) : t;
}

function phoneFromPartner(p) {
  return clip(p?.mobile || p?.phone, 64);
}

/**
 * SQL: empresa elegible. $clienteParam es el placeholder (p.ej. "$1") del id tag Cliente (puede ser NULL).
 */
function eligibleCompanySql(alias, clienteParam) {
  return `(
    ${alias}.active = true
    AND ${alias}.sync_status IS DISTINCT FROM 'borrado_en_odoo'
    AND (${alias}.is_company = true OR ${alias}.parent_odoo_id IS NULL)
    AND (
      (${clienteParam}::int IS NOT NULL AND ${alias}.category_ids @> ARRAY[${clienteParam}::int])
      OR ${alias}.customer_rank > 0
    )
    AND NOT (
      ${alias}.supplier_rank > 0
      AND ${alias}.customer_rank = 0
      AND (
        ${clienteParam}::int IS NULL
        OR NOT (${alias}.category_ids @> ARRAY[${clienteParam}::int])
      )
    )
  )`;
}

function visibleChildSql(alias) {
  return `(
    ${alias}.active = true
    AND ${alias}.sync_status IS DISTINCT FROM 'borrado_en_odoo'
    AND ${alias}.parent_odoo_id IS NOT NULL
  )`;
}

module.exports = {
  vatDigits,
  isPeruRuc,
  ilikeContains,
  hasCategory,
  isCompanyLike,
  isEligibleCompany,
  partnerDisplayTags,
  jsonText,
  addressFromRaw,
  clip,
  phoneFromPartner,
  eligibleCompanySql,
  visibleChildSql,
};
