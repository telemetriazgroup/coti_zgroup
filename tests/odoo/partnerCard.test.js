const assert = require('node:assert');
const { langLabel, mapPartnerFicha } = require('../../server/lib/odoo/partnerCard');

describe('odoo partnerCard (etapa 4.1)', () => {
  it('traduce lang es_PE', () => {
    assert.strictEqual(langLabel('es_PE'), 'Español (PE)');
  });

  it('arma ficha empresa desde raw JSON', () => {
    const f = mapPartnerFicha(
      {
        odoo_id: 10,
        name: 'CERVECERIA DEL VALLE S.A.C.',
        is_company: true,
        vat: '20563806045',
        city: 'Lima',
        category_ids: [3],
        customer_rank: 1,
        supplier_rank: 0,
        active: true,
        raw: {
          id: 10,
          name: 'CERVECERIA DEL VALLE S.A.C.',
          is_company: true,
          vat: '20563806045',
          street: 'PJ. PEDRO SOLARI NRO. 127',
          street2: false,
          city: 'Lima',
          zip: '150104',
          country_id: [173, 'Perú'],
          l10n_latam_identification_type_id: [4, 'RUC'],
          lang: 'es_PE',
          category_id: [3],
        },
      },
      { cliente: 3, proveedor: 4, contacto: 5 }
    );
    assert.strictEqual(f.isCompany, true);
    assert.strictEqual(f.street, 'PJ. PEDRO SOLARI NRO. 127');
    assert.strictEqual(f.identificationType, 'RUC');
    assert.strictEqual(f.country, 'Perú');
    assert.deepStrictEqual(f.tagPills.map((p) => p.name), ['Cliente']);
  });
});
