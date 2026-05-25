import { api } from './api';
import { getLocalCatalog, setLocalCatalog, clearLocalCatalog } from './catalogLocalCache';

/**
 * Catálogo completo. Persiste en localStorage al tener éxito; si la API falla, usa caché local (24h).
 * @param {boolean} includeInactive
 * @param {{ fresh?: boolean }} [opts] - fresh=true fuerza lectura BD (invalida Redis en servidor)
 * @returns {{ data: { categories, items }, fromCache: boolean }}
 */
export async function fetchCatalog(includeInactive, opts = {}) {
  const params = new URLSearchParams();
  if (includeInactive) params.set('includeInactive', 'true');
  if (opts.fresh) params.set('fresh', 'true');
  const qs = params.toString() ? `?${params.toString()}` : '';
  try {
    const data = await api.get(`/api/catalog${qs}`);
    setLocalCatalog(data);
    return { data, fromCache: false };
  } catch (e) {
    const offline = getLocalCatalog();
    if (offline) return { data: offline, fromCache: true };
    throw e;
  }
}
