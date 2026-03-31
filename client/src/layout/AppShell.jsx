import React, { useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const LS_SIDEBAR = 'zgroup_sidebar_open';

function readSidebarOpenDesktop() {
  if (typeof window === 'undefined') return true;
  return localStorage.getItem(LS_SIDEBAR) !== '0';
}

export function AppShell() {
  const { user, logout, hasRole } = useAuth();

  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 900px)').matches : false
  );

  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === 'undefined') return true;
    if (window.matchMedia('(max-width: 900px)').matches) return false;
    return readSidebarOpenDesktop();
  });

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

  const navClass = 'app-layout' + (sidebarOpen ? ' app-layout--sidebar-open' : '');

  return (
    <div className={navClass}>
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
          <div className="sb-avatar">{initials}</div>
          <div className="sb-user-info">
            <div className="sb-user-name">
              {user?.nombres ? `${user.nombres} ${user.apellidos || ''}` : user?.email}
            </div>
            <div className="sb-user-role">{user?.role}</div>
          </div>
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
          <NavLink to="/clients" className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')} onClick={closeSidebarMobile}>
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8z" />
            </svg>
            Clientes
          </NavLink>
          <NavLink to="/catalog" className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')} onClick={closeSidebarMobile}>
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
            </svg>
            Catálogo
          </NavLink>
          <NavLink to="/employees" className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')} onClick={closeSidebarMobile}>
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z" />
            </svg>
            Mi ficha
          </NavLink>
          {hasRole('ADMIN') && (
            <>
              <div className="sb-section">Administración</div>
              <NavLink to="/users" className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')} onClick={closeSidebarMobile}>
                <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M12 7a4 4 0 100-8 4 4 0 000 8z" />
                </svg>
                Usuarios
              </NavLink>
            </>
          )}
        </nav>
        <div className="sb-footer">
          <div className="sb-version">ZGROUP · Sprint 3 · React</div>
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
        </header>
        <main id="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
