import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';

export function DashboardPage() {
  const { user } = useAuth();
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    let ok = true;
    (async () => {
      try {
        const data = await api.get('/api/dashboard/summary');
        if (ok) setSummary(data);
      } catch {
        if (ok) setSummary(null);
      }
    })();
    return () => {
      ok = false;
    };
  }, []);

  return (
    <section className="view-active">
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <p className="page-sub muted">Resumen según tu rol</p>
      </div>
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label mono">Proyectos (visibles)</div>
          <div className="kpi-value">{summary != null ? summary.projectsActive : '—'}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label mono">Clientes (CRM)</div>
          <div className="kpi-value">{summary != null ? summary.clientsTotal : '—'}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label mono">Rol</div>
          <div className="kpi-value" style={{ fontSize: 16 }}>
            {user?.role || '—'}
          </div>
        </div>
      </div>
      <div className="panel">
        <div className="panel-hdr">
          <span className="panel-title">Bienvenido</span>
        </div>
        <p className="muted" style={{ lineHeight: 1.6 }}>
          Sesión: <strong className="mono">{user?.email}</strong>. Usa el menú para{' '}
          <strong>Proyectos</strong>, <strong>Clientes</strong> y <strong>Mi ficha</strong>. La referencia visual
          completa del módulo financiero está en <code className="mono">zgroup-cotizaciones-v10-final.html</code>.
        </p>
      </div>
    </section>
  );
}
