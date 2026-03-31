import React from 'react';
import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { LoginPage } from './pages/LoginPage';
import { AppShell } from './layout/AppShell';
import { DashboardPage } from './pages/DashboardPage';

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

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
