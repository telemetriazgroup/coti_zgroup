import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';

const ROLE_HINT = {
  ADMIN: 'Ve y administra según alcance de administrador.',
  SEMIADMIN: 'Panel admin limitado; mismos proyectos de su equipo.',
  COMERCIAL: 'Solo sus proyectos (propios o compartidos) y catálogo en lectura.',
  VIEWER: 'Solo lectura del proyecto asignado.',
};

function displayName(row) {
  const n = `${row.nombres || ''} ${row.apellidos || ''}`.trim();
  return n || row.email;
}

export function ImpersonatePage() {
  const { user, startImpersonation, isImpersonating } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const data = await api.get('/api/auth/impersonate/candidates');
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setErr(e.message);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (role && r.role !== role) return false;
      if (!needle) return true;
      const blob = [r.email, r.nombres, r.apellidos, r.cargo, r.role].filter(Boolean).join(' ').toLowerCase();
      return blob.includes(needle);
    });
  }, [rows, q, role]);

  async function enterAs(row) {
    setBusyId(row.id);
    setErr(null);
    try {
      await startImpersonation(row.id);
    } catch (e) {
      setErr(e.message);
      setBusyId(null);
    }
  }

  return (
    <section className="view-active">
      <div className="page-header">
        <div>
          <h1 className="page-title">Virtualizar usuario</h1>
          <p className="page-sub muted">
            Entra a la interfaz con los permisos y el alcance de esa cuenta, sin su contraseña. La auditoría
            registra las acciones a nombre de {user?.email || 'superadmin'}. Al salir recupera todas las facultades.
          </p>
        </div>
      </div>

      {err && (
        <div className="banner banner--err mono" style={{ marginBottom: 12 }}>
          {err}
        </div>
      )}

      {isImpersonating && (
        <div className="banner banner--warn mono" style={{ marginBottom: 12 }}>
          Ya está virtualizando a otro usuario. Use la barra superior para salir o cambiar.
        </div>
      )}

      <div className="panel">
        <div className="panel-hdr">
          <span className="panel-title">Cuentas activas</span>
          <button type="button" className="btn btn-ghost mono" style={{ fontSize: 11 }} onClick={load} disabled={loading}>
            Actualizar
          </button>
        </div>
        <div className="budget-toolbar" style={{ marginBottom: 12 }}>
          <input
            type="search"
            className="form-input mono"
            placeholder="Buscar nombre, email, cargo…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select className="form-input" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">Todos los roles</option>
            <option value="ADMIN">ADMIN</option>
            <option value="SEMIADMIN">SEMIADMIN</option>
            <option value="COMERCIAL">COMERCIAL</option>
            <option value="VIEWER">VIEWER</option>
          </select>
        </div>
        <div className="table-wrap zgroup-scroll">
          <table className="data-table data-table--compact">
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Rol</th>
                <th>Cargo</th>
                <th>Email</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="muted mono">
                    Cargando…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="muted">
                    No hay usuarios que coincidan.
                  </td>
                </tr>
              ) : (
                filtered.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <div>{displayName(row)}</div>
                      {ROLE_HINT[row.role] && (
                        <div className="muted mono" style={{ fontSize: 11 }}>
                          {ROLE_HINT[row.role]}
                        </div>
                      )}
                    </td>
                    <td className="mono">{row.role}</td>
                    <td className="muted">{row.cargo || '—'}</td>
                    <td className="mono" style={{ fontSize: 12 }}>
                      {row.email}
                    </td>
                    <td className="actions-cell">
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={busyId === row.id || isImpersonating}
                        onClick={() => enterAs(row)}
                      >
                        {busyId === row.id ? 'Entrando…' : 'Ver como'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
