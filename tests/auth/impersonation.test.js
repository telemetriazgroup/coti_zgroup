const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { runWithRequestContext, resolveAuditActorId } = require('../../server/lib/requestContext');

describe('virtualización — auditoría a nombre del superadmin', () => {
  it('sin contexto usa el actor explícito', () => {
    assert.equal(resolveAuditActorId('user-1'), 'user-1');
  });

  it('con impersonatorId ignora el id efectivo', () => {
    runWithRequestContext({ effectiveUserId: 'comercial', impersonatorId: 'super' }, () => {
      assert.equal(resolveAuditActorId('comercial'), 'super');
    });
  });
});
