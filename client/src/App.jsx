import React from 'react';
import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { LoginPage } from './pages/LoginPage';
import { AppShell } from './layout/AppShell';
import { DashboardPage } from './pages/DashboardPage';
import { EmployeesPage } from './pages/EmployeesPage';
import { ClientsPage } from './pages/ClientsPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { UsersPage } from './pages/UsersPage';
import { CatalogPage } from './pages/CatalogPage';
import { ProjectBudgetPage } from './pages/ProjectBudgetPage';
import { ProjectPlansPage } from './pages/ProjectPlansPage';
import { UserGuidePage } from './pages/UserGuidePage';
import { SuperuserPage } from './pages/SuperuserPage';
import { AdminAssignmentsPage } from './pages/AdminAssignmentsPage';
import { MeasuresPage } from './pages/MeasuresPage';

function RequireAuth() {
  const { user, ready } = useAuth();
  if (!ready) {
    return (
      <div className="boot-screen">
        <div className="boot-spinner" />
        <p className="boot-text mono">Cargando sesión…</p>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <Outlet />;
}

function RequireAdmin() {
  const { user, ready, isAdmin } = useAuth();
  if (!ready) {
    return (
      <div className="boot-screen">
        <div className="boot-spinner" />
        <p className="boot-text mono">Cargando…</p>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (!isAdmin()) return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}

function RequireSuperuser() {
  const { user, ready, isSuperuser } = useAuth();
  if (!ready) {
    return (
      <div className="boot-screen">
        <div className="boot-spinner" />
        <p className="boot-text mono">Cargando…</p>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (!isSuperuser()) return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}

function RequireUserManager() {
  const { user, ready, hasRole } = useAuth();
  if (!ready) {
    return (
      <div className="boot-screen">
        <div className="boot-spinner" />
        <p className="boot-text mono">Cargando…</p>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (!hasRole('ADMIN', 'SUPERUSER', 'COMERCIAL')) return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="projects/:projectId/presupuesto" element={<ProjectBudgetPage />} />
          <Route path="projects/:projectId/planos" element={<ProjectPlansPage />} />
          <Route path="catalog" element={<CatalogPage />} />
          <Route path="guia" element={<UserGuidePage />} />
          <Route element={<RequireSuperuser />}>
            <Route path="superusuario" element={<SuperuserPage />} />
            <Route path="superusuario/asignaciones" element={<AdminAssignmentsPage />} />
          </Route>
          <Route element={<RequireAdmin />}>
            <Route path="clients" element={<ClientsPage />} />
            <Route path="employees" element={<EmployeesPage />} />
            <Route path="measures" element={<MeasuresPage />} />
          </Route>
          <Route element={<RequireUserManager />}>
            <Route path="users" element={<UsersPage />} />
          </Route>
        </Route>
      </Route>
    </Routes>
  );
}
