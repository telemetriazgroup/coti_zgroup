/**
 * Cliente XML-RPC Odoo 17: timeouts, 1 llamada a la vez, circuit breaker.
 */

const http = require('http');
const https = require('https');
const { encodeMethodCall, decodeMethodResponse, XmlrpcFault } = require('./xmlrpcCodec');
const { loadOdooConfig, isOdooConfigured, xmlrpcEndpoint } = require('./config');
const { CircuitBreaker } = require('./circuitBreaker');

class SerialQueue {
  constructor() {
    this.tail = Promise.resolve();
  }

  run(fn) {
    const next = this.tail.then(fn, fn);
    this.tail = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }
}

function postXml(urlStr, xmlBody, { timeoutMs, tlsInsecure }) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === 'https:' ? https : http;
    const payload = Buffer.from(xmlBody, 'utf8');
    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: `${u.pathname}${u.search}`,
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml',
          'Content-Length': payload.length,
          Accept: 'text/xml',
          'User-Agent': 'zgroup-cotizaciones-odoo-probe/0.1',
        },
        timeout: timeoutMs,
        rejectUnauthorized: !tlsInsecure,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode < 200 || res.statusCode >= 300) {
            const err = new Error(`HTTP ${res.statusCode} en ${u.pathname}`);
            err.statusCode = res.statusCode;
            err.body = body.slice(0, 500);
            reject(err);
            return;
          }
          resolve(body);
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Timeout XML-RPC (${timeoutMs}ms) ${u.pathname}`));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function createOdooClient(overrides = {}) {
  const cfg = { ...loadOdooConfig(), ...overrides };
  const queue = new SerialQueue();
  const breaker = new CircuitBreaker({
    failureThreshold: cfg.failureThreshold,
    cooldownMs: cfg.cooldownMs,
  });

  async function call(kind, method, params) {
    breaker.assertClosed();
    return queue.run(async () => {
      const started = Date.now();
      try {
        const xml = encodeMethodCall(method, params);
        const body = await postXml(xmlrpcEndpoint(cfg, kind), xml, {
          timeoutMs: cfg.timeoutMs,
          tlsInsecure: cfg.tlsInsecure,
        });
        const result = decodeMethodResponse(body);
        breaker.recordSuccess();
        return { result, elapsedMs: Date.now() - started };
      } catch (err) {
        breaker.recordFailure(err);
        throw err;
      }
    });
  }

  async function version() {
    const { result, elapsedMs } = await call('common', 'version', []);
    return { version: result, elapsedMs };
  }

  async function authenticate() {
    if (!isOdooConfigured(cfg)) {
      throw new Error('Odoo no configurado (ODOO_URL, ODOO_DB, ODOO_USER, ODOO_API_KEY)');
    }
    const { result, elapsedMs } = await call('common', 'authenticate', [
      cfg.db,
      cfg.user,
      cfg.apiKey,
      {},
    ]);
    if (result === false || result === 0 || result == null) {
      const err = new XmlrpcFault(0, 'authenticate devolvió false (usuario, DB o API key incorrectos)');
      err.odooErrorKind = 'AccessError';
      throw err;
    }
    return { uid: Number(result), elapsedMs };
  }

  async function executeKw(uid, model, method, args = [], kwargs = {}) {
    const params = [cfg.db, uid, cfg.apiKey, model, method, args];
    if (kwargs && Object.keys(kwargs).length > 0) {
      params.push(kwargs);
    }
    const { result, elapsedMs } = await call('object', 'execute_kw', params);
    return { result, elapsedMs };
  }

  return {
    cfg,
    breaker,
    version,
    authenticate,
    executeKw,
    circuitSnapshot: () => breaker.snapshot(),
  };
}

module.exports = { createOdooClient, SerialQueue };
