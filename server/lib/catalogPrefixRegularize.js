/** Análisis y aplicación masiva de prefijos/correlativos por categoría (SUPERUSER). */

const { pool } = require('../config/db');
const {
  normalizePrefix,
  formatCodigo,
  parseCodigoSeq,
  syncCategoryNextSeq,
} = require('./catalogCodigo');
const { logCatalogChanges } = require('./catalogChangeLog');

function mapAnalysis(cat, items) {
  const prefix = normalizePrefix(cat.codigo_prefix);
  if (!prefix) {
    return {
      categoryId: cat.id,
      nombre: cat.nombre,
      prefix: null,
      skipped: true,
      reason: 'Sin prefijo configurado',
    };
  }

  let maxSeq = 0;
  const invalidItems = [];

  for (const it of items) {
    const seq = parseCodigoSeq(it.codigo, prefix);
    if (seq == null) {
      invalidItems.push({ id: it.id, codigo: it.codigo });
    } else if (seq > maxSeq) {
      maxSeq = seq;
    }
  }

  let nextForInvalid = maxSeq + 1;
  const proposedFixes = invalidItems.map((it) => {
    const suggestedCodigo = formatCodigo(prefix, nextForInvalid);
    nextForInvalid += 1;
    return { id: it.id, codigo: it.codigo, suggestedCodigo };
  });

  const proposedNextSeq = invalidItems.length ? nextForInvalid : maxSeq + 1;

  return {
    categoryId: cat.id,
    nombre: cat.nombre,
    prefix,
    skipped: false,
    currentNextSeq: cat.next_seq,
    maxSeq,
    proposedNextSeq,
    itemCount: items.length,
    invalidCount: invalidItems.length,
    proposedFixes,
    needsNextSeqUpdate: Number(cat.next_seq) !== proposedNextSeq,
    hasChanges: Number(cat.next_seq) !== proposedNextSeq || invalidItems.length > 0,
  };
}

async function previewPrefixRegularization(client = null) {
  const q = client ? client.query.bind(client) : pool.query.bind(pool);
  const { rows: cats } = await q(
    `SELECT * FROM catalog_categories WHERE active = true ORDER BY sort_order, nombre`
  );
  const analyses = [];
  for (const cat of cats) {
    const { rows: items } = await q(
      `SELECT id, codigo FROM catalog_items WHERE category_id = $1 ORDER BY codigo`,
      [cat.id]
    );
    analyses.push(mapAnalysis(cat, items));
  }
  const actionable = analyses.filter((a) => !a.skipped && a.hasChanges);
  return {
    categories: analyses,
    summary: {
      total: analyses.length,
      withPrefix: analyses.filter((a) => !a.skipped).length,
      needingUpdate: actionable.length,
      invalidItems: actionable.reduce((n, a) => n + (a.invalidCount || 0), 0),
    },
  };
}

async function applyPrefixRegularization(opts, actorId, client = null) {
  const ownClient = !client;
  const db = client || (await pool.connect());
  const q = db.query.bind(db);

  try {
    if (ownClient) await db.query('BEGIN');

    const preview = await previewPrefixRegularization(db);
    const selected = new Set(opts.categoryIds || []);
    const filterAll = !opts.categoryIds?.length;

    let categoriesUpdated = 0;
    let itemsRenamed = 0;

    for (const a of preview.categories) {
      if (a.skipped || !a.hasChanges) continue;
      if (!filterAll && !selected.has(a.categoryId)) continue;

      if (opts.fixInvalidCodigos && a.proposedFixes?.length) {
        for (const fix of a.proposedFixes) {
          const { rows: before } = await q(`SELECT * FROM catalog_items WHERE id = $1`, [fix.id]);
          if (!before[0] || before[0].codigo === fix.suggestedCodigo) continue;
          await q(`UPDATE catalog_items SET codigo = $1, updated_at = NOW() WHERE id = $2`, [
            fix.suggestedCodigo,
            fix.id,
          ]);
          const { rows: after } = await q(`SELECT * FROM catalog_items WHERE id = $1`, [fix.id]);
          await logCatalogChanges(
            {
              entityType: 'ITEM',
              entityId: fix.id,
              entityLabel: fix.suggestedCodigo,
              actorId,
              changeSource: 'PREFIX_REGULARIZE',
              changes: [{ field: 'codigo', oldValue: fix.codigo, newValue: fix.suggestedCodigo }],
            },
            db
          );
          itemsRenamed += 1;
        }
      }

      await syncCategoryNextSeq(a.categoryId, a.prefix, db);
      categoriesUpdated += 1;
    }

    if (ownClient) await db.query('COMMIT');
    return { categoriesUpdated, itemsRenamed };
  } catch (err) {
    if (ownClient) await db.query('ROLLBACK');
    throw err;
  } finally {
    if (ownClient) db.release();
  }
}

module.exports = {
  previewPrefixRegularization,
  applyPrefixRegularization,
};
