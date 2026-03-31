import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { STATUS_LABEL } from '../lib/quotationStatus';

function formatUsd(n) {
  if (n == null || Number.isNaN(n)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

export function DashboardPage() {
  const { user, hasRole } = useAuth();
  const isAdmin = hasRole('ADMIN');
  const [summary, setSummary] = useState(null);
  const [admin, setAdmin] = useState(null);

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

  useEffect(() => {
    if (!isAdmin) return;
    let alive = true;
    (async () => {
      try {
        const data = await api.get('/api/dashboard/admin');
        if (alive) setAdmin(data);
      } catch {
        if (alive) setAdmin(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [isAdmin]);

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

      {isAdmin && admin && (
        <>
          <h2 className="budget-panel-title" style={{ marginTop: 24 }}>
            Panel gerencial (ADMIN)
          </h2>
          <div className="kpi-grid">
            <div className="kpi-card">
              <div className="kpi-label mono">Pipeline (lista total)</div>
              <div className="kpi-value">{formatUsd(admin.pipelineTotal)}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label mono">Proyectos activos</div>
              <div className="kpi-value">{admin.projectsTotal}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label mono">Ratio cierre (aceptados / total)</div>
              <div className="kpi-value">
                {admin.projectsTotal > 0
                  ? `${(admin.ratioCierre * 100).toFixed(1)}%`
                  : '—'}
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label mono">Proyectos aceptados</div>
              <div className="kpi-value">{admin.acceptedTotal}</div>
            </div>
          </div>

          <div className="panel" style={{ marginTop: 16 }}>
            <div className="panel-hdr">
              <span className="panel-title">Proyectos por estado</span>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Estado</th>
                    <th className="num">Cantidad</th>
                  </tr>
                </thead>
                <tbody>
                  {admin.projectsByStatus?.length ? (
                    admin.projectsByStatus.map((r) => (
                      <tr key={r.status}>
                        <td>{STATUS_LABEL[r.status] || r.status}</td>
                        <td className="num mono">{r.count}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={2} className="muted">
                        Sin datos
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel" style={{ marginTop: 16 }}>
            <div className="panel-hdr">
              <span className="panel-title">Record por comercial</span>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Comercial</th>
                    <th className="num">Proyectos</th>
                    <th className="num">Pipeline</th>
                    <th className="num">Aceptados</th>
                  </tr>
                </thead>
                <tbody>
                  {admin.commercial?.map((c) => (
                    <tr key={c.id}>
                      <td className="mono">
                        {c.nombres || c.apellidos
                          ? `${c.nombres || ''} ${c.apellidos || ''}`.trim()
                          : c.email}
                      </td>
                      <td className="num mono">{c.projectsN}</td>
                      <td className="num mono">{formatUsd(c.pipelineValue)}</td>
                      <td className="num mono">{c.acceptedN}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <div className="panel">
        <div className="panel-hdr">
          <span className="panel-title">Bienvenido</span>
        </div>
        <p className="muted" style={{ lineHeight: 1.6 }}>
          Sesión: <strong className="mono">{user?.email}</strong>. Usa el menú para{' '}
          <strong>Proyectos</strong>, <strong>Clientes</strong> y <strong>Mi ficha</strong>.
          {isAdmin && ' El panel gerencial resume pipeline y desempeño por comercial.'}
        </p>
      </div>
    </section>
  );
}
