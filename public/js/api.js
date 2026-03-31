/**
 * ZGROUP — API Client
 * Fetch wrapper con interceptor de refresh automático de token.
 */

const API = (() => {
  let _accessToken = null;
  let _refreshPromise = null;

  function setToken(token) { _accessToken = token; }
  function clearToken()    { _accessToken = null; }
  function getToken()      { return _accessToken; }

  /**
   * Refresca el access token usando el refresh httpOnly cookie.
   * Singleton: si ya hay un refresh en curso, devuelve la misma promesa.
   */
  async function refresh() {
    if (_refreshPromise) return _refreshPromise;

    _refreshPromise = fetch('/api/auth/refresh', {
      method:      'POST',
      credentials: 'include',
    })
    .then(async (res) => {
      _refreshPromise = null;
      if (!res.ok) {
        // Refresh token inválido/expirado → logout
        AUTH.logout('session_expired');
        throw new Error('Session expired');
      }
      const json = await res.json();
      if (json.success) {
        _accessToken = json.data.accessToken;
        // Actualizar datos del usuario en memoria
        AUTH.setUser(json.data.user);
        return json.data.accessToken;
      }
      AUTH.logout('session_expired');
      throw new Error('Session expired');
    })
    .catch((err) => {
      _refreshPromise = null;
      throw err;
    });

    return _refreshPromise;
  }

  /**
   * Petición HTTP autenticada con reintento automático al 401.
   *
   * @param {string} url
   * @param {RequestInit} options
   * @returns {Promise<any>} - JSON data del campo `data`
   */
  async function request(url, options = {}) {
    const makeReq = (token) =>
      fetch(url, {
        ...options,
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });

    let res = await makeReq(_accessToken);

    // 401 TOKEN_EXPIRED → intentar refresh y reintentar una vez
    if (res.status === 401) {
      const body = await res.clone().json().catch(() => ({}));
      if (body?.error?.code === 'TOKEN_EXPIRED') {
        try {
          const newToken = await refresh();
          res = await makeReq(newToken);
        } catch {
          throw new Error('SESSION_EXPIRED');
        }
      }
    }

    const json = await res.json();

    if (!res.ok || !json.success) {
      const error = new Error(json?.error?.message || `HTTP ${res.status}`);
      error.code   = json?.error?.code || 'API_ERROR';
      error.status = res.status;
      throw error;
    }

    return json.data;
  }

  // ── Métodos HTTP de conveniencia ──────────────────────────────
  const get    = (url, opts = {})  => request(url, { ...opts, method: 'GET' });
  const post   = (url, body, opts) => request(url, { ...opts, method: 'POST',  body: JSON.stringify(body) });
  const put    = (url, body, opts) => request(url, { ...opts, method: 'PUT',   body: JSON.stringify(body) });
  const del    = (url, opts = {})  => request(url, { ...opts, method: 'DELETE' });

  return { get, post, put, del, setToken, clearToken, getToken, refresh };
})();
