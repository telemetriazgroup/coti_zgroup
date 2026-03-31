import React from 'react';
import { useAuth } from '../context/AuthContext';

export function DashboardPage() {
  const { user } = useAuth();

  return (
    <section className="view-active">
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label mono">Proyectos activos</div>
          <div className="kpi-value">—</div>
          <div className="kpi-hint">Sprint 1</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label mono">Aceptadas</div>
          <div className="kpi-value">—</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label mono">En negociación</div>
          <div className="kpi-value">—</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label mono">Clientes</div>
          <div className="kpi-value">—</div>
        </div>
      </div>
      <div className="panel">
        <div className="panel-hdr">
          <span className="panel-title">Bienvenido</span>
        </div>
        <p className="muted" style={{ lineHeight: 1.6 }}>
          Sesión iniciada como <strong className="mono">{user?.email}</strong> ({user?.role}). El shell React
          cumple Sprint 0; las vistas de cotización seguirán la referencia visual de{' '}
          <code className="mono">zgroup-cotizaciones-v10-final.html</code> en sprints posteriores.
        </p>
      </div>
    </section>
  );
}
