/**
 * ZGROUP — Auth Module
 * Manejo de sesión: login, logout, estado de usuario, broadcast entre tabs.
 */

const AUTH = (() => {
  let _user = null;

  // ── BroadcastChannel para sincronizar entre pestañas ───────────
  const _bc = (typeof BroadcastChannel !== 'undefined')
    ? new BroadcastChannel('zgroup_auth')
    : null;

  if (_bc) {
    _bc.onmessage = (e) => {
      if (e.data?.type === 'LOGOUT') {
        _handleLoggedOut(false); // no re-broadcast
      }
    };
  }

  function setUser(user) { _user = user; }
  function getUser()     { return _user; }
  function isLoggedIn()  { return !!_user; }

  /**
   * Intenta restaurar la sesión al cargar la app.
   * Llama a /api/auth/refresh usando la cookie httpOnly.
   * @returns {boolean} - true si se pudo restaurar
   */
  async function restoreSession() {
    try {
      const data = await API.request('/api/auth/refresh', { method: 'POST', credentials: 'include' });
      API.setToken(data.accessToken);
      _user = data.user;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Login con email y password.
   * @returns {{ user, accessToken }} o lanza error
   */
  async function login(email, password) {
    const data = await API.post('/api/auth/login', { email, password });
    API.setToken(data.accessToken);
    _user = data.user;
    return data;
  }

  /**
   * Cierra sesión: revoca el refresh token en el servidor y limpia estado local.
   */
  async function logout(reason = null) {
    try {
      if (API.getToken()) {
        await API.post('/api/auth/logout', {});
      }
    } catch { /* ignorar errores de red en logout */ }

    _handleLoggedOut(true, reason);
  }

  function _handleLoggedOut(broadcast = true, reason = null) {
    API.clearToken();
    _user = null;

    if (broadcast && _bc) {
      _bc.postMessage({ type: 'LOGOUT' });
    }

    const url = reason ? `/login.html?reason=${reason}` : '/login.html';
    window.location.href = url;
  }

  /**
   * Verifica si el usuario tiene uno de los roles dados.
   * @param {...string} roles
   */
  function hasRole(...roles) {
    return _user && roles.includes(_user.role);
  }

  return {
    setUser,
    getUser,
    isLoggedIn,
    hasRole,
    restoreSession,
    login,
    logout,
  };
})();
