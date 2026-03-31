/**
 * Caché Redis del catálogo (TTL 24h). Sin REDIS_URL no hace nada.
 */
const TTL_SEC = 24 * 60 * 60;
const KEY_ACT = 'catalog:v1:snapshot:act';
const KEY_ALL = 'catalog:v1:snapshot:all';

let client = null;
let connectFailed = false;

async function getClient() {
  const url = process.env.REDIS_URL;
  if (!url || connectFailed) return null;
  if (client) return client;
  try {
    let createClient;
    try {
      ({ createClient } = require('redis'));
    } catch {
      console.warn('[Redis] Paquete redis no instalado. Ejecuta: npm install');
      connectFailed = true;
      return null;
    }
    client = createClient({ url });
    client.on('error', (err) => console.error('[Redis]', err.message));
    await client.connect();
    return client;
  } catch (err) {
    connectFailed = true;
    console.warn('[Redis] No disponible, catálogo sin caché:', err.message);
    return null;
  }
}

async function getCached(includeInactive) {
  const r = await getClient();
  if (!r) return null;
  const key = includeInactive ? KEY_ALL : KEY_ACT;
  try {
    const raw = await r.get(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.error('[Redis] get catalog:', e.message);
    return null;
  }
}

async function setCached(includeInactive, payload) {
  const r = await getClient();
  if (!r) return;
  const key = includeInactive ? KEY_ALL : KEY_ACT;
  try {
    await r.set(key, JSON.stringify(payload), { EX: TTL_SEC });
  } catch (e) {
    console.error('[Redis] set catalog:', e.message);
  }
}

async function invalidateCatalogCache() {
  const r = await getClient();
  if (!r) return;
  try {
    await r.del([KEY_ACT, KEY_ALL]);
  } catch (e) {
    console.error('[Redis] invalidate catalog:', e.message);
  }
}

module.exports = {
  getCached,
  setCached,
  invalidateCatalogCache,
};
