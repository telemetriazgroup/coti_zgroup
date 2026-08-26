const assert = require('node:assert');
const { ALLOWED_KINDS } = require('../../server/lib/userActivity');

describe('user activity kinds', () => {
  it('incluye login, presupuesto y lista de proyectos', () => {
    assert.ok(ALLOWED_KINDS.has('LOGIN'));
    assert.ok(ALLOWED_KINDS.has('PRESUPUESTO'));
    assert.ok(ALLOWED_KINDS.has('LISTA_PROYECTOS'));
    assert.ok(!ALLOWED_KINDS.has('HACK'));
  });
});
