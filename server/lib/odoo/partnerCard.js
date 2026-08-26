/**
 * Ficha de lectura (etapa 4.1): arma la vista tipo Contactos Odoo desde la caché PG.
 * Cero XML-RPC.
 */

const { normalizePartner } = require('./normalizePartner');
const { partnerDisplayTags } = require('./partnerEligibility');
const { SYNC_STATUS } = require('./syncStatus');

const LANG_LABEL = Object.freeze({
  es_PE: 'Español (PE)',
  es_ES: 'Español',
  en_US: 'English (US)',
  en_GB: 'English (UK)',
});

const TYPE_LABEL = Object.freeze({
  contact: 'Contacto',
  invoice: 'Dirección de factura',
  delivery: 'Dirección de entrega',
  other: 'Otra dirección',
  private: 'Privado',
});

function langLabel(code) {
  if (!code) return null;
  return LANG_LABEL[code] || code;
}

function tagPills(categoryIds, catIds) {
  const pills = [];
  for (const id of categoryIds || []) {
    const n = Number(id);
    if (n === Number(catIds.cliente)) pills.push({ id: n, name: 'Cliente', kind: 'cliente' });
    else if (n === Number(catIds.proveedor)) pills.push({ id: n, name: 'Proveedor', kind: 'proveedor' });
    else if (n === Number(catIds.contacto)) pills.push({ id: n, name: 'Contacto', kind: 'contacto' });
    else pills.push({ id: n, name: `Etiqueta ${n}`, kind: 'other' });
  }
  return pills;
}

function m2oName(v) {
  if (!v) return null;
  if (typeof v === 'object' && v.name) return v.name;
  return null;
}

function mapPartnerFicha(row, catIds) {
  const raw = row.raw && typeof row.raw === 'object' ? row.raw : {};
  const norm = normalizePartner(raw) || {};
  const categoryIds = Array.isArray(row.category_ids) ? row.category_ids.map(Number) : [];
  const flag = (k, fromNorm) =>
    fromNorm === true || raw[k] === true;
  return {
    odooId: Number(row.odoo_id),
    isCompany: row.is_company === true,
    name: row.name || row.display_name || norm.name,
    displayName: row.display_name || row.name,
    vat: row.vat || norm.vat || null,
    identificationType: norm.identificationType?.name || null,
    street: norm.street || null,
    street2: norm.street2 || null,
    district: norm.district?.name || null,
    city: row.city || norm.city || null,
    state: norm.state?.name || null,
    zip: norm.zip || null,
    country: norm.country?.name || null,
    phone: row.phone || norm.phone || null,
    mobile: row.mobile || norm.mobile || null,
    email: row.email || norm.email || null,
    website: norm.website || null,
    lang: langLabel(norm.lang),
    langCode: norm.lang || null,
    comment: norm.comment || null,
    ref: norm.ref || null,
    type: row.type || norm.type || null,
    typeLabel: TYPE_LABEL[row.type] || null,
    functionName: norm.functionName || null,
    customerRank: Number(row.customer_rank) || 0,
    supplierRank: Number(row.supplier_rank) || 0,
    salesperson: m2oName(norm.salesperson),
    pricelist: m2oName(norm.pricelist),
    fiscalPosition: m2oName(norm.fiscalPosition),
    paymentTerm: m2oName(norm.paymentTerm),
    industry: m2oName(norm.industry),
    mtcNumber: norm.mtcNumber || null,
    authorizationEntity: norm.authorizationEntity || null,
    authorizationNumber: norm.authorizationNumber || null,
    invoiceWarn: norm.invoiceWarn || null,
    latitude: norm.latitude != null ? Number(norm.latitude) : null,
    longitude: norm.longitude != null ? Number(norm.longitude) : null,
    rucFicha: {
      agentRetention: flag('agent_retention', norm.agentRetention),
      affectionNewRus: flag('affection_new_rus', norm.affectionNewRus),
      agentPerception: flag('agent_perception', norm.agentPerception),
      hydrocarbonPerceptionAgent: flag('hydrocarbon_perception_agent', norm.hydrocarbonPerceptionAgent),
      goodTaxpayer: flag('good_taxpayer', norm.goodTaxpayer),
      isRetentionAgent: flag('l10n_pe_is_retention_agent', norm.isRetentionAgent),
      foreignTradeActivity: norm.foreignTradeActivity || null,
      taxpayerCondition: norm.taxpayerCondition || null,
      taxpayerState: norm.taxpayerState || null,
    },
    tags: partnerDisplayTags(
      {
        isCompany: row.is_company === true,
        parentOdooId: row.parent_odoo_id != null ? Number(row.parent_odoo_id) : null,
        categoryIds,
      },
      catIds
    ),
    tagPills: tagPills(categoryIds, catIds),
    active: row.active !== false,
    syncStatus: row.sync_status,
    odooWriteDate: row.odoo_write_date || null,
  };
}

function mapChildCard(row, catIds, selectedOdooId) {
  const f = mapPartnerFicha(row, catIds);
  return {
    odooId: f.odooId,
    name: f.name,
    email: f.email,
    phone: f.phone,
    mobile: f.mobile,
    typeLabel: f.typeLabel,
    functionName: f.functionName,
    selected: selectedOdooId != null && Number(selectedOdooId) === f.odooId,
  };
}

function localFichaFromClient(row) {
  return {
    source: 'local',
    isCompany: true,
    name: row.razon_social,
    vat: row.ruc || null,
    identificationType: row.ruc ? 'RUC (PE)' : null,
    street: row.direccion || null,
    street2: null,
    district: null,
    city: row.ciudad || null,
    state: null,
    zip: null,
    country: 'Perú',
    rucFicha: {
      agentRetention: false,
      affectionNewRus: false,
      agentPerception: false,
      hydrocarbonPerceptionAgent: false,
      goodTaxpayer: false,
      isRetentionAgent: false,
      foreignTradeActivity: null,
      taxpayerCondition: null,
      taxpayerState: null,
    },
    phone: row.contacto_telefono || null,
    mobile: null,
    email: row.contacto_email || null,
    website: null,
    lang: null,
    langCode: null,
    comment: row.notas || null,
    type: null,
    typeLabel: null,
    functionName: null,
    customerRank: 0,
    supplierRank: 0,
    tags: ['local'],
    tagPills: [{ id: 0, name: 'No está en Odoo', kind: 'local' }],
    active: row.active !== false,
    syncStatus: null,
    odooWriteDate: null,
    contacts: row.contacto_nombre
      ? [
          {
            odooId: null,
            name: row.contacto_nombre,
            email: row.contacto_email || null,
            phone: row.contacto_telefono || null,
            mobile: null,
            typeLabel: 'Contacto',
            functionName: null,
            selected: true,
          },
        ]
      : [],
  };
}

async function fetchClientFicha(pool, clientRow, catIds) {
  if (!clientRow.odoo_id) {
    return localFichaFromClient(clientRow);
  }
  const { rows: partners } = await pool.query(`SELECT * FROM odoo_partners WHERE odoo_id = $1`, [
    clientRow.odoo_id,
  ]);
  const partner = partners[0];
  if (!partner) return localFichaFromClient(clientRow);

  const { rows: children } = await pool.query(
    `SELECT * FROM odoo_partners
     WHERE parent_odoo_id = $1
       AND active = true
       AND sync_status IS DISTINCT FROM $2
     ORDER BY COALESCE(name, display_name) ASC`,
    [clientRow.odoo_id, SYNC_STATUS.BORRADO_EN_ODOO]
  );

  const selected = clientRow.odoo_contact_id != null ? Number(clientRow.odoo_contact_id) : null;
  const card = mapPartnerFicha(partner, catIds);
  return {
    source: 'odoo',
    ...card,
    contacts: children.map((ch) => mapChildCard(ch, catIds, selected)),
  };
}

module.exports = {
  mapPartnerFicha,
  fetchClientFicha,
  langLabel,
};
