const { describe, it } = require('node:test');
const assert = require('node:assert');
const { canChangeUserEmail } = require('../../server/utils/userRoles');
const { allowedCreateRoles, canCreateRole } = require('../../server/lib/userCreation');
const {
  buildDefaultPassword,
  isTemporaryPassword,
  TEMPORARY_PASSWORD,
  MIN_PASSWORD_LENGTH,
  isValidPasswordLength,
} = require('../../server/lib/defaultPassword');
const { normalizeUserEmail, isValidUserEmail } = require('../../server/lib/userEmail');

describe('correo y clave temporal', () => {
  it('solo ADMIN y SUPERUSER cambian el correo', () => {
    assert.strictEqual(canChangeUserEmail({ role: 'SUPERUSER' }), true);
    assert.strictEqual(canChangeUserEmail({ role: 'ADMIN' }), true);
    assert.strictEqual(canChangeUserEmail({ role: 'SEMIADMIN' }), false);
    assert.strictEqual(canChangeUserEmail({ role: 'COMERCIAL' }), false);
    assert.strictEqual(canChangeUserEmail({ role: 'VIEWER' }), false);
  });

  it('acepta contraseñas de mínimo 6 caracteres', () => {
    assert.strictEqual(MIN_PASSWORD_LENGTH, 6);
    assert.strictEqual(isValidPasswordLength('12345'), false);
    assert.strictEqual(isValidPasswordLength('123456'), true);
  });

  it('el reinicio usa 123456789 y se detecta como temporal', () => {
    assert.strictEqual(TEMPORARY_PASSWORD, '123456789');
    assert.strictEqual(buildDefaultPassword('alguien@zgroup.pe'), '123456789');
    assert.strictEqual(isTemporaryPassword('123456789'), true);
    assert.strictEqual(isTemporaryPassword('otraClave'), false);
  });

  it('ADMIN crea ADMIN, SEMIADMIN y COMERCIAL; no crea SUPERUSER', () => {
    assert.deepStrictEqual(allowedCreateRoles('ADMIN'), ['ADMIN', 'SEMIADMIN', 'COMERCIAL', 'VIEWER']);
    assert.strictEqual(canCreateRole('ADMIN', 'ADMIN'), true);
    assert.strictEqual(canCreateRole('ADMIN', 'SEMIADMIN'), true);
    assert.strictEqual(canCreateRole('ADMIN', 'COMERCIAL'), true);
    assert.strictEqual(canCreateRole('ADMIN', 'SUPERUSER'), false);
    assert.strictEqual(canCreateRole('SEMIADMIN', 'ADMIN'), false);
  });

  it('normaliza email y rechaza duplicados inválidos', () => {
    assert.strictEqual(normalizeUserEmail('  Ana@Zgroup.pe '), 'ana@zgroup.pe');
    assert.strictEqual(isValidUserEmail('ana@zgroup.pe'), true);
    assert.strictEqual(isValidUserEmail('no-es-correo'), false);
    assert.strictEqual(isValidUserEmail(''), false);
  });
});
