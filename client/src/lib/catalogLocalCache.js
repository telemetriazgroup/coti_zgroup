const KEY = 'zgroup_catalog_snapshot_v1';
const STALE_MS = 24 * 60 * 60 * 1000;

export function getLocalCatalog() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts > STALE_MS) return null;
    return data;
  } catch {
    return null;
  }
}

export function setLocalCatalog(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ data, ts: Date.now() }));
  } catch {
    /* quota / privado */
  }
}
