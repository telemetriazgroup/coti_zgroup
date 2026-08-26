/**
 * Whitelist congelada de res.partner (etapa 0).
 * No pedir * ni binarios (image_1920). Inventariar extras con el probe (fields_get).
 */

const PARTNER_FIELDS = Object.freeze([
  'id',
  'name',
  'display_name',
  'complete_name',
  'ref',
  'active',
  'company_type',
  'is_company',
  'parent_id',
  'type',
  'function',
  'title',
  'vat',
  'street',
  'street2',
  'city',
  'state_id',
  'country_id',
  'zip',
  'phone',
  'mobile',
  'email',
  'website',
  'comment',
  'lang',
  'tz',
  'category_id',
  'user_id',
  'customer_rank',
  'supplier_rank',
  'create_date',
  'write_date',
]);

/** Localización LATAM / Perú / Ficha RUC SUNAT: se omiten si el search_read falla. */
const PARTNER_FIELDS_OPTIONAL_PE = Object.freeze([
  'l10n_latam_identification_type_id',
  'l10n_pe_district',
  'agent_retention',
  'affection_new_rus',
  'agent_perception',
  'hydrocarbon_perception_agent',
  'good_taxpayer',
  'foreign_trade_activity',
  'taxpayer_condition',
  'taxpayer_state',
  'l10n_pe_edi_mtc_number',
  'l10n_pe_edi_authorization_issuing_entity',
  'l10n_pe_edi_authorization_number',
  'l10n_pe_is_retention_agent',
  'partner_latitude',
  'partner_longitude',
  'property_product_pricelist',
  'property_account_position_id',
  'property_payment_term_id',
  'invoice_warn',
  'industry_id',
]);

const FIELDS_GET_ATTRIBUTES = Object.freeze(['string', 'type', 'required', 'relation', 'store']);

const CATEGORY_FIELDS = Object.freeze(['id', 'name', 'display_name', 'color', 'parent_id']);

const REQUIRED_FIELD_NAMES = Object.freeze([
  'id',
  'name',
  'vat',
  'email',
  'parent_id',
  'category_id',
  'is_company',
  'company_type',
  'active',
  'write_date',
  'create_date',
]);

const MODULE_TECHNICAL_NAME = 'zgroup_partner_ext';
const X_ZTRACK_UID_FIELD = 'x_ztrack_uid';

const DEFAULT_CATEGORY_LABELS = Object.freeze({
  cliente: ['cliente', 'clientes', 'customer', 'customers'],
  proveedor: ['proveedor', 'proveedores', 'vendor', 'vendors', 'supplier'],
  contacto: ['contacto', 'contactos', 'contact'],
});

module.exports = {
  PARTNER_FIELDS,
  PARTNER_FIELDS_OPTIONAL_PE,
  FIELDS_GET_ATTRIBUTES,
  CATEGORY_FIELDS,
  REQUIRED_FIELD_NAMES,
  DEFAULT_CATEGORY_LABELS,
  MODULE_TECHNICAL_NAME,
  X_ZTRACK_UID_FIELD,
};
