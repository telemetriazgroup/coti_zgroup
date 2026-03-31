import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, clearToken, getToken, request, setToken } from '../lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const onExpired = () => {
      clearToken();
      setUser(null);
      navigate('/login', { replace: true });
    };
    const onUserUpdated = (e) => {
      if (e.detail) setUser(e.detail);
    };
    window.addEventListener('zgroup:session-expired', onExpired);
    window.addEventListener('zgroup:user-updated', onUserUpdated);
    return () => {
      window.removeEventListener('zgroup:session-expired', onExpired);
      window.removeEventListener('zgroup:user-updated', onUserUpdated);
    };
  }, [navigate]);

  useEffect(() => {
    (async () => {
      try {
        const data = await request('/api/auth/session', { method: 'GET' });
        if (data.authenticated) {
          setToken(data.accessToken);
          setUser(data.user);
        }
      } catch {
        /* sin sesión */
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const login = useCallback(
    async (email, password) => {
      const data = await api.post('/api/auth/login', { email, password });
      setToken(data.accessToken);
      setUser(data.user);
      navigate('/dashboard', { replace: true });
    },
    [navigate]
  );

  const logout = useCallback(async () => {
    try {
      if (getToken()) await api.post('/api/auth/logout', {});
    } catch {
      /* ok */
    }
    clearToken();
    setUser(null);
    navigate('/login', { replace: true });
  }, [navigate]);

  const value = useMemo(
    () => ({
      user,
      ready,
      login,
      logout,
      hasRole: (...roles) => user && roles.includes(user.role),
    }),
    [user, ready, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth fuera de AuthProvider');
  return ctx;
}
