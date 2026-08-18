const assert = require('node:assert');
const {
  normalizePartner,
  normalizeMany2one,
  odooDatetimeToIso,
  matchCategoryIds,
} = require('../../server/lib/odoo/normalizePartner');
const { DEFAULT_CATEGORY_LABELS } = require('../../server/lib/odoo/partnerFields');

describe('odoo normalizePartner', () => {
  it('False de Odoo → null (email, parent); 0 no es vacío', () => {
    const n = normalizePartner({
      id: 10,
      name: 'CALLUPE & ANTARA TRANSPORT S.A.C.',
      display_name: 'CALLUPE & ANTARA TRANSPORT S.A.C.',
      email: false,
      parent_id: false,
      phone: false,
      vat: '20123456789',
      is_company: true,
      active: true,
      customer_rank: 0,
      supplier_rank: false,
      category_id: [4],
      write_date: '2026-08-18 14:03:22',
      create_date: '2026-01-01 00:00:00',
    });
    assert.strictEqual(n.email, null);
    assert.strictEqual(n.parent, null);
    assert.strictEqual(n.phone, null);
    assert.strictEqual(n.vat, '20123456789');
    assert.strictEqual(n.customerRank, 0);
    assert.strictEqual(n.supplierRank, 0);
    assert.strictEqual(n.writeDate, '2026-08-18T14:03:22Z');
    assert.deepStrictEqual(n.categoryIds, [4]);
  });

  it('many2one [id, name] y contacto hijo', () => {
    assert.deepStrictEqual(normalizeMany2one([42, 'CERVECERIA DEL VALLE S.A.C.']), {
      id: 42,
      name: 'CERVECERIA DEL VALLE S.A.C.',
    });
    const n = normalizePartner({
      id: 99,
      name: 'Harold Flores',
      is_company: false,
      parent_id: [42, 'CERVECERIA DEL VALLE S.A.C.'],
      email: 'h@example.com',
      category_id: false,
      user_id: false,
      active: true,
    });
    assert.strictEqual(n.isCompany, false);
    assert.deepStrictEqual(n.parent, { id: 42, name: 'CERVECERIA DEL VALLE S.A.C.' });
    assert.deepStrictEqual(n.categoryIds, []);
  });

  it('datetime naive UTC', () => {
    assert.strictEqual(odooDatetimeToIso(false), null);
    assert.strictEqual(odooDatetimeToIso('2026-08-18 14:03:22'), '2026-08-18T14:03:22Z');
  });

  it('resuelve ids de etiquetas Cliente / Proveedor / Contacto', () => {
    const found = matchCategoryIds(
      [
        { id: 4, name: 'Cliente' },
        { id: 5, name: 'Proveedor' },
        { id: 6, name: 'Contacto' },
      ],
      DEFAULT_CATEGORY_LABELS
    );
    assert.strictEqual(found.cliente.id, 4);
    assert.strictEqual(found.proveedor.id, 5);
    assert.strictEqual(found.contacto.id, 6);
  });
});
