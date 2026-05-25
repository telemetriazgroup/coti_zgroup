/** Análisis y aplicación masiva de prefijos/correlativos por categoría (SUPERUSER). */

const { pool } = require('../config/db');
const {
  normalizePrefix,
  formatCodigo,
  parseCodigoSeq,
  syncCategoryNextSeq,
} = require('./catalogCodigo');
const { logCatalogChanges } = require('./catalogChangeLog');

function normalizeDescKey(descripcion) {
  return String(descripcion || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function findDuplicateDescriptions(items) {
  const byDesc = new Map();
  for (const it of items) {
    if (it.active === false) continue;
    const key = normalizeDescKey(it.descripcion);
    if (!key) continue;
    if (!byDesc.has(key)) byDesc.set(key, []);
    byDesc.get(key).push({
      id: it.id,
      codigo: it.codigo,
      descripcion: it.descripcion,
    });
  }
  return [...byDesc.values()]
    .filter((g) => g.length > 1)
    .map((g) => ({
      descripcion: g[0].descripcion,
      items: g,
    }));
}

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
  const occupied = new Set(items.map((it) => String(it.codigo).trim().toUpperCase()));

  for (const it of items) {
    const seq = parseCodigoSeq(it.codigo, prefix);
    if (seq == null) {
      invalidItems.push({ id: it.id, codigo: it.codigo, descripcion: it.descripcion });
    } else if (seq > maxSeq) {
      maxSeq = seq;
    }
  }

  let nextForInvalid = maxSeq + 1;
  const proposedFixes = invalidItems.map((it) => {
    let suggestedCodigo;
    do {
      suggestedCodigo = formatCodigo(prefix, nextForInvalid);
      nextForInvalid += 1;
    } while (occupied.has(suggestedCodigo.toUpperCase()));
    occupied.add(suggestedCodigo.toUpperCase());
    return {
      id: it.id,
      codigo: it.codigo,
      descripcion: it.descripcion,
      suggestedCodigo,
    };
  });

  const duplicateDescriptions = findDuplicateDescriptions(items);

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
    duplicateDescriptions,
    duplicateDescriptionCount: duplicateDescriptions.length,
    needsNextSeqUpdate: Number(cat.next_seq) !== proposedNextSeq,
    hasChanges: Number(cat.next_seq) !== proposedNextSeq || invalidItems.length > 0,
    hasWarnings: duplicateDescriptions.length > 0,
  };
}

async function loadBudgetImpactByItemIds(itemIds, client = null) {
  if (!itemIds.length) return new Map();
  const q = client ? client.query.bind(client) : pool.query.bind(pool);
  const { rows } = await q(
    `SELECT pi.catalog_item_id,
            COUNT(*)::int AS line_count,
            COUNT(DISTINCT pi.project_id)::int AS project_count,
            COUNT(*) FILTER (WHERE pi.codigo <> ci.codigo)::int AS stale_codigo_lines
     FROM project_items pi
     INNER JOIN catalog_items ci ON ci.id = pi.catalog_item_id
     WHERE pi.catalog_item_id = ANY($1::uuid[])
     GROUP BY pi.catalog_item_id`,
    [itemIds]
  );
  const map = new Map();
  for (const r of rows) {
    map.set(r.catalog_item_id, {
      lineCount: r.line_count,
      projectCount: r.project_count,
      staleCodigoLines: r.stale_codigo_lines,
    });
  }
  return map;
}

function enrichAnalysesWithBudgetImpact(analyses, budgetMap) {
  let budgetLinesToUpdate = 0;
  let staleCodigoLines = 0;

  for (const a of analyses) {
    if (a.skipped) continue;
    a.proposedFixes = (a.proposedFixes || []).map((fix) => {
      const impact = budgetMap.get(fix.id) || {
        lineCount: 0,
        projectCount: 0,
        staleCodigoLines: 0,
      };
      budgetLinesToUpdate += impact.lineCount;
      staleCodigoLines += impact.staleCodigoLines;
      return { ...fix, budgetImpact: impact };
    });
  }

  return { budgetLinesToUpdate, staleCodigoLines };
}

async function previewPrefixRegularization(client = null) {
  const q = client ? client.query.bind(client) : pool.query.bind(pool);
  const { rows: cats } = await q(
    `SELECT * FROM catalog_categories WHERE active = true ORDER BY sort_order, nombre`
  );
  const analyses = [];
  const allFixItemIds = [];

  for (const cat of cats) {
    const { rows: items } = await q(
      `SELECT id, codigo, descripcion, active FROM catalog_items WHERE category_id = $1 ORDER BY codigo`,
      [cat.id]
    );
    const analysis = mapAnalysis(cat, items);
    analyses.push(analysis);
    for (const fix of analysis.proposedFixes || []) {
      allFixItemIds.push(fix.id);
    }
  }

  const budgetMap = await loadBudgetImpactByItemIds(allFixItemIds, client);
  const budgetStats = enrichAnalysesWithBudgetImpact(analyses, budgetMap);

  const actionable = analyses.filter((a) => !a.skipped && a.hasChanges);
  const duplicateGroups = analyses
    .filter((a) => !a.skipped && a.duplicateDescriptions?.length)
    .flatMap((a) =>
      a.duplicateDescriptions.map((d) => ({
        categoryId: a.categoryId,
        categoryNombre: a.nombre,
        ...d,
      }))
    );

  return {
    categories: analyses,
    duplicateDescriptionGroups: duplicateGroups,
    summary: {
      total: analyses.length,
      withPrefix: analyses.filter((a) => !a.skipped).length,
      needingUpdate: actionable.length,
      invalidItems: actionable.reduce((n, a) => n + (a.invalidCount || 0), 0),
      duplicateDescriptionGroups: duplicateGroups.length,
      duplicateDescriptionItems: duplicateGroups.reduce((n, g) => n + g.items.length, 0),
      budgetLinesToUpdate: budgetStats.budgetLinesToUpdate,
      staleCodigoLines: budgetStats.staleCodigoLines,
    },
  };
}

async function syncProjectItemCodigos(catalogItemId, newCodigo, client) {
  const { rowCount } = await client.query(
    `UPDATE project_items
     SET codigo = $1, updated_at = NOW()
     WHERE catalog_item_id = $2 AND codigo IS DISTINCT FROM $1`,
    [newCodigo, catalogItemId]
  );
  return rowCount || 0;
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
    let budgetLinesUpdated = 0;

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
          if (opts.syncBudgetCodigos !== false) {
            budgetLinesUpdated += await syncProjectItemCodigos(fix.id, fix.suggestedCodigo, db);
          }
          itemsRenamed += 1;
        }
      }

      await syncCategoryNextSeq(a.categoryId, a.prefix, db);
      categoriesUpdated += 1;
    }

    if (ownClient) await db.query('COMMIT');
    return { categoriesUpdated, itemsRenamed, budgetLinesUpdated };
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
  normalizeDescKey,
  findDuplicateDescriptions,
};
