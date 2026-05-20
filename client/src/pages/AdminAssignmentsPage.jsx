import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { Modal } from '../components/Modal';

export function AdminAssignmentsPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);
  const [selAdmin, setSelAdmin] = useState(null);
  const [picked, setPicked] = useState([]);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const d = await api.get('/api/admin-assignments');
      setData(d);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const commercials = data?.allCommercials || [];

  const filteredCommercials = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return commercials;
    return commercials.filter(
      (c) =>
        (c.email && c.email.toLowerCase().includes(q)) ||
        (c.nombre && c.nombre.toLowerCase().includes(q))
    );
  }, [commercials, search]);

  function openEdit(admin) {
    setSelAdmin(admin);
    setPicked((admin.assignedCommercials || []).map((c) => c.commercialId));
    setSearch('');
    setMsg(null);
  }

  async function save(e) {
    e.preventDefault();
    if (!selAdmin) return;
    setBusy(true);
    setErr(null);
    try {
      await api.put(`/api/admin-assignments/${selAdmin.id}`, { commercialIds: picked });
      setMsg(`Asignación guardada para ${selAdmin.email}`);
      setSelAdmin(null);
      load();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

  function toggleCommercial(id) {
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  return (
    <section className="view-active">
      <div className="page-header">
        <h1 className="page-title">Asignación comerciales → admin</h1>
        <p className="page-sub muted">
          El superusuario asigna comerciales a cada administrador. Los admin también ven proyectos de comerciales que
          ellos mismos crearon.
        </p>
      </div>

      {err && (
        <div className="banner banner--err mono" style={{ marginBottom: 12 }}>
          {err}
        </div>
      )}
      {msg && (
        <div className="banner banner--ok mono" style={{ marginBottom: 12 }}>
          {msg}
        </div>
      )}

      <div className="panel panel--flush">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Administrador</th>
                <th>Comerciales asignados</th>
                <th className="actions-col">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={3} className="muted mono">
                    Cargando…
                  </td>
                </tr>
              ) : !(data?.admins || []).length ? (
                <tr>
                  <td colSpan={3} className="muted">
                    No hay administradores
                  </td>
                </tr>
              ) : (
                data.admins.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <span className="mono">{a.email}</span>
                      {a.nombre && a.nombre !== a.email && (
                        <span className="muted" style={{ display: 'block', fontSize: 11 }}>
                          {a.nombre}
                        </span>
                      )}
                    </td>
                    <td className="mono" style={{ fontSize: 11 }}>
                      {(a.assignedCommercials || []).length === 0
                        ? '—'
                        : a.assignedCommercials.map((c) => c.commercialEmail).join(', ')}
                    </td>
                    <td>
                      <button type="button" className="btn btn-ghost mono" onClick={() => openEdit(a)}>
                        Editar equipo
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selAdmin && (
        <Modal
          wide
          title={`Comerciales de ${selAdmin.email}`}
          onClose={() => setSelAdmin(null)}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setSelAdmin(null)}>
                Cancelar
              </button>
              <button type="submit" form="assign-form" className="btn btn-primary" disabled={busy}>
                {busy ? 'Guardando…' : 'Guardar'}
              </button>
            </>
          }
        >
          <form id="assign-form" className="stack-form" onSubmit={save}>
            <label>
              <span className="fg-lbl">Buscar comercial</span>
              <input
                type="search"
                className="form-input"
                placeholder="Email o nombre…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
              />
            </label>
            <p className="muted mono" style={{ fontSize: 11 }}>
              Seleccionados: {picked.length}
            </p>
            <div
              className="stack-form"
              style={{ maxHeight: 280, overflow: 'auto', border: '1px solid var(--border-dim)', padding: 8 }}
            >
              {filteredCommercials.length === 0 ? (
                <p className="muted">Sin resultados</p>
              ) : (
                filteredCommercials.map((c) => (
                  <label key={c.id} className="chk mono" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
                    <input
                      type="checkbox"
                      checked={picked.includes(c.id)}
                      onChange={() => toggleCommercial(c.id)}
                    />
                    {c.email}
                    {c.nombre && c.nombre !== c.email ? ` — ${c.nombre}` : ''}
                    {c.createdByEmail && (
                      <span className="muted" style={{ marginLeft: 6 }}>
                        (creado por {c.createdByEmail})
                      </span>
                    )}
                  </label>
                ))
              )}
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
