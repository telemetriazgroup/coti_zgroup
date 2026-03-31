/**
 * Cliente API — fetch con refresh; emite zgroup:session-expired si el refresh falla.
 */
let accessToken = null;
let refreshPromise = null;

export function setToken(t) {
  accessToken = t;
}
export function clearToken() {
  accessToken = null;
}
export function getToken() {
  return accessToken;
}

function emitSessionExpired() {
  window.dispatchEvent(new CustomEvent('zgroup:session-expired'));
}

async function refresh() {
  if (refreshPromise) return refreshPromise;

  refreshPromise = fetch('/api/auth/refresh', {
    method: 'POST',
    credentials: 'include',
  })
    .then(async (res) => {
      refreshPromise = null;
      if (!res.ok) {
        emitSessionExpired();
        throw new Error('Session expired');
      }
      const json = await res.json();
      if (json.success) {
        accessToken = json.data.accessToken;
        window.dispatchEvent(
          new CustomEvent('zgroup:user-updated', { detail: json.data.user })
        );
        return json.data.accessToken;
      }
      emitSessionExpired();
      throw new Error('Session expired');
    })
    .catch((err) => {
      refreshPromise = null;
      throw err;
    });

  return refreshPromise;
}

export async function request(url, options = {}) {
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

  let res = await makeReq(accessToken);

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
    error.code = json?.error?.code || 'API_ERROR';
    error.status = res.status;
    throw error;
  }

  return json.data;
}

export const api = {
  get: (url, opts = {}) => request(url, { ...opts, method: 'GET' }),
  post: (url, body, opts = {}) =>
    request(url, { ...opts, method: 'POST', body: JSON.stringify(body) }),
  put: (url, body, opts = {}) =>
    request(url, { ...opts, method: 'PUT', body: JSON.stringify(body) }),
  patch: (url, body, opts = {}) =>
    request(url, { ...opts, method: 'PATCH', body: JSON.stringify(body) }),
  del: (url, opts = {}) => request(url, { ...opts, method: 'DELETE' }),
};
