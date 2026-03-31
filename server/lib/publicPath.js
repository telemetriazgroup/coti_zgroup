/**
 * Ruta bajo la que se publica la app (proxy inverso), p. ej. /coti_zgroup
 * Sin barra final. Vacío = raíz del host (http://IP:3000/).
 */
function normalizePublicBasePath(raw) {
  const s = (raw || '').trim();
  if (!s) return '';
  const withSlash = s.startsWith('/') ? s : `/${s}`;
  return withSlash.replace(/\/+$/, '') || '';
}

module.exports = { normalizePublicBasePath };
