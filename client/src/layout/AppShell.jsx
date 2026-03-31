import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export function AppShell() {
  const { user, logout, hasRole } = useAuth();

  const initials =
    `${user?.nombres?.[0] || ''}${user?.apellidos?.[0] || ''}`.toUpperCase() || user?.email?.[0]?.toUpperCase() || '?';

  return (
    <div className="app-layout">
      <aside id="sidebar">
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
          <NavLink to="/dashboard" className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')} end>
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
            </svg>
            Dashboard
          </NavLink>
          {hasRole('ADMIN', 'COMERCIAL') && (
            <div className="nav-item muted" style={{ opacity: 0.65, cursor: 'default' }} title="Sprint 1">
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
              </svg>
              Proyectos (próx.)
            </div>
          )}
          {hasRole('ADMIN', 'COMERCIAL') && (
            <div className="nav-item muted" style={{ opacity: 0.65, cursor: 'default' }} title="Sprint 1">
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8z" />
              </svg>
              Clientes (próx.)
            </div>
          )}
          {hasRole('ADMIN') && (
            <>
              <div className="sb-section">Administración</div>
              <div className="nav-item muted" style={{ opacity: 0.65, cursor: 'default' }} title="Sprint 2">
                <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
                </svg>
                Catálogo (próx.)
              </div>
              <div className="nav-item muted" style={{ opacity: 0.65, cursor: 'default' }} title="Sprint 0+">
                <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M12 7a4 4 0 100-8 4 4 0 000 8z" />
                </svg>
                Usuarios (API lista)
              </div>
            </>
          )}
        </nav>
        <div className="sb-footer">
          <div className="sb-version">ZGROUP · Sprint 0 · React</div>
        </div>
      </aside>
      <div id="main-area">
        <header id="top-header">
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
