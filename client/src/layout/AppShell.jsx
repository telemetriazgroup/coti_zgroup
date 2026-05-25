import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';

const LS_SIDEBAR = 'zgroup_sidebar_open';
const LS_THEME = 'zgroup-theme';

function readSidebarOpenDesktop() {
  if (typeof window === 'undefined') return true;
  return localStorage.getItem(LS_SIDEBAR) !== '0';
}

export function AppShell() {
  const location = useLocation();
  const { user, logout, hasRole, isAdmin, isSuperuser } = useAuth();
  const prevFocusRef = useRef(false);

  const isProjectFocus = /^\/projects\/[^/]+\/(presupuesto|planos)$/.test(location.pathname);

  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 900px)').matches : false
  );

  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === 'undefined') return true;
    if (window.matchMedia('(max-width: 900px)').matches) return false;
    return readSidebarOpenDesktop();
  });

  const [theme, setTheme] = useState(() => {
    if (typeof document === 'undefined') return 'dark';
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  });
  const [catalogPending, setCatalogPending] = useState(0);

  useEffect(() => {
    if (!isAdmin()) return;
    api.get('/api/catalog/requests/pending-count')
      .then((d) => setCatalogPending(d?.count ?? 0))
      .catch(() => setCatalogPending(0));
  }, [isAdmin, user?.id]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      if (typeof document !== 'undefined') {
        document.documentElement.setAttribute('data-theme', next);
        try {
          localStorage.setItem(LS_THEME, next);
        } catch {
          /* ignore */
        }
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const sync = () => {
      const m = mq.matches;
      setIsMobile(m);
      if (m) {
        setSidebarOpen(false);
      } else {
        setSidebarOpen(readSidebarOpenDesktop());
      }
    };
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (isProjectFocus) {
      setSidebarOpen(false);
      prevFocusRef.current = true;
      return;
    }
    if (prevFocusRef.current && !isMobile) {
      setSidebarOpen(readSidebarOpenDesktop());
    }
    prevFocusRef.current = false;
  }, [isProjectFocus, isMobile]);

  const openSidebarForModules = useCallback(() => {
    setSidebarOpen(true);
    if (typeof window !== 'undefined' && !window.matchMedia('(max-width: 900px)').matches) {
      localStorage.setItem(LS_SIDEBAR, '1');
    }
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined' && !window.matchMedia('(max-width: 900px)').matches) {
        localStorage.setItem(LS_SIDEBAR, next ? '1' : '0');
      }
      return next;
    });
  }, []);

  const closeSidebarMobile = useCallback(() => {
    if (window.matchMedia('(max-width: 900px)').matches) {
      setSidebarOpen(false);
    }
  }, []);

  const initials =
    `${user?.nombres?.[0] || ''}${user?.apellidos?.[0] || ''}`.toUpperCase() || user?.email?.[0]?.toUpperCase() || '?';

  const navClass =
    'app-layout' +
    (sidebarOpen ? ' app-layout--sidebar-open' : '') +
    (isProjectFocus ? ' app-layout--project-focus' : '');

  return (
    <div className={navClass}>
      {isProjectFocus && !sidebarOpen && (
        <button
          type="button"
          className="sidebar-reveal-btn mono"
          onClick={openSidebarForModules}
          title="Mostrar menú de módulos"
          aria-label="Mostrar menú de módulos"
        >
          <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden>
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
          Módulos
        </button>
      )}
      {isMobile && sidebarOpen ? (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="Cerrar menú"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}

      <aside id="sidebar" aria-hidden={!sidebarOpen}>
        <div className="sb-logo">
          <div className="sb-logo-hex">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="1.6">
              <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5" />
            </svg>
          </div>
          <div>
            <div className="sb-logo-name">ZGROUP</div>
            <div className="sb-logo-ver">COT.TÉCNICAS</div>
          </div>
        </div>
        <div className="sb-user">
          <Link to="/profile" className="sb-user-link" onClick={closeSidebarMobile} title="Mi perfil">
            <div className="sb-avatar">{initials}</div>
            <div className="sb-user-info">
              <div className="sb-user-name">
                {user?.nombres ? `${user.nombres} ${user.apellidos || ''}` : user?.email}
              </div>
              <div className="sb-user-role">{user?.role}</div>
            </div>
          </Link>
          <button type="button" className="sb-logout-btn" onClick={() => logout()} title="Salir">
            <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
            </svg>
          </button>
        </div>
        <div className="sb-section">Principal</div>
        <nav className="sb-nav">
          <NavLink
            to="/dashboard"
            className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}
            end
            onClick={closeSidebarMobile}
          >
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
            </svg>
            Dashboard
          </NavLink>
          <NavLink to="/projects" className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')} onClick={closeSidebarMobile}>
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
            </svg>
            Proyectos
          </NavLink>
          <NavLink to="/profile" className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')} onClick={closeSidebarMobile}>
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z" />
            </svg>
            Mi perfil
          </NavLink>
          {(isAdmin() || hasRole('COMERCIAL')) && (
            <NavLink to="/catalog" className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')} onClick={closeSidebarMobile}>
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
              </svg>
              Catálogo
              {catalogPending > 0 && isAdmin() && (
                <span className="tag" style={{ marginLeft: 'auto', fontSize: 10, borderColor: 'var(--amber)', color: 'var(--amber)' }}>
                  {catalogPending}
                </span>
              )}
            </NavLink>
          )}
          {isSuperuser() && (
            <>
              <div className="sb-section">Superusuario</div>
              <NavLink to="/superusuario" className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')} onClick={closeSidebarMobile}>
                <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M12 2l3 7h7l-5.5 4 2 7L12 16l-6.5 4 2-7L2 9h7z" />
                </svg>
                Sistema / Backup
              </NavLink>
              <NavLink
                to="/superusuario/datos"
                className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}
                onClick={closeSidebarMobile}
              >
                <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                </svg>
                Datos BD
              </NavLink>
              <NavLink
                to="/superusuario/asignaciones"
                className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}
                onClick={closeSidebarMobile}
              >
                <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
                </svg>
                Asignar comerciales
              </NavLink>
            </>
          )}
          {(isAdmin() || hasRole('COMERCIAL')) && (
            <>
              <div className="sb-section">{isAdmin() ? 'Administración' : 'Gestión'}</div>
              {isAdmin() && (
                <>
                  <NavLink to="/clients" className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')} onClick={closeSidebarMobile}>
                    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8z" />
                    </svg>
                    Clientes
                  </NavLink>
                  <NavLink to="/employees" className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')} onClick={closeSidebarMobile}>
                    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z" />
                    </svg>
                    Empleados
                  </NavLink>
                  <NavLink to="/measures" className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')} onClick={closeSidebarMobile}>
                    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M4 7h16M4 12h10M4 17h6" />
                      <path d="M18 9v6M15 12h6" />
                    </svg>
                    Medidas
                  </NavLink>
                </>
              )}
              <NavLink
                to="/users"
                className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}
                onClick={closeSidebarMobile}
              >
                <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M12 7a4 4 0 100-8 4 4 0 000 8z" />
                </svg>
                Usuarios
              </NavLink>
            </>
          )}
        </nav>
        <div className="sb-section">Ayuda</div>
        <nav className="sb-nav sb-nav--footer">
          <NavLink to="/guia" className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')} onClick={closeSidebarMobile}>
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
              <path d="M8 7h6M8 11h8" />
            </svg>
            Guía de usuario
          </NavLink>
        </nav>
        <div className="sb-footer">
          <div className="sb-version">ZGROUP · Cotizaciones</div>
        </div>
      </aside>

      <div id="main-area">
        <header id="top-header">
          <button
            type="button"
            className="header-nav-toggle"
            onClick={toggleSidebar}
            aria-expanded={sidebarOpen}
            aria-controls="sidebar"
            title={sidebarOpen ? 'Ocultar menú lateral' : 'Mostrar menú lateral'}
          >
            <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden>
              {!sidebarOpen ? (
                <path d="M4 6h16M4 12h16M4 18h16" />
              ) : isMobile ? (
                <path d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 6l-6 6 6 6" />
              )}
            </svg>
          </button>
          <div className="hdr-breadcrumb">
            <span className="hdr-section">Sistema</span>
            <span className="hdr-sep">/</span>
            <span className="hdr-title">Workspace</span>
          </div>
          <div className="theme-toggle" title="Tema de la interfaz">
            <span className="theme-toggle__lbl">Tema</span>
            <button
              type="button"
              className="theme-toggle__btn"
              onClick={toggleTheme}
              aria-pressed={theme === 'light'}
              aria-label={theme === 'dark' ? 'Activar tema claro' : 'Activar tema oscuro'}
            >
              {theme === 'dark' ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
                </svg>
              )}
            </button>
          </div>
        </header>
        <main id="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
