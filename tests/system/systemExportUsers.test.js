const assert = require('node:assert');
const { planUserImport, remapUserId } = require('../../server/lib/systemExportUsers');

describe('import sistema — conservar SUPERUSER', () => {
  const localSu = { id: 'su-local', email: 'zgroup@zgroup.pe' };

  it('omite SUPERUSER del dump y remapea su id al local', () => {
    const dump = [
      { id: 'su-dump', email: 'zgroup@zgroup.pe', role: 'SUPERUSER' },
      { id: 'c1', email: 'comercial@zgroup.pe', role: 'COMERCIAL' },
    ];
    const { userIdMap, toInsert } = planUserImport(dump, [localSu], 'su-local');
    assert.strictEqual(toInsert.length, 1);
    assert.strictEqual(toInsert[0].id, 'c1');
    assert.strictEqual(userIdMap.get('su-dump'), 'su-local');
    assert.strictEqual(remapUserId('su-dump', userIdMap), 'su-local');
    assert.strictEqual(remapUserId('c1', userIdMap), 'c1');
  });

  it('omite dump cuyo email coincide con el SUPERUSER local aunque no sea rol SUPERUSER', () => {
    const dump = [{ id: 'other', email: 'ZGROUP@zgroup.pe', role: 'ADMIN' }];
    const { toInsert, userIdMap } = planUserImport(dump, [localSu], 'su-local');
    assert.strictEqual(toInsert.length, 0);
    assert.strictEqual(userIdMap.get('other'), 'su-local');
  });
});
