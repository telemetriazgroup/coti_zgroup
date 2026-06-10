/** Dependencias entre ítems de catálogo (componentes / BOM). */

const { pool } = require('../config/db');

function mapDepRow(row, child = null) {
  return {
    id: row.id,
    parentItemId: row.parent_item_id,
    childItemId: row.child_item_id,
    qty: row.qty != null ? Number(row.qty) : 1,
    sortOrder: row.sort_order,
    child: child
      ? {
          id: child.id,
          codigo: child.codigo,
          descripcion: child.descripcion,
          unidad: child.unidad,
          tipo: child.tipo,
          unitPrice: child.unit_price != null ? Number(child.unit_price) : 0,
          active: child.active !== false,
          categoryId: child.category_id,
        }
      : undefined,
  };
}

async function fetchDirectDependencies(parentItemId, client = null) {
  const q = client ? client.query.bind(client) : pool.query.bind(pool);
  const { rows } = await q(
    `SELECT d.*, c.id AS c_id, c.codigo AS c_codigo, c.descripcion AS c_descripcion,
            c.unidad AS c_unidad, c.tipo AS c_tipo, c.unit_price AS c_unit_price,
            c.active AS c_active, c.category_id AS c_category_id
     FROM catalog_item_dependencies d
     INNER JOIN catalog_items c ON c.id = d.child_item_id
     WHERE d.parent_item_id = $1
     ORDER BY d.sort_order ASC, c.codigo ASC`,
    [parentItemId]
  );
  return rows.map((r) =>
    mapDepRow(r, {
      id: r.c_id,
      codigo: r.c_codigo,
      descripcion: r.c_descripcion,
      unidad: r.c_unidad,
      tipo: r.c_tipo,
      unit_price: r.c_unit_price,
      active: r.c_active,
      category_id: r.c_category_id,
    })
  );
}

async function wouldCreateCycle(parentItemId, childItemId, client = null) {
  if (parentItemId === childItemId) return true;
  const q = client ? client.query.bind(client) : pool.query.bind(pool);
  const visited = new Set();
  const stack = [childItemId];
  while (stack.length) {
    const cur = stack.pop();
    if (cur === parentItemId) return true;
    if (visited.has(cur)) continue;
    visited.add(cur);
    const { rows } = await q(
      `SELECT child_item_id FROM catalog_item_dependencies WHERE parent_item_id = $1`,
      [cur]
    );
    for (const r of rows) stack.push(r.child_item_id);
  }
  return false;
}

async function validateDependencies(parentItemId, deps, client = null) {
  const q = client ? client.query.bind(client) : pool.query.bind(pool);
  const seen = new Set();
  const normalized = [];

  for (let i = 0; i < deps.length; i++) {
    const d = deps[i];
    const childItemId = d.childItemId || d.child_item_id;
    const qty = Number(d.qty);
    if (!childItemId) {
      return { ok: false, code: 'INVALID_DEP', message: 'Dependencia sin ítem hijo' };
    }
    if (childItemId === parentItemId) {
      return { ok: false, code: 'SELF_REFERENCE', message: 'Un ítem no puede depender de sí mismo' };
    }
    if (seen.has(childItemId)) {
      return { ok: false, code: 'DUPLICATE_DEP', message: 'Ítem dependiente repetido en la lista' };
    }
    seen.add(childItemId);
    if (!Number.isFinite(qty) || qty <= 0) {
      return { ok: false, code: 'INVALID_QTY', message: 'Cantidad de dependencia inválida' };
    }
    const { rows: child } = await q(`SELECT id, active FROM catalog_items WHERE id = $1`, [childItemId]);
    if (!child[0]) {
      return { ok: false, code: 'NOT_FOUND', message: 'Ítem dependiente no encontrado' };
    }
    if (child[0].active === false) {
      return { ok: false, code: 'INACTIVE_CHILD', message: 'El ítem dependiente debe estar activo' };
    }
    if (await wouldCreateCycle(parentItemId, childItemId, client)) {
      return { ok: false, code: 'CYCLE', message: 'La dependencia crearía un ciclo en el catálogo' };
    }
    normalized.push({ childItemId, qty, sortOrder: i });
  }
  return { ok: true, deps: normalized };
}

async function setItemDependencies(parentItemId, deps, client = null) {
  const q = client ? client.query.bind(client) : pool.query.bind(pool);
  const v = await validateDependencies(parentItemId, deps, client);
  if (!v.ok) {
    const err = new Error(v.message);
    err.code = v.code;
    throw err;
  }
  await q(`DELETE FROM catalog_item_dependencies WHERE parent_item_id = $1`, [parentItemId]);
  for (const d of v.deps) {
    await q(
      `INSERT INTO catalog_item_dependencies (parent_item_id, child_item_id, qty, sort_order)
       VALUES ($1, $2, $3, $4)`,
      [parentItemId, d.childItemId, d.qty, d.sortOrder]
    );
  }
  return v.deps.length;
}

/**
 * Expande dependencias directas para el modal de presupuesto (sin transitivas).
 * @param {string} rootItemId
 * @param {number} rootQty cantidad del ítem principal
 */
async function resolveDependencyBundle(rootItemId, rootQty = 1, client = null) {
  const q = client ? client.query.bind(client) : pool.query.bind(pool);
  const qtyMain = Math.max(0.001, Number(rootQty) || 1);

  const { rows: rootRows } = await q(`SELECT * FROM catalog_items WHERE id = $1 AND active = true`, [rootItemId]);
  if (!rootRows[0]) {
    return null;
  }
  const root = rootRows[0];

  const deps = await fetchDirectDependencies(rootItemId, client);

  const lines = [
    {
      catalogItemId: rootItemId,
      codigo: root.codigo,
      descripcion: root.descripcion,
      unidad: root.unidad,
      tipo: root.tipo,
      unitPrice: Number(root.unit_price),
      qty: qtyMain,
      isMain: true,
      included: true,
    },
  ];

  for (const dep of deps) {
    if (dep.childItemId === rootItemId) continue;
    const child = dep.child;
    if (!child || child.active === false) continue;
    const perMain = Number(dep.qty) || 1;
    lines.push({
      catalogItemId: dep.childItemId,
      codigo: child.codigo || '',
      descripcion: child.descripcion || '',
      unidad: child.unidad || 'UND',
      tipo: child.tipo || 'ACTIVO',
      unitPrice: child.unitPrice != null ? Number(child.unitPrice) : 0,
      qty: Math.round(perMain * qtyMain * 1000) / 1000,
      qtyPerMain: perMain,
      isMain: false,
      included: false,
    });
  }

  return {
    mainItemId: rootItemId,
    mainQty: qtyMain,
    dependencyCount: lines.length - 1,
    lines,
  };
}

module.exports = {
  fetchDirectDependencies,
  wouldCreateCycle,
  validateDependencies,
  setItemDependencies,
  resolveDependencyBundle,
};
