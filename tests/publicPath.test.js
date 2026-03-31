/**
 * Ruta pública bajo proxy (Sprint 7).
 */
const assert = require('node:assert');
const { normalizePublicBasePath } = require('../server/lib/publicPath.js');

describe('publicPath', () => {
  it('vacío = raíz', () => {
    assert.strictEqual(normalizePublicBasePath(''), '');
    assert.strictEqual(normalizePublicBasePath('   '), '');
  });

  it('normaliza barra inicial y final', () => {
    assert.strictEqual(normalizePublicBasePath('coti_zgroup'), '/coti_zgroup');
    assert.strictEqual(normalizePublicBasePath('/coti_zgroup/'), '/coti_zgroup');
  });
});
