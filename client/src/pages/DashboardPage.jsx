import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { STATUS_LABEL } from '../lib/quotationStatus';
import { SuperuserAnalyticsPanel } from '../components/SuperuserAnalyticsPanel';

function formatUsd(n) {
  if (n == null || Number.isNaN(n)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

export function DashboardPage() {
  const { user, hasRole, isAdmin, isSuperuser } = useAuth();
  const isAdminUser = isAdmin();
  const isSuper = isSuperuser();
  const scopedDash = hasRole('COMERCIAL', 'VIEWER');
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
    if (!isAdminUser && !isSuper) return;
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
  }, [isAdminUser, isSuper]);

  return (
    <section className="view-active">
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <p className="page-sub muted">
          {isSuper
            ? 'Vista global del sistema (superusuario)'
            : isAdminUser
            ? 'Vista global del sistema'
            : hasRole('COMERCIAL')
              ? 'Tus proyectos y montos de lista'
              : hasRole('VIEWER')
                ? 'Proyectos que te fueron asignados'
                : 'Resumen según tu rol'}
        </p>
      </div>
      {(isAdminUser || isSuper) && (
        <div className="kpi-grid">
          <div className="kpi-card">
            <div className="kpi-label mono">Proyectos (todos)</div>
            <div className="kpi-value">{summary != null ? summary.projectsActive : '—'}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label mono">Clientes (CRM total)</div>
            <div className="kpi-value">{summary != null ? summary.clientsTotal : '—'}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label mono">Rol</div>
            <div className="kpi-value" style={{ fontSize: 16 }}>
              {user?.role || '—'}
            </div>
          </div>
        </div>
      )}
      {scopedDash && (
        <div className="kpi-grid">
          <div className="kpi-card">
            <div className="kpi-label mono">
              {hasRole('VIEWER') ? 'Proyectos (asignados)' : 'Proyectos (tuyos)'}
            </div>
            <div className="kpi-value">{summary != null ? summary.projectsActive : '—'}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label mono">Clientes (en esos proyectos)</div>
            <div className="kpi-value">{summary != null ? summary.clientsInMyProjects : '—'}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label mono">Lista (presupuesto)</div>
            <div className="kpi-value">{summary != null ? formatUsd(summary.pipelineMy) : '—'}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label mono">Rol</div>
            <div className="kpi-value" style={{ fontSize: 16 }}>
              {user?.role || '—'}
            </div>
          </div>
        </div>
      )}

      {(isAdminUser || isSuper) && admin && (
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

      {isSuper && <SuperuserAnalyticsPanel />}

      <div className="panel">
        <div className="panel-hdr">
          <span className="panel-title">Bienvenido</span>
        </div>
        <p className="muted" style={{ lineHeight: 1.6 }}>
          Sesión: <strong className="mono">{user?.email}</strong>.{' '}
          {isSuper ? (
            <>
              Como superusuario ves todos los proyectos y creadores, la auditoría global y el backup del sistema en{' '}
              <strong>Sistema / Backup</strong>.
            </>
          ) : isAdminUser ? (
            <>
              Desde el menú administrás <strong>Clientes</strong>, <strong>Catálogo</strong>, <strong>Empleados</strong> y{' '}
              <strong>Usuarios</strong>; podés compartir proyectos con otros ADMIN o COMERCIAL.
            </>
          ) : hasRole('COMERCIAL') ? (
            <>
              Tu espacio de trabajo es <strong>Proyectos</strong> (propios o compartidos) y el catálogo en solo lectura.
            </>
          ) : (
            <>
              Tenés acceso de lectura a los <strong>Proyectos</strong> que te asignen. Los demás módulos los gestiona{' '}
              <strong>ADMIN</strong>.
            </>
          )}
        </p>
      </div>
    </section>
  );
}
