/**
 * Normaliza valores XML-RPC de Odoo:
 * - False (vacío) → null  (no confundir 0 ni false-y strings)
 * - many2one [id, "Nombre"] → { id, name }
 * - many2many [id, …] se deja como array de enteros
 * - datetime naive UTC "YYYY-MM-DD HH:mm:ss" → ISO 8601 Z
 */

function isOdooFalse(v) {
  return v === false;
}

function odooDatetimeToIso(raw) {
  if (raw == null || isOdooFalse(raw)) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(s)) {
    return `${s.replace(' ', 'T')}Z`;
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    return s.endsWith('Z') ? s : `${s}Z`;
  }
  return s;
}

function normalizeMany2one(v) {
  if (v == null || isOdooFalse(v)) return null;
  if (Array.isArray(v) && v.length >= 2 && Number.isFinite(Number(v[0]))) {
    return { id: Number(v[0]), name: isOdooFalse(v[1]) ? null : String(v[1]) };
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    return { id: v, name: null };
  }
  return v;
}

function normalizeMany2many(v) {
  if (v == null || isOdooFalse(v)) return [];
  if (!Array.isArray(v)) return [];
  return v.map((id) => Number(id)).filter((id) => Number.isFinite(id));
}

function normalizeScalar(v) {
  if (isOdooFalse(v)) return null;
  if (v === '') return null;
  return v;
}

function normalizePartner(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw;

  return {
    odooId: src.id != null && !isOdooFalse(src.id) ? Number(src.id) : null,
    name: normalizeScalar(src.name),
    displayName: normalizeScalar(src.display_name),
    completeName: normalizeScalar(src.complete_name),
    ref: normalizeScalar(src.ref),
    active: src.active === false ? false : Boolean(src.active !== false),
    companyType: normalizeScalar(src.company_type),
    isCompany: src.is_company === true,
    parent: normalizeMany2one(src.parent_id),
    type: normalizeScalar(src.type),
    functionName: normalizeScalar(src.function),
    title: normalizeMany2one(src.title),
    vat: normalizeScalar(src.vat),
    identificationType: normalizeMany2one(src.l10n_latam_identification_type_id),
    district: normalizeMany2one(src.l10n_pe_district),
    street: normalizeScalar(src.street),
    street2: normalizeScalar(src.street2),
    city: normalizeScalar(src.city),
    state: normalizeMany2one(src.state_id),
    country: normalizeMany2one(src.country_id),
    zip: normalizeScalar(src.zip),
    phone: normalizeScalar(src.phone),
    mobile: normalizeScalar(src.mobile),
    email: normalizeScalar(src.email),
    website: normalizeScalar(src.website),
    comment: normalizeScalar(src.comment),
    lang: normalizeScalar(src.lang),
    tz: normalizeScalar(src.tz),
    categoryIds: normalizeMany2many(src.category_id),
    user: normalizeMany2one(src.user_id),
    customerRank: isOdooFalse(src.customer_rank) ? 0 : Number(src.customer_rank) || 0,
    supplierRank: isOdooFalse(src.supplier_rank) ? 0 : Number(src.supplier_rank) || 0,
    createDate: odooDatetimeToIso(src.create_date),
    writeDate: odooDatetimeToIso(src.write_date),
  };
}

function summarizeFieldsGet(fieldsMap, requiredNames, optionalPeNames) {
  const names = Object.keys(fieldsMap || {});
  const missingRequired = requiredNames.filter((n) => !fieldsMap[n]);
  const optionalPe = {};
  for (const n of optionalPeNames) {
    optionalPe[n] = Boolean(fieldsMap[n]);
  }
  const whitelistTypes = {};
  return {
    totalFields: names.length,
    missingRequired,
    optionalPe,
    whitelistTypes,
  };
}

function matchCategoryIds(categories, labels) {
  const found = { cliente: null, proveedor: null, contacto: null };
  for (const row of categories || []) {
    const name = String(row.name || row.display_name || '')
      .trim()
      .toLowerCase();
    for (const [key, aliases] of Object.entries(labels)) {
      if (found[key] != null) continue;
      if (aliases.includes(name)) {
        found[key] = { id: Number(row.id), name: row.name || row.display_name };
      }
    }
  }
  return found;
}

module.exports = {
  isOdooFalse,
  odooDatetimeToIso,
  normalizeMany2one,
  normalizeMany2many,
  normalizeScalar,
  normalizePartner,
  summarizeFieldsGet,
  matchCategoryIds,
};
