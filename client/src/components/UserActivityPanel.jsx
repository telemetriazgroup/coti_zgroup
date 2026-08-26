import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

const KIND_LABEL = {
  LOGIN: 'Inicio de sesión',
  LOGOUT: 'Cierre de sesión',
  DASHBOARD: 'Dashboard',
  LISTA_PROYECTOS: 'Lista de proyectos',
  PRESUPUESTO: 'Presupuesto',
  PLANOS: 'Planos',
  CATALOGO: 'Catálogo',
  CLIENTES: 'Clientes',
  USUARIOS: 'Usuarios',
  OTRO: 'Otro',
};

function personLabel(u) {
  const name = [u.nombres, u.apellidos].filter(Boolean).join(' ').trim();
  return name || u.email || '—';
}

function formatWhen(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-PE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function UserActivityPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const res = await api.get('/api/dashboard/user-activity');
        if (alive) setData(res);
      } catch (e) {
        if (alive) {
          setData(null);
          setErr(e.message || 'No se pudo cargar la actividad');
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <div className="panel-hdr">
        <span className="panel-title">Comportamiento de usuarios</span>
      </div>
      <p className="muted mono" style={{ fontSize: 12, padding: '0 16px 8px' }}>
        Último acceso al sistema, proyecto en el que estuvo y última acción. Solo visible para SUPERUSER.
      </p>
      {loading ? (
        <p className="muted mono" style={{ padding: '0 16px 16px' }}>
          Cargando…
        </p>
      ) : err ? (
        <p className="banner banner--err mono" style={{ margin: '0 16px 16px' }}>
          {err}
        </p>
      ) : (
        <>
          <div className="table-wrap" style={{ padding: '0 16px 12px' }}>
            <table className="data-table data-table--compact">
              <thead>
                <tr>
                  <th>Usuario</th>
                  <th>Rol</th>
                  <th>Último acceso</th>
                  <th>Proyecto</th>
                  <th>Última acción</th>
                </tr>
              </thead>
              <tbody>
                {data?.users?.length ? (
                  data.users.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <div>{personLabel(u)}</div>
                        <div className="muted mono" style={{ fontSize: 10 }}>
                          {u.email}
                        </div>
                      </td>
                      <td className="mono">{u.role}</td>
                      <td className="mono">{formatWhen(u.lastLoginAt)}</td>
                      <td>
                        {u.lastProjectId ? (
                          <Link to={`/projects/${u.lastProjectId}/presupuesto`}>{u.lastProjectNombre || 'Proyecto'}</Link>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        {KIND_LABEL[u.lastKind] || u.lastKind || '—'}
                        {u.lastSummary ? (
                          <span className="muted" style={{ display: 'block', fontSize: 11 }}>
                            {u.lastSummary}
                          </span>
                        ) : null}
                        <span className="muted mono" style={{ display: 'block', fontSize: 10 }}>
                          {formatWhen(u.lastActivityAt)}
                        </span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="muted">
                      Aún no hay accesos registrados. Aparecerán al iniciar sesión o al entrar a un proyecto.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="panel-hdr" style={{ borderTop: '1px solid var(--border-dim)' }}>
            <span className="panel-title">Actividad reciente</span>
          </div>
          <div className="table-wrap" style={{ padding: '0 16px 16px' }}>
            <table className="data-table data-table--compact">
              <thead>
                <tr>
                  <th>Cuándo</th>
                  <th>Usuario</th>
                  <th>Acción</th>
                  <th>Proyecto</th>
                </tr>
              </thead>
              <tbody>
                {data?.recent?.length ? (
                  data.recent.map((r) => (
                    <tr key={r.id}>
                      <td className="mono">{formatWhen(r.createdAt)}</td>
                      <td>{personLabel(r)}</td>
                      <td>{KIND_LABEL[r.kind] || r.kind}</td>
                      <td>
                        {r.projectId ? (
                          <Link to={`/projects/${r.projectId}/presupuesto`}>{r.projectNombre || 'Proyecto'}</Link>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="muted">
                      Sin eventos recientes
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
