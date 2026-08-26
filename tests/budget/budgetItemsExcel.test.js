const assert = require('node:assert');
const { partitionImportItems, mapBudgetImportHeader } = require('../../server/lib/budgetItemsExcel');

describe('import líneas — Kit / Zona / Rol', () => {
  it('reconoce encabezados de zona, kit y rol', () => {
    assert.strictEqual(mapBudgetImportHeader('Zona'), 'zona');
    assert.strictEqual(mapBudgetImportHeader('Kit'), 'kit');
    assert.strictEqual(mapBudgetImportHeader('Rol'), 'rol');
    assert.strictEqual(mapBudgetImportHeader('Código'), 'codigo');
  });

  it('arma un conjunto por kit+zona y deja líneas sueltas aparte', () => {
    const { stand, kitGroups } = partitionImportItems([
      { catalogItemId: 'pf1', qty: 1, kit: 'PF-0001', zona: 'DENSIFER ROOM', rol: 'KIT' },
      { catalogItemId: 'te', qty: 4, kit: 'PF-0001', zona: 'DENSIFER ROOM', rol: 'COMPONENTE' },
      { catalogItemId: 'pf2', qty: 1, kit: 'PF-0002', zona: 'DRY STORAGE', rol: 'KIT' },
      { catalogItemId: 'ac', qty: 1, kit: 'PF-0002', zona: 'DRY STORAGE', rol: 'COMPONENTE' },
      { catalogItemId: 'solo', qty: 2, rol: 'LINEA' },
    ]);
    assert.strictEqual(stand.length, 1);
    assert.strictEqual(stand[0].catalogItemId, 'solo');
    assert.strictEqual(kitGroups.length, 2);
    const dens = kitGroups.find((g) => g.zona === 'DENSIFER ROOM');
    assert.ok(dens);
    assert.strictEqual(dens.header.catalogItemId, 'pf1');
    assert.strictEqual(dens.comps.length, 1);
    assert.strictEqual(dens.comps[0].catalogItemId, 'te');
  });

  it('sin columnas Kit/Zona/Rol no agrupa (import plano)', () => {
    const { stand, kitGroups } = partitionImportItems([
      { catalogItemId: 'a', qty: 1 },
      { catalogItemId: 'b', qty: 2 },
    ]);
    assert.strictEqual(stand.length, 2);
    assert.strictEqual(kitGroups.length, 0);
  });
});
