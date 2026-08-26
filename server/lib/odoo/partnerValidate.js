/** Validación espejo de res.partner antes de encolar en outbox (etapa 5). */

function normalizeVat(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const digits = s.replace(/\D/g, '');
  return digits || null;
}

function isValidPeRuc11(vat) {
  if (!/^\d{11}$/.test(vat)) return false;
  const factors = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 10; i += 1) sum += Number(vat[i]) * factors[i];
  const check = 11 - (sum % 11);
  const digit = check === 11 ? 0 : check === 10 ? 1 : check;
  return digit === Number(vat[10]);
}

function stubNameFromRuc(vat) {
  return `RUC ${vat}`;
}

function isConsultablePeRuc(vat) {
  return Boolean(vat && vat.length === 11 && isValidPeRuc11(vat));
}

function shouldConsultSunat(payload = {}) {
  if (payload.consultarSunat === false) return false;
  if (payload.consultarSunat === true) return isConsultablePeRuc(normalizeVat(payload.ruc || payload.vat));
  return isConsultablePeRuc(normalizeVat(payload.ruc || payload.vat));
}

function validatePartnerWrite({ razonSocial, ruc, contactoEmail } = {}) {
  const errors = [];
  const vat = normalizeVat(ruc);
  let name = String(razonSocial || '').trim();
  const sunatCanFill = isConsultablePeRuc(vat);
  if (!name && sunatCanFill) name = stubNameFromRuc(vat);
  if (!name) errors.push('Razón social o RUC peruano de 11 dígitos requerido');
  if (name.length > 512) errors.push('Razón social máximo 512 caracteres');

  if (ruc != null && String(ruc).trim() && !vat) {
    errors.push('RUC inválido (use dígitos)');
  }
  if (vat && vat.length === 11 && !isValidPeRuc11(vat)) {
    errors.push('RUC peruano inválido (dígito de control)');
  }
  if (vat && vat.length !== 8 && vat.length !== 11) {
    errors.push('RUC/DNI: 11 dígitos (empresa) u 8 (DNI). Deje vacío si aún no tiene.');
  }

  const email = String(contactoEmail || '').trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push('Email de contacto inválido');
  }

  return {
    ok: errors.length === 0,
    errors,
    name,
    vat,
    email: email || null,
    consultarSunat: sunatCanFill,
  };
}

function odooEmpty(v) {
  if (v == null) return false;
  const s = String(v).trim();
  return s === '' ? false : s;
}

function buildCreateVals(payload, { categoryClienteId, identificationTypeId } = {}) {
  const v = validatePartnerWrite(payload);
  if (!v.ok) {
    const err = new Error(v.errors[0]);
    err.code = 'VALIDATION_ERROR';
    err.details = v.errors;
    throw err;
  }
  const vals = {
    name: v.name,
    is_company: true,
    company_type: 'company',
    x_ztrack_uid: payload.xZtrackUid,
    customer_rank: 1,
  };
  if (v.vat) vals.vat = v.vat;
  const street = odooEmpty(payload.direccion);
  if (street !== false) vals.street = street;
  const street2 = odooEmpty(payload.street2);
  if (street2 !== false) vals.street2 = street2;
  const city = odooEmpty(payload.ciudad);
  if (city !== false) vals.city = city;
  const zip = odooEmpty(payload.zip);
  if (zip !== false) vals.zip = zip;
  if (v.email) vals.email = v.email;
  const phone = odooEmpty(payload.contactoTelefono);
  if (phone !== false) vals.phone = phone;
  const mobile = odooEmpty(payload.mobile);
  if (mobile !== false) vals.mobile = mobile;
  const website = odooEmpty(payload.website);
  if (website !== false) vals.website = website;
  const comment = odooEmpty(payload.notas);
  if (comment !== false) vals.comment = comment;
  vals.lang = payload.lang || 'es_PE';
  if (Number.isFinite(Number(categoryClienteId)) && Number(categoryClienteId) > 0) {
    vals.category_id = [[6, 0, [Number(categoryClienteId)]]];
  }
  if (Number.isFinite(Number(identificationTypeId)) && Number(identificationTypeId) > 0 && v.vat) {
    vals.l10n_latam_identification_type_id = Number(identificationTypeId);
  }
  return vals;
}

function buildWriteVals(payload) {
  const v = validatePartnerWrite({
    razonSocial: payload.razonSocial != null ? payload.razonSocial : 'x',
    ruc: payload.ruc,
    contactoEmail: payload.contactoEmail,
  });
  if (payload.razonSocial != null && !String(payload.razonSocial).trim()) {
    const err = new Error('Razón social requerida');
    err.code = 'VALIDATION_ERROR';
    throw err;
  }
  if (payload.ruc != null && payload.ruc !== '' && !v.ok && v.errors.some((e) => /RUC/i.test(e))) {
    const err = new Error(v.errors.find((e) => /RUC/i.test(e)));
    err.code = 'VALIDATION_ERROR';
    throw err;
  }
  const vals = {};
  if (payload.razonSocial != null) vals.name = String(payload.razonSocial).trim();
  if (payload.ruc !== undefined) vals.vat = v.vat || false;
  if (payload.direccion !== undefined) vals.street = odooEmpty(payload.direccion);
  if (payload.street2 !== undefined) vals.street2 = odooEmpty(payload.street2);
  if (payload.ciudad !== undefined) vals.city = odooEmpty(payload.ciudad);
  if (payload.zip !== undefined) vals.zip = odooEmpty(payload.zip);
  if (payload.contactoEmail !== undefined) vals.email = v.email || false;
  if (payload.contactoTelefono !== undefined) vals.phone = odooEmpty(payload.contactoTelefono);
  if (payload.mobile !== undefined) vals.mobile = odooEmpty(payload.mobile);
  if (payload.website !== undefined) vals.website = odooEmpty(payload.website);
  if (payload.notas !== undefined) vals.comment = odooEmpty(payload.notas);
  return vals;
}

function nextAttemptAt(attempts, now = Date.now()) {
  // Máximo 10 min: un timeout de staging no debe dejar la ficha «Enviando…» 1 h.
  const delays = [0, 15_000, 30_000, 120_000, 300_000, 600_000];
  const ms = delays[Math.min(Math.max(attempts, 0), delays.length - 1)];
  return new Date(now + ms);
}

function normalizeOdooText(v) {
  if (v == null || v === false) return '';
  return String(v)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function shouldRetryFault(kind) {
  return (
    kind !== 'ValidationError' &&
    kind !== 'AccessError' &&
    kind !== 'UserError' &&
    kind !== 'ODOO_WRITE_BLOCKED' &&
    kind !== 'ODOO_NOT_CONFIGURED'
  );
}

function usefulFaultLine(raw) {
  const lines = String(raw || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const hit = [...lines].reverse().find((l) =>
    /ValidationError|AccessError|UserError|MissingError|XML-RPC|Timeout|ECONNREFUSED|Error:|Exception:/i.test(
      l
    )
  );
  if (hit) return hit.replace(/^odoo\.exceptions\./, '');
  return lines.find((l) => !/^Traceback/i.test(l) && !/^File\b/.test(l)) || lines[0] || String(raw || 'Error Odoo');
}

function userMessageFromOdooFault(err) {
  const kind = err && err.odooErrorKind;
  const raw = String((err && (err.faultString || err.message)) || 'Error Odoo');
  const first = usefulFaultLine(raw);
  if (kind === 'ValidationError') {
    return first.replace(/^.*ValidationError[:\s]*/i, '').slice(0, 280) || 'Odoo rechazó los datos (RUC u otro campo).';
  }
  if (kind === 'AccessError') return 'Sin permiso en Odoo para crear/editar Contactos. Revise el usuario de integración.';
  if (kind === 'MissingError') return 'El contacto ya no existe en Odoo.';
  if (kind === 'UserError') return first.slice(0, 280);
  return first.slice(0, 280);
}

module.exports = {
  normalizeVat,
  isValidPeRuc11,
  stubNameFromRuc,
  isConsultablePeRuc,
  shouldConsultSunat,
  validatePartnerWrite,
  buildCreateVals,
  buildWriteVals,
  nextAttemptAt,
  shouldRetryFault,
  userMessageFromOdooFault,
  normalizeOdooText,
};
