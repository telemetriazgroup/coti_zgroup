const assert = require('node:assert');
const {
  vatDigits,
  isPeruRuc,
  ilikeContains,
  isEligibleCompany,
  partnerDisplayTags,
  addressFromRaw,
  isCompanyLike,
} = require('../../server/lib/odoo/partnerEligibility');

describe('odoo partnerEligibility (etapa 4)', () => {
  const CLIENTE = 3;

  it('normaliza RUC y detecta 11 dígitos', () => {
    assert.strictEqual(vatDigits('20123456789'), '20123456789');
    assert.strictEqual(vatDigits('20-12345678-9'), '20123456789');
    assert.strictEqual(isPeruRuc('20123456789'), true);
    assert.strictEqual(isPeruRuc('12345678'), false);
  });

  it('escapa comodines ILIKE', () => {
    assert.strictEqual(ilikeContains('100%'), '%100%');
    assert.strictEqual(ilikeContains('a_b'), '%a b%');
  });

  it('prioridad tag Cliente; respaldo customer_rank', () => {
    assert.strictEqual(
      isEligibleCompany(
        { active: true, isCompany: true, categoryIds: [3], customerRank: 0, supplierRank: 0 },
        CLIENTE
      ),
      true
    );
    assert.strictEqual(
      isEligibleCompany(
        { active: true, isCompany: true, categoryIds: [], customerRank: 2, supplierRank: 0 },
        CLIENTE
      ),
      true
    );
  });

  it('excluye proveedor puro y archivados', () => {
    assert.strictEqual(
      isEligibleCompany(
        { active: true, isCompany: true, categoryIds: [], customerRank: 0, supplierRank: 1 },
        CLIENTE
      ),
      false
    );
    assert.strictEqual(
      isEligibleCompany(
        { active: false, isCompany: true, categoryIds: [3], customerRank: 1, supplierRank: 0 },
        CLIENTE
      ),
      false
    );
    assert.strictEqual(
      isEligibleCompany(
        { active: true, isCompany: true, categoryIds: [3], customerRank: 0, supplierRank: 5, syncStatus: 'borrado_en_odoo' },
        CLIENTE
      ),
      false
    );
  });

  it('persona hija no es empresa; standalone sí', () => {
    assert.strictEqual(
      isCompanyLike({ isCompany: false, parentOdooId: 10 }),
      false
    );
    assert.strictEqual(
      isEligibleCompany(
        { active: true, isCompany: false, parentOdooId: null, categoryIds: [], customerRank: 1, supplierRank: 0 },
        CLIENTE
      ),
      true
    );
  });

  it('tags visuales Cliente/Proveedor/Contacto', () => {
    const tags = partnerDisplayTags(
      { isCompany: false, parentOdooId: 1, categoryIds: [3, 5] },
      { cliente: 3, proveedor: 4, contacto: 5 }
    );
    assert.deepStrictEqual(tags, ['cliente', 'contacto']);
  });

  it('dirección desde raw Odoo (False → null)', () => {
    assert.strictEqual(addressFromRaw({ street: 'Av. 1', street2: false }), 'Av. 1');
    assert.strictEqual(addressFromRaw({ street: false, street2: false }), null);
  });
});
