const { pool } = require('../config/db');
const { logAuditEvent } = require('../middleware/audit');
const { num, hashPayload, diffBudgetPayloads, payloadLineTotals } = require('./budgetRevisionDiff');

const CAUSE_LABEL = {
  BUDGET_ITEM_ADD: 'Alta / fusión de línea',
  BUDGET_ITEM_UPDATE: 'Línea modificada',
  BUDGET_ITEM_DELETE: 'Línea eliminada',
  BUDGET_CLEAR: 'Presupuesto vaciado',
  BUDGET_BUNDLE_ADD: 'Conjunto KIT agregado',
  BUDGET_BUNDLE_UPDATE: 'Conjunto KIT modificado',
  BUDGET_IMPORT_APPLY: 'Importación de líneas',
  BUDGET_RESTORE: 'Restauración de versión',
  BUDGET_BASELINE: 'Estado inicial registrado',
};

function iso(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  return v;
}

function mapItemForPayload(row) {
  return {
    id: row.id,
    catalogItemId: row.catalog_item_id || null,
    codigo: row.codigo,
    descripcion: row.descripcion,
    unidad: row.unidad,
    tipo: row.tipo,
    unitPrice: num(row.unit_price),
    officialUnitPrice: row.official_unit_price != null ? num(row.official_unit_price) : null,
    qty: num(row.qty),
    isCustom: row.is_custom === true,
    categoryId: row.category_id || null,
    sortOrder: num(row.sort_order, 0),
    applyAdjustment: row.apply_adjustment !== false,
    bundleId: row.bundle_id || null,
    isBundleHeader: row.is_bundle_header === true,
    isBundleComponent: row.is_bundle_component === true,
    componentGroupKey: row.component_group_key || null,
    componentGroupLabel: row.component_group_label || null,
    componentGroupSort: num(row.component_group_sort, 0),
    createdBy: row.created_by || null,
    updatedBy: row.updated_by || null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapBundleForPayload(row) {
  return {
    id: row.id,
    catalogItemId: row.catalog_item_id || null,
    instanceLabel: row.instance_label,
    displayName: row.display_name,
    unitPrice: num(row.unit_price),
    qty: num(row.qty, 1),
    sortOrder: num(row.sort_order, 0),
    createdBy: row.created_by || null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

async function loadBudgetRevisionPayload(projectId, client = pool) {
  const q = client.query.bind(client);
  const { rows: pr } = await q(`SELECT finance_params FROM projects WHERE id = $1`, [projectId]);
  if (!pr[0]) return null;
  const { rows: itemRows } = await q(
    `SELECT * FROM project_items WHERE project_id = $1 ORDER BY sort_order ASC, created_at ASC`,
    [projectId]
  );
  const { rows: bundleRows } = await q(
    `SELECT * FROM project_item_bundles WHERE project_id = $1 ORDER BY sort_order ASC, created_at ASC`,
    [projectId]
  );
  return {
    v: 1,
    items: itemRows.map(mapItemForPayload),
    bundles: bundleRows.map(mapBundleForPayload),
    financeParams: pr[0].finance_params && typeof pr[0].finance_params === 'object' ? pr[0].finance_params : {},
  };
}

async function latestRevision(projectId, client = pool) {
  const { rows } = await client.query(
    `SELECT * FROM project_budget_revisions WHERE project_id = $1 ORDER BY seq DESC LIMIT 1`,
    [projectId]
  );
  return rows[0] || null;
}

/**
 * Guarda una revisión si el presupuesto cambió. Dedup por hash.
 * @returns {{ skipped: boolean, revision?: object }}
 */
async function captureBudgetRevision(projectId, { actorId, cause, kind = 'AUTO', restoredFromId = null } = {}, client = pool) {
  const payload = await loadBudgetRevisionPayload(projectId, client);
  if (!payload) return { skipped: true, reason: 'NO_PROJECT' };

  const contentHash = hashPayload(payload);
  const latest = await latestRevision(projectId, client);
  if (latest && latest.content_hash === contentHash) {
    return { skipped: true, revision: latest };
  }

  const prevPayload = latest?.payload || { items: [], bundles: [] };
  const diff = diffBudgetPayloads(prevPayload, payload);
  const seq = (latest?.seq || 0) + 1;
  const itemCount = payload.items.length;

  const { rows } = await client.query(
    `INSERT INTO project_budget_revisions
       (project_id, seq, kind, cause, restored_from_id, actor_id, payload, content_hash,
        item_count, added_count, removed_count, changed_count)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12)
     RETURNING *`,
    [
      projectId,
      seq,
      kind,
      cause || null,
      restoredFromId,
      actorId || null,
      JSON.stringify(payload),
      contentHash,
      itemCount,
      diff.addedCount,
      diff.removedCount,
      diff.changedCount,
    ]
  );
  return { skipped: false, revision: rows[0] };
}

/** No interrumpe el flujo de cotización si falla la foto. */
async function recordBudgetRevision(projectId, meta, client = pool) {
  try {
    return await captureBudgetRevision(projectId, meta, client);
  } catch (err) {
    console.error('[BUDGET_REV] capture:', err.message);
    return { skipped: true, error: err.message };
  }
}

function mapRevisionApi(row, { includePayload = false } = {}) {
  const name = row.actor_name && String(row.actor_name).trim();
  return {
    id: row.id,
    projectId: row.project_id,
    seq: row.seq,
    kind: row.kind,
    cause: row.cause,
    causeLabel: CAUSE_LABEL[row.cause] || row.cause || 'Cambio',
    restoredFromId: row.restored_from_id,
    actorId: row.actor_id,
    actorEmail: row.actor_email || null,
    actorName: name || row.actor_email || null,
    contentHash: row.content_hash,
    itemCount: row.item_count,
    addedCount: row.added_count,
    removedCount: row.removed_count,
    changedCount: row.changed_count,
    createdAt: row.created_at,
    isCurrent: row.is_current === true,
    ...(includePayload ? { payload: row.payload } : {}),
  };
}

const REVISION_SELECT = `
  SELECT r.*,
         u.email AS actor_email,
         TRIM(CONCAT(e.nombres, ' ', e.apellidos)) AS actor_name
  FROM project_budget_revisions r
  LEFT JOIN users u ON u.id = r.actor_id
  LEFT JOIN employees e ON e.user_id = r.actor_id
`;

async function listBudgetRevisions(projectId) {
  await recordBudgetRevision(projectId, { cause: 'BUDGET_BASELINE' });
  const latest = await latestRevision(projectId);
  const { rows } = await pool.query(
    `${REVISION_SELECT}
     WHERE r.project_id = $1
     ORDER BY r.seq DESC
     LIMIT 400`,
    [projectId]
  );
  return rows.map((r) => mapRevisionApi({ ...r, is_current: latest && r.id === latest.id }));
}

async function getBudgetRevision(projectId, revisionId) {
  const { rows } = await pool.query(`${REVISION_SELECT} WHERE r.project_id = $1 AND r.id = $2`, [
    projectId,
    revisionId,
  ]);
  if (!rows[0]) return null;
  const current = await latestRevision(projectId);
  const { rows: prevRows } = await pool.query(
    `SELECT * FROM project_budget_revisions WHERE project_id = $1 AND seq < $2 ORDER BY seq DESC LIMIT 1`,
    [projectId, rows[0].seq]
  );
  const payload = rows[0].payload || { items: [], bundles: [] };
  const prevPayload = prevRows[0]?.payload || { items: [], bundles: [] };
  const livePayload =
    (await loadBudgetRevisionPayload(projectId)) || current?.payload || { items: [], bundles: [] };
  return {
    revision: mapRevisionApi({ ...rows[0], is_current: current && rows[0].id === current.id }, { includePayload: true }),
    previous: prevRows[0]
      ? mapRevisionApi(prevRows[0])
      : null,
    currentPayload: livePayload,
    diffFromPrevious: diffBudgetPayloads(prevPayload, payload),
    diffFromCurrent: diffBudgetPayloads(livePayload, payload),
    totals: {
      current: payloadLineTotals(livePayload),
      after: payloadLineTotals(payload),
    },
  };
}

async function existingIdSet(client, table, ids) {
  const clean = [...new Set((ids || []).filter(Boolean))];
  if (!clean.length) return new Set();
  const { rows } = await client.query(`SELECT id FROM ${table} WHERE id = ANY($1::uuid[])`, [clean]);
  return new Set(rows.map((r) => r.id));
}

/**
 * Inserta ítems/KITs desde un payload de revisión.
 * keepIds=true: restaura en el mismo proyecto (IDs originales).
 * keepIds=false: clona a otro proyecto con UUIDs nuevos y bundle_id remapeado.
 */
async function insertBudgetFromPayload(client, projectId, payload, { actorId, keepIds = false, applyFinance = true } = {}) {
  const items = Array.isArray(payload.items) ? payload.items : [];
  const bundles = Array.isArray(payload.bundles) ? payload.bundles : [];

  const catIdsOk = await existingIdSet(client, 'catalog_items', [
    ...items.map((i) => i.catalogItemId),
    ...bundles.map((b) => b.catalogItemId),
  ]);
  const categoryIds = await existingIdSet(
    client,
    'catalog_categories',
    items.map((i) => i.categoryId)
  );
  const userIds = await existingIdSet(client, 'users', [
    ...items.map((i) => i.createdBy),
    ...items.map((i) => i.updatedBy),
    ...bundles.map((b) => b.createdBy),
    actorId,
  ]);

  const bundleIdMap = new Map();

  for (const b of bundles) {
    const createdBy = keepIds
      ? b.createdBy && userIds.has(b.createdBy)
        ? b.createdBy
        : null
      : actorId && userIds.has(actorId)
        ? actorId
        : null;
    const catalogItemId = b.catalogItemId && catIdsOk.has(b.catalogItemId) ? b.catalogItemId : null;
    if (keepIds && b.id) {
      await client.query(
        `INSERT INTO project_item_bundles
           (id, project_id, catalog_item_id, instance_label, display_name, unit_price, qty, sort_order, created_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          b.id,
          projectId,
          catalogItemId,
          b.instanceLabel || '1',
          b.displayName || 'KIT',
          num(b.unitPrice),
          num(b.qty, 1),
          num(b.sortOrder, 0),
          createdBy,
          b.createdAt || new Date(),
          b.updatedAt || new Date(),
        ]
      );
      bundleIdMap.set(b.id, b.id);
    } else {
      const { rows } = await client.query(
        `INSERT INTO project_item_bundles
           (project_id, catalog_item_id, instance_label, display_name, unit_price, qty, sort_order, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING id`,
        [
          projectId,
          catalogItemId,
          b.instanceLabel || '1',
          b.displayName || 'KIT',
          num(b.unitPrice),
          num(b.qty, 1),
          num(b.sortOrder, 0),
          createdBy,
        ]
      );
      if (b.id) bundleIdMap.set(b.id, rows[0].id);
    }
  }

  let sortIdx = 0;
  for (const it of items) {
    const mappedBundleId = it.bundleId ? bundleIdMap.get(it.bundleId) || null : null;
    const createdBy = keepIds
      ? it.createdBy && userIds.has(it.createdBy)
        ? it.createdBy
        : null
      : actorId && userIds.has(actorId)
        ? actorId
        : null;
    const updatedBy = keepIds
      ? it.updatedBy && userIds.has(it.updatedBy)
        ? it.updatedBy
        : createdBy
      : createdBy;
    const catalogItemId = it.catalogItemId && catIdsOk.has(it.catalogItemId) ? it.catalogItemId : null;
    const categoryId = it.categoryId && categoryIds.has(it.categoryId) ? it.categoryId : null;
    const sortOrder = keepIds ? num(it.sortOrder, 0) : sortIdx++;

    if (keepIds && it.id) {
      await client.query(
        `INSERT INTO project_items
           (id, project_id, catalog_item_id, codigo, descripcion, unidad, tipo, unit_price, official_unit_price,
            qty, is_custom, category_id, sort_order, apply_adjustment, bundle_id, is_bundle_header, is_bundle_component,
            component_group_key, component_group_label, component_group_sort, created_by, updated_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
        [
          it.id,
          projectId,
          catalogItemId,
          it.codigo,
          it.descripcion,
          it.unidad || 'UND',
          it.tipo || 'ACTIVO',
          num(it.unitPrice),
          it.officialUnitPrice != null ? num(it.officialUnitPrice) : null,
          num(it.qty, 1),
          it.isCustom === true,
          categoryId,
          sortOrder,
          it.applyAdjustment !== false,
          mappedBundleId,
          it.isBundleHeader === true,
          it.isBundleComponent === true,
          it.componentGroupKey || null,
          it.componentGroupLabel || null,
          num(it.componentGroupSort, 0),
          createdBy,
          updatedBy,
          it.createdAt || new Date(),
          it.updatedAt || new Date(),
        ]
      );
    } else {
      await client.query(
        `INSERT INTO project_items
           (project_id, catalog_item_id, codigo, descripcion, unidad, tipo, unit_price, official_unit_price,
            qty, is_custom, category_id, sort_order, apply_adjustment, bundle_id, is_bundle_header, is_bundle_component,
            component_group_key, component_group_label, component_group_sort, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
        [
          projectId,
          catalogItemId,
          it.codigo,
          it.descripcion,
          it.unidad || 'UND',
          it.tipo || 'ACTIVO',
          num(it.unitPrice),
          it.officialUnitPrice != null ? num(it.officialUnitPrice) : num(it.unitPrice),
          num(it.qty, 1),
          it.isCustom === true,
          categoryId,
          sortOrder,
          it.applyAdjustment !== false,
          mappedBundleId,
          it.isBundleHeader === true,
          it.isBundleComponent === true,
          it.componentGroupKey || null,
          it.componentGroupLabel || null,
          num(it.componentGroupSort, 0),
          createdBy,
          updatedBy,
        ]
      );
    }
  }

  if (!applyFinance) return;
  if (payload.financeParams && typeof payload.financeParams === 'object') {
    await client.query(`UPDATE projects SET finance_params = $2::jsonb, updated_at = NOW() WHERE id = $1`, [
      projectId,
      JSON.stringify(payload.financeParams),
    ]);
  } else {
    await client.query(`UPDATE projects SET updated_at = NOW() WHERE id = $1`, [projectId]);
  }
}

function clipNombre(s, max = 200) {
  const t = String(s || '').trim();
  if (!t) return '';
  return t.length <= max ? t : t.slice(0, max);
}

async function restoreBudgetRevision(projectId, revisionId, { actorId, ip } = {}) {
  const client = await pool.connect();
  try {
    const { rows: targetRows } = await client.query(
      `SELECT * FROM project_budget_revisions WHERE project_id = $1 AND id = $2`,
      [projectId, revisionId]
    );
    const target = targetRows[0];
    if (!target) {
      const err = new Error('Revisión no encontrada');
      err.code = 'NOT_FOUND';
      throw err;
    }
    const payload = target.payload || {};
    const currentHash = hashPayload(await loadBudgetRevisionPayload(projectId, client));
    if (target.content_hash === currentHash) {
      const err = new Error('El presupuesto ya está en este estado');
      err.code = 'ALREADY_CURRENT';
      throw err;
    }

    await captureBudgetRevision(projectId, { actorId, cause: 'BUDGET_RESTORE', kind: 'AUTO' }, client);

    await client.query('BEGIN');

    await client.query(`DELETE FROM project_item_bundles WHERE project_id = $1`, [projectId]);
    await client.query(`DELETE FROM project_items WHERE project_id = $1`, [projectId]);

    await insertBudgetFromPayload(client, projectId, payload, { actorId, keepIds: true });

    await client.query('COMMIT');

    const after = await captureBudgetRevision(
      projectId,
      { actorId, cause: 'BUDGET_RESTORE', kind: 'RESTORE', restoredFromId: target.id },
      client
    );

    logAuditEvent({
      projectId,
      eventType: 'BUDGET_RESTORE',
      actorId,
      prevData: { fromHash: currentHash, itemCountBefore: undefined },
      newData: {
        restoredFromId: target.id,
        restoredSeq: target.seq,
        revisionId: after.revision?.id,
        seq: after.revision?.seq,
      },
      ip,
    });

    return {
      restoredFrom: mapRevisionApi(target),
      newRevision: after.revision ? mapRevisionApi(after.revision) : null,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Crea un proyecto BORRADOR con el presupuesto de una revisión.
 * No modifica el proyecto origen.
 */
async function cloneProjectFromRevision(sourceProjectId, revisionId, { actorId, nombre, ip } = {}) {
  const client = await pool.connect();
  try {
    const { rows: srcRows } = await client.query(`SELECT * FROM projects WHERE id = $1`, [sourceProjectId]);
    const src = srcRows[0];
    if (!src) {
      const err = new Error('Proyecto no encontrado');
      err.code = 'NOT_FOUND';
      throw err;
    }
    if (src.deleted_at) {
      const err = new Error('No se puede clonar un proyecto archivado');
      err.code = 'DELETED';
      throw err;
    }

    const { rows: targetRows } = await client.query(
      `SELECT * FROM project_budget_revisions WHERE project_id = $1 AND id = $2`,
      [sourceProjectId, revisionId]
    );
    const target = targetRows[0];
    if (!target) {
      const err = new Error('Revisión no encontrada');
      err.code = 'NOT_FOUND';
      throw err;
    }

    const payload = target.payload || {};
    const defaultName = `Copia de ${src.nombre} · rev #${target.seq}`;
    const cloneName = clipNombre(nombre) || clipNombre(defaultName);

    const fp =
      payload.financeParams && typeof payload.financeParams === 'object'
        ? payload.financeParams
        : src.finance_params && typeof src.finance_params === 'object'
          ? src.finance_params
          : {};

    await client.query('BEGIN');

    const { rows: ins } = await client.query(
      `INSERT INTO projects
        (nombre, odoo_ref, client_id, status, created_by, assigned_viewer, currency, tc, finance_params, quotation_market)
       VALUES ($1, $2, $3, 'BORRADOR', $4, NULL, $5, $6, $7::jsonb, $8)
       RETURNING *`,
      [
        cloneName,
        src.odoo_ref,
        src.client_id,
        actorId,
        src.currency,
        src.tc,
        JSON.stringify(fp),
        src.quotation_market || 'NACIONAL',
      ]
    );
    const newId = ins[0].id;

    await insertBudgetFromPayload(client, newId, payload, { actorId, keepIds: false, applyFinance: true });

    await client.query('COMMIT');

    await recordBudgetRevision(newId, { actorId, cause: 'BUDGET_BASELINE' });

    const itemCount = Array.isArray(payload.items) ? payload.items.length : 0;
    logAuditEvent({
      projectId: newId,
      eventType: 'PROJECT_CLONE',
      actorId,
      prevData: { sourceProjectId, sourceRevisionId: target.id, sourceSeq: target.seq },
      newData: { id: newId, nombre: cloneName, fromRevision: true, itemCount },
      ip,
    });

    return {
      projectId: newId,
      nombre: cloneName,
      sourceProjectId,
      sourceRevisionId: target.id,
      sourceSeq: target.seq,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  CAUSE_LABEL,
  hashPayload,
  diffBudgetPayloads,
  captureBudgetRevision,
  recordBudgetRevision,
  listBudgetRevisions,
  getBudgetRevision,
  restoreBudgetRevision,
  cloneProjectFromRevision,
  loadBudgetRevisionPayload,
};
