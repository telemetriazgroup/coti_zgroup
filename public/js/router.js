/**
 * ZGROUP — Hash Router
 * Enruta las vistas según el hash de la URL (#/dashboard, #/projects, etc.)
 */

const ROUTER = (() => {
  const _routes = [];
  let _default   = null;

  /**
   * Registra una ruta.
   * @param {string|RegExp} pattern  - ej: '#/projects' o /^#\/projects\/(.+)/
   * @param {Function}      handler  - async (params) => void
   * @param {string[]}      [roles]  - roles permitidos (vacío = todos autenticados)
   */
  function on(pattern, handler, roles = []) {
    _routes.push({ pattern, handler, roles });
    return ROUTER;
  }

  /**
   * Ruta por defecto (404 o redirect inicial).
   */
  function otherwise(handler) {
    _default = handler;
    return ROUTER;
  }

  /**
   * Inicia el router: escucha hashchange y resuelve la ruta actual.
   */
  function start() {
    window.addEventListener('hashchange', _resolve);
    _resolve();
  }

  /**
   * Navega a una nueva ruta.
   * @param {string} hash - ej: '#/projects'
   */
  function navigate(hash) {
    window.location.hash = hash;
  }

  function _resolve() {
    const hash = window.location.hash || '#/';
    const user = AUTH.getUser();

    for (const route of _routes) {
      let match;
      if (typeof route.pattern === 'string') {
        if (hash !== route.pattern) continue;
        match = [];
      } else {
        const result = hash.match(route.pattern);
        if (!result) continue;
        match = result.slice(1);
      }

      // Verificar rol si la ruta tiene restricción
      if (route.roles.length > 0 && !AUTH.hasRole(...route.roles)) {
        navigate('#/403');
        return;
      }

      route.handler(match);
      return;
    }

    // Ninguna ruta coincidió
    if (_default) _default(hash);
  }

  return { on, otherwise, start, navigate };
})();
