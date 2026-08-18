const assert = require('node:assert');
const {
  SYNC_ORIGIN,
  SYNC_STATUS,
  mapOdooPartnerRow,
  mapSyncStateRow,
} = require('../../server/lib/odoo/syncStatus');

describe('odoo syncStatus (etapa 2)', () => {
  it('mapea fila de caché y estado', () => {
    const p = mapOdooPartnerRow({
      odoo_id: 1,
      name: 'ZGROUP S.A.C.',
      is_company: true,
      category_ids: [3],
      customer_rank: 1,
      active: true,
      sync_status: SYNC_STATUS.SINCRONIZADO,
    });
    assert.strictEqual(p.odooId, 1);
    assert.strictEqual(p.isCompany, true);
    assert.deepStrictEqual(p.categoryIds, [3]);
    assert.strictEqual(p.syncStatus, 'sincronizado');

    const st = mapSyncStateRow({
      model: 'res.partner',
      category_cliente_id: 3,
      category_proveedor_id: 4,
      category_contacto_id: 5,
      created_n: '0',
    });
    assert.strictEqual(st.categoryClienteId, 3);
    assert.strictEqual(st.createdN, 0);
  });

  it('origen local por defecto para CRM actual', () => {
    assert.strictEqual(SYNC_ORIGIN.LOCAL, 'local');
  });
});
