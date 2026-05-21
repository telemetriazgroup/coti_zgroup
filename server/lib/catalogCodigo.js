/** Prefijos de código por categoría — ej. SF → SF-0011 */

const SEQ_DIGITS = 4;

function normalizePrefix(prefix) {
  if (!prefix) return null;
  const p = String(prefix).trim().toUpperCase().replace(/\s+/g, '');
  return p || null;
}

function formatCodigo(prefix, seq) {
  const p = normalizePrefix(prefix);
  if (!p) return null;
  const n = Math.max(1, parseInt(seq, 10) || 1);
  return `${p}-${String(n).padStart(SEQ_DIGITS, '0')}`;
}

function parseCodigoSeq(codigo, prefix) {
  const p = normalizePrefix(prefix);
  if (!p || !codigo) return null;
  const re = new RegExp(`^${escapeRegExp(p)}-(\\d{${SEQ_DIGITS}})$`, 'i');
  const m = String(codigo).trim().match(re);
  if (!m) return null;
  return parseInt(m[1], 10);
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function codigoMatchesPrefix(codigo, prefix) {
  return parseCodigoSeq(codigo, prefix) != null;
}

/** Máximo correlativo usado en ítems de la categoría con ese prefijo. */
async function getMaxSeqInCategory(categoryId, prefix, client = null) {
  const q = client ? client.query.bind(client) : require('../config/db').pool.query.bind(require('../config/db').pool);
  const p = normalizePrefix(prefix);
  if (!p) return 0;
  const { rows } = await q(
    `SELECT codigo FROM catalog_items WHERE category_id = $1`,
    [categoryId]
  );
  let max = 0;
  for (const r of rows) {
    const seq = parseCodigoSeq(r.codigo, p);
    if (seq != null && seq > max) max = seq;
  }
  return max;
}

async function syncCategoryNextSeq(categoryId, prefix, client = null) {
  const q = client ? client.query.bind(client) : require('../config/db').pool.query.bind(require('../config/db').pool);
  const max = await getMaxSeqInCategory(categoryId, prefix, client);
  const next = max + 1;
  await q(`UPDATE catalog_categories SET next_seq = $1 WHERE id = $2`, [next, categoryId]);
  return next;
}

async function suggestNextCodigo(categoryRow, client = null) {
  const prefix = normalizePrefix(categoryRow.codigo_prefix);
  if (!prefix) return { prefix: null, suggestedCodigo: null, nextSeq: null, minSeq: null };
  const max = await getMaxSeqInCategory(categoryRow.id, prefix, client);
  const nextSeq = max + 1;
  return {
    prefix,
    suggestedCodigo: formatCodigo(prefix, nextSeq),
    nextSeq,
    minSeq: nextSeq,
    maxSeq: max,
  };
}

/**
 * Valida código al crear/editar ítem.
 * @param {object} opts
 * @param {string} opts.codigo
 * @param {string} opts.prefix
 * @param {string} opts.categoryId
 * @param {string|null} opts.excludeItemId - al editar, excluir ítem actual del max
 * @param {string|null} opts.previousCodigo - al editar, código anterior (permite mantenerlo)
 * @param {boolean} opts.isNew
 */
async function validateCategoryCodigo(opts, client = null) {
  const q = client ? client.query.bind(client) : require('../config/db').pool.query.bind(require('../config/db').pool);
  const prefix = normalizePrefix(opts.prefix);
  if (!prefix) return { ok: true };

  const codigo = String(opts.codigo || '').trim();
  const seq = parseCodigoSeq(codigo, prefix);
  if (seq == null) {
    return {
      ok: false,
      code: 'CODIGO_PREFIX_FORMAT',
      message: `El código debe tener formato ${prefix}-${'0'.repeat(SEQ_DIGITS - 1)}1 (ej. ${formatCodigo(prefix, 1)})`,
    };
  }

  let sql = `SELECT codigo FROM catalog_items WHERE category_id = $1`;
  const params = [opts.categoryId];
  if (opts.excludeItemId) {
    params.push(opts.excludeItemId);
    sql += ` AND id != $2`;
  }
  const { rows } = await q(sql, params);
  let maxOther = 0;
  for (const r of rows) {
    const s = parseCodigoSeq(r.codigo, prefix);
    if (s != null && s > maxOther) maxOther = s;
  }

  const minAllowed = maxOther + 1;

  if (!opts.isNew && opts.previousCodigo) {
    const prevSeq = parseCodigoSeq(String(opts.previousCodigo).trim(), prefix);
    if (prevSeq === seq) {
      return { ok: true, seq, prefix };
    }
  }

  // Nuevo ítem: no puede usar correlativo menor al siguiente libre (max+1), pero sí mayor
  if (opts.isNew && seq < minAllowed) {
    return {
      ok: false,
      code: 'CODIGO_SEQ_TOO_LOW',
      message: `El correlativo mínimo es ${formatCodigo(prefix, minAllowed)}. Puede usar ${formatCodigo(prefix, seq)} solo si es ≥ ${formatCodigo(prefix, minAllowed)}.`,
    };
  }

  // Edición: correlativo no puede ser menor que max(other)+1
  if (!opts.isNew && seq < minAllowed) {
    return {
      ok: false,
      code: 'CODIGO_SEQ_TOO_LOW',
      message: `El correlativo mínimo es ${formatCodigo(prefix, minAllowed)}.`,
    };
  }

  return { ok: true, seq, prefix };
}

async function afterItemCodigoSaved(categoryId, prefix, codigo, client = null) {
  const p = normalizePrefix(prefix);
  if (!p) return;
  const seq = parseCodigoSeq(codigo, p);
  if (seq == null) return;
  const max = await getMaxSeqInCategory(categoryId, p, client);
  const next = Math.max(max, seq) + 1;
  const q = client ? client.query.bind(client) : require('../config/db').pool.query.bind(require('../config/db').pool);
  await q(`UPDATE catalog_categories SET next_seq = $1 WHERE id = $2`, [next, categoryId]);
}

module.exports = {
  SEQ_DIGITS,
  normalizePrefix,
  formatCodigo,
  parseCodigoSeq,
  codigoMatchesPrefix,
  getMaxSeqInCategory,
  syncCategoryNextSeq,
  suggestNextCodigo,
  validateCategoryCodigo,
  afterItemCodigoSaved,
};
