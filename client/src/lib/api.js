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

export async function getBlob(url) {
  const makeReq = (token) =>
    fetch(url, {
      credentials: 'include',
      headers: {
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
    } else {
      throw new Error('SESSION_EXPIRED');
    }
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `HTTP ${res.status}`);
  }
  return res.blob();
}

export async function postFormData(url, formData) {
  const makeReq = (token) =>
    fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: formData,
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
    } else {
      throw new Error('SESSION_EXPIRED');
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

/**
 * Subida multipart con progreso (0–1). No hace refresh de token en 401 (flujo simple).
 */
export function postFormDataWithProgress(url, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.withCredentials = true;
    if (accessToken) xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      let json;
      try {
        json = JSON.parse(xhr.responseText || '{}');
      } catch {
        reject(new Error('Respuesta inválida'));
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300 && json.success) {
        resolve(json.data);
        return;
      }
      const err = new Error(json?.error?.message || `HTTP ${xhr.status}`);
      err.code = json?.error?.code;
      err.status = xhr.status;
      reject(err);
    };
    xhr.onerror = () => reject(new Error('Error de red'));
    xhr.send(formData);
  });
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
