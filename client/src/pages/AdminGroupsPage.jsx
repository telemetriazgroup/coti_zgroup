import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { Modal } from '../components/Modal';

export function AdminGroupsPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ nombre: '', adminIds: [] });
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const d = await api.get('/api/admin-groups');
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

  const admins = data?.allAdmins || [];
  const groups = data?.groups || [];

  const filteredAdmins = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return admins;
    return admins.filter(
      (a) =>
        (a.email && a.email.toLowerCase().includes(q)) ||
        (a.nombre && a.nombre.toLowerCase().includes(q))
    );
  }, [admins, search]);

  function openCreate() {
    setForm({ nombre: '', adminIds: [] });
    setSearch('');
    setModal('edit');
  }

  function openEdit(group) {
    setForm({
      id: group.id,
      nombre: group.nombre,
      adminIds: (group.members || []).map((m) => m.adminId),
    });
    setSearch('');
    setModal('edit');
  }

  function toggleAdmin(id) {
    setForm((f) => ({
      ...f,
      adminIds: f.adminIds.includes(id) ? f.adminIds.filter((x) => x !== id) : [...f.adminIds, id],
    }));
  }

  async function submitForm(e) {
    if (!window.confirm(`¿Eliminar el grupo «${group.nombre}»?`)) return;
    setErr(null);
    try {
      await api.del(`/api/admin-groups/${group.id}`);
      setMsg(`Grupo «${group.nombre}» eliminado`);
      load();
    } catch (e2) {
      setErr(e2.message);
    }
  }

  async function submitForm(e) {
    e.preventDefault();
    if (!form.nombre.trim()) {
      setErr('Indique un nombre para el grupo');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const body = { nombre: form.nombre.trim(), adminIds: form.adminIds };
      if (form.id) {
        await api.put(`/api/admin-groups/${form.id}`, body);
        setMsg(`Grupo «${form.nombre}» actualizado`);
      } else {
        await api.post('/api/admin-groups', body);
        setMsg(`Grupo «${form.nombre}» creado`);
      }
      setModal(null);
      load();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="view-active">
      <div className="page-header page-header--row">
        <div>
          <h1 className="page-title">Grupos de administradores</h1>
          <p className="page-sub muted">
            Los ADMIN del mismo grupo ven proyectos de los demás miembros y de sus comerciales asignados.
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={openCreate}>
          Nuevo grupo
        </button>
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

      {loading ? (
        <p className="muted mono">Cargando…</p>
      ) : groups.length === 0 ? (
        <p className="muted mono">No hay grupos. Cree uno para compartir visibilidad entre administradores.</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Grupo</th>
                <th>Miembros (ADMIN)</th>
                <th className="actions-col">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.id}>
                  <td className="mono">{g.nombre}</td>
                  <td>
                    {(g.members || []).length === 0 ? (
                      <span className="muted">Sin miembros</span>
                    ) : (
                      (g.members || [])
                        .map((m) => m.adminEmail || m.adminNombre)
                        .join(', ')
                    )}
                  </td>
                  <td className="actions-col">
                    <button type="button" className="btn-link mono" onClick={() => openEdit(g)}>
                      Editar
                    </button>
                    <button
                      type="button"
                      className="btn-link mono"
                      style={{ color: 'var(--red)', marginLeft: 8 }}
                      onClick={() => removeGroup(g)}
                    >
                      Eliminar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal === 'edit' && (
        <Modal
          title={form.id ? 'Editar grupo' : 'Nuevo grupo'}
          onClose={() => setModal(null)}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setModal(null)}>
                Cancelar
              </button>
              <button type="submit" form="admin-group-form" className="btn btn-primary" disabled={busy}>
                {busy ? 'Guardando…' : 'Guardar'}
              </button>
            </>
          }
        >
          <form id="admin-group-form" className="stack-form" onSubmit={submitForm}>
            <label>
              <span className="fg-lbl">Nombre del grupo *</span>
              <input
                className="form-input"
                value={form.nombre}
                onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
                required
                maxLength={120}
              />
            </label>
            <label>
              <span className="fg-lbl">Buscar administrador</span>
              <input
                className="form-input mono"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Email o nombre…"
              />
            </label>
            <div className="zgroup-scroll" style={{ maxHeight: 280, border: '1px solid var(--border-dim)', borderRadius: 8 }}>
              {filteredAdmins.length === 0 ? (
                <p className="muted mono" style={{ padding: 12 }}>
                  Sin resultados
                </p>
              ) : (
                filteredAdmins.map((a) => (
                  <label key={a.id} className="chk-row" style={{ padding: '8px 12px', display: 'flex' }}>
                    <input
                      type="checkbox"
                      checked={form.adminIds.includes(a.id)}
                      onChange={() => toggleAdmin(a.id)}
                      disabled={!a.active}
                    />
                    <span className="mono">
                      {a.email}
                      {a.nombre && a.nombre !== a.email ? ` · ${a.nombre}` : ''}
                      {!a.active ? ' (inactivo)' : ''}
                    </span>
                  </label>
                ))
              )}
            </div>
            <p className="muted mono" style={{ fontSize: 12 }}>
              Seleccionados: {form.adminIds.length}. Un admin puede estar en varios grupos.
            </p>
          </form>
        </Modal>
      )}
    </section>
  );
}
