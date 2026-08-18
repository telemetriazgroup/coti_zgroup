const assert = require('node:assert');
const { hashPayload, diffBudgetPayloads } = require('../../server/lib/budgetRevisionDiff');

describe('budget revisions — diff tipo git', () => {
  const item = (id, extra = {}) => ({
    id,
    codigo: extra.codigo || 'TE-001',
    descripcion: extra.descripcion || 'Evaporador',
    unidad: 'UND',
    tipo: 'ACTIVO',
    unitPrice: extra.unitPrice ?? 100,
    qty: extra.qty ?? 1,
    applyAdjustment: true,
    isCustom: false,
    ...extra,
  });

  it('hash estable si el contenido es el mismo (aunque cambie el orden)', () => {
    const a = { items: [item('b'), item('a')], bundles: [], financeParams: { x: 1 } };
    const b = { items: [item('a'), item('b')], bundles: [], financeParams: { x: 1 } };
    assert.strictEqual(hashPayload(a), hashPayload(b));
  });

  it('hash cambia si se borra o altera una línea', () => {
    const full = { items: [item('a'), item('b')], bundles: [] };
    const minus = { items: [item('a')], bundles: [] };
    const qty = { items: [item('a'), item('b', { qty: 3 })], bundles: [] };
    assert.notStrictEqual(hashPayload(full), hashPayload(minus));
    assert.notStrictEqual(hashPayload(full), hashPayload(qty));
  });

  it('diff detecta altas, bajas y cambios de cantidad/precio', () => {
    const prev = {
      items: [item('keep'), item('gone', { descripcion: 'Quitar' }), item('chg', { qty: 1, unitPrice: 10 })],
      bundles: [],
    };
    const next = {
      items: [item('keep'), item('new', { descripcion: 'Nuevo' }), item('chg', { qty: 4, unitPrice: 10 })],
      bundles: [],
    };
    const d = diffBudgetPayloads(prev, next);
    assert.deepStrictEqual(d.items.added.map((x) => x.id), ['new']);
    assert.deepStrictEqual(d.items.removed.map((x) => x.id), ['gone']);
    assert.strictEqual(d.items.changed.length, 1);
    assert.strictEqual(d.items.changed[0].id, 'chg');
    assert.ok(d.items.changed[0].fields.some((f) => f.key === 'qty'));
    assert.strictEqual(d.addedCount, 1);
    assert.strictEqual(d.removedCount, 1);
    assert.strictEqual(d.changedCount, 1);
  });
});
