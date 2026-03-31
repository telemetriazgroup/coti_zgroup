import { api } from './api';
import { getLocalCatalog, setLocalCatalog } from './catalogLocalCache';

/**
 * Catálogo completo. Persiste en localStorage al tener éxito; si la API falla, usa caché local (24h).
 * @returns {{ data: { categories, items }, fromCache: boolean }}
 */
export async function fetchCatalog(includeInactive) {
  const qs = includeInactive ? '?includeInactive=true' : '';
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
