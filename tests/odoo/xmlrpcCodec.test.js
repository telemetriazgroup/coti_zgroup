const assert = require('node:assert');
const {
  encodeMethodCall,
  encodeValue,
  decodeMethodResponse,
  XmlrpcFault,
} = require('../../server/lib/odoo/xmlrpcCodec');

describe('odoo xmlrpcCodec', () => {
  it('roundtrip de tipos Odoo (int, bool, string, array, struct, nil)', () => {
    const xml = encodeMethodCall('execute_kw', [
      'db',
      2,
      'key',
      'res.partner',
      'search_read',
      [[]],
      { fields: ['name', 'email'], limit: 1 },
    ]);
    assert.match(xml, /<methodName>execute_kw<\/methodName>/);
    assert.match(xml, /<int>2<\/int>/);
    assert.match(xml, /<string>res.partner<\/string>/);

    const response =
      `<?xml version="1.0"?>` +
      `<methodResponse><params><param><value><array><data>` +
      `<value><struct>` +
      `<member><name>id</name><value><int>15</int></value></member>` +
      `<member><name>name</name><value><string>ACME S.A.C.</string></value></member>` +
      `<member><name>email</name><value><boolean>0</boolean></value></member>` +
      `<member><name>parent_id</name><value><boolean>0</boolean></value></member>` +
      `<member><name>category_id</name><value><array><data>` +
      `<value><int>4</int></value><value><int>9</int></value>` +
      `</data></array></value></member>` +
      `<member><name>user_id</name><value><array><data>` +
      `<value><int>3</int></value><value><string>Admin</string></value>` +
      `</data></array></value></member>` +
      `</struct></value>` +
      `</data></array></value></param></params></methodResponse>`;

    const decoded = decodeMethodResponse(response);
    assert.strictEqual(decoded[0].id, 15);
    assert.strictEqual(decoded[0].name, 'ACME S.A.C.');
    assert.strictEqual(decoded[0].email, false);
    assert.strictEqual(decoded[0].parent_id, false);
    assert.deepStrictEqual(decoded[0].category_id, [4, 9]);
    assert.deepStrictEqual(decoded[0].user_id, [3, 'Admin']);
  });

  it('decodifica Fault AccessError', () => {
    const xml =
      `<methodResponse><fault><value><struct>` +
      `<member><name>faultCode</name><value><int>1</int></value></member>` +
      `<member><name>faultString</name><value><string>odoo.exceptions.AccessError: Access Denied</string></value></member>` +
      `</struct></value></fault></methodResponse>`;
    assert.throws(
      () => decodeMethodResponse(xml),
      (err) => err instanceof XmlrpcFault && err.odooErrorKind === 'AccessError' && err.faultCode === 1
    );
  });

  it('string implícito dentro de value', () => {
    const xml =
      `<methodResponse><params><param><value>hola</value></param></params></methodResponse>`;
    assert.strictEqual(decodeMethodResponse(xml), 'hola');
  });

  it('escapa XML en encode', () => {
    const xml = encodeValue('a < b & c');
    assert.match(xml, /&lt;/);
    assert.match(xml, /&amp;/);
  });
});
