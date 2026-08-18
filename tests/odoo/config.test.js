const assert = require('node:assert');
const { CircuitBreaker, CircuitOpenError } = require('../../server/lib/odoo/circuitBreaker');
const { loadOdooConfig, isOdooConfigured, normalizeOdooBaseUrl } = require('../../server/lib/odoo/config');

describe('odoo circuitBreaker + config', () => {
  it('abre tras N fallos y se cierra al pasar el cooldown', () => {
    let now = 1_000;
    const b = new CircuitBreaker({
      failureThreshold: 3,
      cooldownMs: 10_000,
      now: () => now,
    });
    b.recordFailure(new Error('a'));
    b.recordFailure(new Error('b'));
    b.assertClosed();
    b.recordFailure(new Error('c'));
    assert.throws(() => b.assertClosed(), CircuitOpenError);
    now = 12_000;
    b.assertClosed();
    assert.strictEqual(b.snapshot().open, false);
    assert.strictEqual(b.snapshot().failures, 0);
  });

  it('parsea URL con subpath y flag de sync', () => {
    assert.strictEqual(normalizeOdooBaseUrl('https://odoo.example/odoo/'), 'https://odoo.example/odoo');
    const cfg = loadOdooConfig({
      ODOO_URL: 'https://odoo.example',
      ODOO_DB: 'prod',
      ODOO_USER: 'integracion.ztrack',
      ODOO_API_KEY: 'k',
      ODOO_SYNC_ENABLED: '0',
    });
    assert.strictEqual(cfg.syncEnabled, false);
    assert.strictEqual(isOdooConfigured(cfg), true);
  });

  it('isOdooConfigured false si falta key', () => {
    assert.strictEqual(
      isOdooConfigured(
        loadOdooConfig({
          ODOO_URL: 'https://odoo.example',
          ODOO_DB: 'prod',
          ODOO_USER: 'u',
          ODOO_API_KEY: '',
        })
      ),
      false
    );
  });
});
