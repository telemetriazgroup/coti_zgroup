const assert = require('node:assert');
const {
  isValidPeRuc11,
  normalizeVat,
  validatePartnerWrite,
  buildCreateVals,
  buildWriteVals,
  nextAttemptAt,
  shouldRetryFault,
  shouldConsultSunat,
  stubNameFromRuc,
  userMessageFromOdooFault,
  normalizeOdooText,
} = require('../../server/lib/odoo/partnerValidate');


describe('odoo partnerValidate (etapa 5)', () => {
  it('acepta RUC PE con dígito de control', () => {
    assert.strictEqual(isValidPeRuc11('20100000009'), true);
    assert.strictEqual(isValidPeRuc11('20100000000'), false);
    assert.strictEqual(isValidPeRuc11('20123456789'), false);
  });

  it('normaliza vat a dígitos', () => {
    assert.strictEqual(normalizeVat('20.100.000.009'), '20100000009');
    assert.strictEqual(normalizeVat(''), null);
  });

  it('exige razón social y rechaza RUC inválido antes de encolar', () => {
    assert.strictEqual(validatePartnerWrite({ razonSocial: '  ' }).ok, false);
    const bad = validatePartnerWrite({ razonSocial: 'ACME SAC', ruc: '20100000000' });
    assert.strictEqual(bad.ok, false);
    assert.match(bad.errors[0], /RUC/);
    const ok = validatePartnerWrite({
      razonSocial: 'ACME SAC',
      ruc: '20100000009',
      contactoEmail: 'ventas@acme.pe',
    });
    assert.strictEqual(ok.ok, true);
    assert.strictEqual(ok.vat, '20100000009');
    assert.strictEqual(ok.consultarSunat, true);
  });

  it('acepta solo RUC válido y usa nombre temporal para SUNAT', () => {
    const only = validatePartnerWrite({ ruc: '20100000009' });
    assert.strictEqual(only.ok, true);
    assert.strictEqual(only.name, stubNameFromRuc('20100000009'));
    assert.strictEqual(only.consultarSunat, true);
    assert.strictEqual(shouldConsultSunat({ ruc: '20100000009' }), true);
    assert.strictEqual(shouldConsultSunat({ ruc: '20100000009', consultarSunat: false }), false);
  });

  it('arma vals de create con UUID, empresa y etiqueta Cliente', () => {
    const vals = buildCreateVals(
      {
        razonSocial: 'ACME SAC',
        ruc: '20100000009',
        direccion: 'Av. Industrial 100',
        ciudad: 'Lima',
        contactoEmail: 'ventas@acme.pe',
        xZtrackUid: '11111111-1111-4111-8111-111111111111',
      },
      { categoryClienteId: 3, identificationTypeId: 4 }
    );
    assert.strictEqual(vals.name, 'ACME SAC');
    assert.strictEqual(vals.is_company, true);
    assert.strictEqual(vals.company_type, 'company');
    assert.strictEqual(vals.x_ztrack_uid, '11111111-1111-4111-8111-111111111111');
    assert.strictEqual(vals.vat, '20100000009');
    assert.strictEqual(vals.street, 'Av. Industrial 100');
    assert.strictEqual(vals.lang, 'es_PE');
    assert.deepStrictEqual(vals.category_id, [[6, 0, [3]]]);
    assert.strictEqual(vals.l10n_latam_identification_type_id, 4);
  });

  it('write solo manda campos presentes; vacío de RUC va false de Odoo', () => {
    const vals = buildWriteVals({ ciudad: 'Arequipa', ruc: '' });
    assert.strictEqual(vals.city, 'Arequipa');
    assert.strictEqual(vals.vat, false);
    assert.strictEqual(vals.name, undefined);
  });

  it('backoff creciente y ValidationError sin reintento', () => {
    const a = nextAttemptAt(1, Date.parse('2026-08-18T12:00:00Z'));
    const b = nextAttemptAt(4, Date.parse('2026-08-18T12:00:00Z'));
    assert.ok(b.getTime() > a.getTime());
    const hour = nextAttemptAt(8, Date.parse('2026-08-18T12:00:00Z'));
    assert.strictEqual(hour.getTime() - Date.parse('2026-08-18T12:00:00Z'), 600_000);
    assert.strictEqual(shouldRetryFault('ValidationError'), false);
    assert.strictEqual(shouldRetryFault('AccessError'), false);
    assert.strictEqual(shouldRetryFault('timeout'), true);
  });

  it('extrae la excepción útil de un traceback XML-RPC', () => {
    const err = {
      odooErrorKind: 'ValidationError',
      faultString: 'Traceback (most recent call last):\n  File "/odoo/a.py", line 1\n    raise x\nodoo.exceptions.ValidationError: El RUC no es válido\n',
    };
    assert.match(userMessageFromOdooFault(err), /RUC no es válido/);
    assert.doesNotMatch(userMessageFromOdooFault(err), /Traceback/);
  });

  it('normaliza HTML que Odoo pone en comment', () => {
    assert.strictEqual(normalizeOdooText('<p>Prueba de conexion 2</p>'), 'Prueba de conexion 2');
    assert.strictEqual(normalizeOdooText(false), '');
  });
});
