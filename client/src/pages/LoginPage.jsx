import React, { useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const REASON_MSG = {
  session_expired: { text: 'Tu sesión ha expirado. Vuelve a ingresar.', kind: 'warning' },
  no_session: {
    text: 'No se pudo validar la sesión. Ingresa de nuevo (mismo navegador y dirección).',
    kind: 'error',
  },
  app_error: { text: 'Error al cargar la aplicación. Intenta otra vez.', kind: 'error' },
};

export function LoginPage() {
  const { user, ready, login } = useAuth();
  const [search] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [warn, setWarn] = useState(null);

  useEffect(() => {
    const reason = search.get('reason');
    if (reason && REASON_MSG[reason]) {
      const r = REASON_MSG[reason];
      if (r.kind === 'warning') setWarn(r.text);
      else setError(r.text);
    }
  }, [search]);

  if (ready && user) {
    return <Navigate to="/dashboard" replace />;
  }

  if (!ready) {
    return (
      <div className="boot-screen">
        <div className="boot-spinner" />
        <p className="boot-text mono">Comprobando sesión…</p>
      </div>
    );
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setWarn(null);
    setLoading(true);
    try {
      await login(email.trim(), password);
    } catch (err) {
      const code = err.code;
      if (code === 'TOO_MANY_REQUESTS') {
        setError('Demasiados intentos. Espera 15 minutos antes de reintentar.');
      } else if (code === 'INVALID_CREDENTIALS' || err.status === 401) {
        setError('Credenciales incorrectas. Verifica tu correo y contraseña.');
      } else {
        setError(err.message || 'Error de conexión. Revisa la red e intenta de nuevo.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="logo-wrap">
          <div className="logo-hex">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="1.8">
              <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5" />
              <line x1="12" y1="2" x2="12" y2="22" />
              <line x1="2" y1="8.5" x2="22" y2="8.5" />
              <line x1="2" y1="15.5" x2="22" y2="15.5" />
            </svg>
          </div>
          <div className="logo-text">
            <span className="logo-name">ZGROUP</span>
            <span className="logo-sub">Sistema de Cotizaciones</span>
          </div>
        </div>
        <div className="divider" />
        <form className="login-form" onSubmit={onSubmit} noValidate>
          <div className="form-group">
            <label className="form-label" htmlFor="email">
              Correo electrónico
            </label>
            <input
              id="email"
              type="email"
              className="form-input"
              placeholder="usuario@zgroup.pe"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="password">
              Contraseña
            </label>
            <div className="pwd-wrap">
              <input
                id="password"
                type={showPwd ? 'text' : 'password'}
                className="form-input pwd-input"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
              <button type="button" className="pwd-toggle" onClick={() => setShowPwd((s) => !s)} title="Mostrar/ocultar">
                <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </button>
            </div>
          </div>
          {warn && <div className="msg warning show">{warn}</div>}
          {error && <div className="msg error show">{error}</div>}
          <button type="submit" className={`btn-login${loading ? ' loading' : ''}`} disabled={loading}>
            <span className="btn-label">{loading ? 'INGRESANDO…' : 'INGRESAR'}</span>
          </button>
        </form>
        <p className="login-footer">Sistema de gestión interna — Solo personal ZGROUP</p>
      </div>
      <div className="version-badge">v1.0.0 · React</div>
    </div>
  );
}
