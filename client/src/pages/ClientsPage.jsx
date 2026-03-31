import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Modal } from '../components/Modal';

const emptyForm = {
  razonSocial: '',
  ruc: '',
  contactoNombre: '',
  contactoEmail: '',
  contactoTelefono: '',
  ciudad: '',
  direccion: '',
  notas: '',
};

export function ClientsPage() {
  const { hasRole } = useAuth();
  const canWrite = hasRole('ADMIN', 'COMERCIAL');

  const [list, setList] = useState([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [err, setErr] = useState(null);

  const fetchList = useCallback(async (search) => {
    setLoading(true);
    setErr(null);
    try {
      const qs = search ? `?q=${encodeURIComponent(search)}` : '';
      const data = await api.get(`/api/clients${qs}`);
      setList(data);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => fetchList(q), 300);
    return () => clearTimeout(t);
  }, [q, fetchList]);

  function openNew() {
    setForm(emptyForm);
    setModal('new');
  }

  function openEdit(row) {
    setForm({
      razonSocial: row.razonSocial || '',
      ruc: row.ruc || '',
      contactoNombre: row.contactoNombre || '',
      contactoEmail: row.contactoEmail || '',
      contactoTelefono: row.contactoTelefono || '',
      ciudad: row.ciudad || '',
      direccion: row.direccion || '',
      notas: row.notas || '',
      _id: row.id,
    });
    setModal('edit');
  }

  async function submitClient(e) {
    e.preventDefault();
    setErr(null);
    const body = {
      razonSocial: form.razonSocial,
      ruc: form.ruc || undefined,
      contactoNombre: form.contactoNombre || undefined,
      contactoEmail: form.contactoEmail || undefined,
      contactoTelefono: form.contactoTelefono || undefined,
      ciudad: form.ciudad || undefined,
      direccion: form.direccion || undefined,
      notas: form.notas || undefined,
    };
    try {
      if (modal === 'new') {
        await api.post('/api/clients', body);
      } else {
        await api.put(`/api/clients/${form._id}`, body);
      }
      setModal(null);
      fetchList(q);
    } catch (e2) {
      setErr(e2.message);
    }
  }

  return (
    <section className="view-active">
      <div className="page-header page-header--row">
        <div>
          <h1 className="page-title">Clientes</h1>
          <p className="page-sub muted">CRM · contador de proyectos activos por cliente</p>
        </div>
        {canWrite && (
          <button type="button" className="btn btn-primary" onClick={openNew}>
            Nuevo cliente
          </button>
        )}
      </div>

      <div className="toolbar">
        <input
          type="search"
          className="form-input toolbar-search"
          placeholder="Buscar razón social, RUC, contacto…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {err && (
        <div className="banner banner--err mono" style={{ marginBottom: 12 }}>
          {err}
        </div>
      )}

      <div className="panel panel--flush">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Razón social</th>
                <th>RUC</th>
                <th>Ciudad</th>
                <th className="num">Proyectos</th>
                {canWrite && <th />}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={canWrite ? 5 : 4} className="muted mono">
                    Cargando…
                  </td>
                </tr>
              ) : list.length === 0 ? (
                <tr>
                  <td colSpan={canWrite ? 5 : 4} className="muted">
                    Sin resultados
                  </td>
                </tr>
              ) : (
                list.map((row) => (
                  <tr key={row.id}>
                    <td>{row.razonSocial}</td>
                    <td className="mono">{row.ruc || '—'}</td>
                    <td>{row.ciudad || '—'}</td>
                    <td className="num mono">{row.projectCount ?? 0}</td>
                    {canWrite && (
                      <td>
                        <button type="button" className="btn-link mono" onClick={() => openEdit(row)}>
                          Editar
                        </button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modal && canWrite && (
        <Modal
          title={modal === 'new' ? 'Nuevo cliente' : 'Editar cliente'}
          onClose={() => setModal(null)}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setModal(null)}>
                Cancelar
              </button>
              <button type="submit" form="client-form" className="btn btn-primary">
                Guardar
              </button>
            </>
          }
        >
          <form id="client-form" className="stack-form" onSubmit={submitClient}>
            <label>
              <span className="fg-lbl">Razón social *</span>
              <input
                className="form-input"
                required
                value={form.razonSocial}
                onChange={(e) => setForm((f) => ({ ...f, razonSocial: e.target.value }))}
              />
            </label>
            <label>
              <span className="fg-lbl">RUC</span>
              <input
                className="form-input mono"
                value={form.ruc}
                onChange={(e) => setForm((f) => ({ ...f, ruc: e.target.value }))}
              />
            </label>
            <label>
              <span className="fg-lbl">Contacto</span>
              <input
                className="form-input"
                value={form.contactoNombre}
                onChange={(e) => setForm((f) => ({ ...f, contactoNombre: e.target.value }))}
              />
            </label>
            <label>
              <span className="fg-lbl">Email contacto</span>
              <input
                type="email"
                className="form-input mono"
                value={form.contactoEmail}
                onChange={(e) => setForm((f) => ({ ...f, contactoEmail: e.target.value }))}
              />
            </label>
            <label>
              <span className="fg-lbl">Teléfono</span>
              <input
                className="form-input mono"
                value={form.contactoTelefono}
                onChange={(e) => setForm((f) => ({ ...f, contactoTelefono: e.target.value }))}
              />
            </label>
            <label>
              <span className="fg-lbl">Ciudad</span>
              <input
                className="form-input"
                value={form.ciudad}
                onChange={(e) => setForm((f) => ({ ...f, ciudad: e.target.value }))}
              />
            </label>
            <label>
              <span className="fg-lbl">Dirección</span>
              <textarea
                className="form-input form-textarea"
                rows={2}
                value={form.direccion}
                onChange={(e) => setForm((f) => ({ ...f, direccion: e.target.value }))}
              />
            </label>
            <label>
              <span className="fg-lbl">Notas</span>
              <textarea
                className="form-input form-textarea"
                rows={2}
                value={form.notas}
                onChange={(e) => setForm((f) => ({ ...f, notas: e.target.value }))}
              />
            </label>
          </form>
        </Modal>
      )}
    </section>
  );
}
