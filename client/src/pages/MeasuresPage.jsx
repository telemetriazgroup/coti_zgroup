import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Modal } from '../components/Modal';
import { fetchMeasureUnits, invalidateMeasureUnitsCache } from '../lib/measureUnits';

const emptyForm = { suffix: '', nombre: '', sortOrder: '0', active: true };

export function MeasuresPage() {
  const { hasRole } = useAuth();
  const canWrite = hasRole('ADMIN', 'SUPERUSER');

  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [includeInactive, setIncludeInactive] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      invalidateMeasureUnitsCache();
      const data = await fetchMeasureUnits(includeInactive);
      setList(data || []);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [includeInactive]);

  useEffect(() => {
    load();
  }, [load]);

  function openNew() {
    setForm(emptyForm);
    setModal('new');
  }

  function openEdit(row) {
    setForm({
      suffix: row.suffix,
      nombre: row.nombre,
      sortOrder: String(row.sortOrder ?? 0),
      active: row.active !== false,
      _id: row.id,
    });
    setModal('edit');
  }

  async function save(e) {
    e.preventDefault();
    if (!canWrite) return;
    setErr(null);
    const body = {
      suffix: form.suffix.trim().toUpperCase(),
      nombre: form.nombre.trim(),
      sortOrder: parseInt(form.sortOrder, 10) || 0,
      active: form.active,
    };
    try {
      if (modal === 'new') {
        await api.post('/api/measures', body);
      } else {
        await api.put(`/api/measures/${form._id}`, body);
      }
      setModal(null);
      load();
    } catch (e2) {
      setErr(e2.message);
    }
  }

  return (
    <section className="view-active">
      <div className="page-header page-header--row">
        <div>
          <h1 className="page-title">Medidas</h1>
          <p className="page-sub muted">
            Sufijos de unidad para ítems del catálogo (UND = Unidad, GLN = Galón, etc.)
          </p>
        </div>
        {canWrite && (
          <button type="button" className="btn btn-primary" onClick={openNew}>
            Nueva medida
          </button>
        )}
      </div>

      {err && (
        <div className="banner banner--err mono" style={{ marginBottom: 12 }}>
          {err}
        </div>
      )}

      {canWrite && (
        <label className="chk-row" style={{ marginBottom: 12 }}>
          <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
          <span className="mono">Mostrar inactivas</span>
        </label>
      )}

      <div className="panel panel--flush">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Sufijo</th>
                <th>Nombre</th>
                <th className="num">Orden</th>
                <th>Estado</th>
                {canWrite && <th className="actions-col">Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={canWrite ? 5 : 4} className="muted">
                    Cargando…
                  </td>
                </tr>
              ) : list.length === 0 ? (
                <tr>
                  <td colSpan={canWrite ? 5 : 4} className="muted">
                    Sin medidas registradas.
                  </td>
                </tr>
              ) : (
                list.map((row) => (
                  <tr key={row.id} className={row.active === false ? 'row-dim' : ''}>
                    <td className="mono" style={{ color: 'var(--cyan)' }}>
                      {row.suffix}
                    </td>
                    <td>{row.nombre}</td>
                    <td className="num mono">{row.sortOrder}</td>
                    <td className="mono">{row.active !== false ? 'Activa' : 'Inactiva'}</td>
                    {canWrite && (
                      <td className="actions-cell">
                        <button type="button" className="btn btn-ghost mono" onClick={() => openEdit(row)}>
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
          title={modal === 'new' ? 'Nueva medida' : 'Editar medida'}
          onClose={() => setModal(null)}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setModal(null)}>
                Cancelar
              </button>
              <button type="submit" form="measure-form" className="btn btn-primary">
                Guardar
              </button>
            </>
          }
        >
          <form id="measure-form" className="stack-form" onSubmit={save}>
            <label>
              <span className="fg-lbl">Sufijo *</span>
              <input
                className="form-input mono"
                required
                maxLength={30}
                placeholder="UND"
                value={form.suffix}
                onChange={(e) =>
                  setForm((f) => ({ ...f, suffix: e.target.value.toUpperCase().replace(/\s/g, '') }))
                }
              />
              <span className="muted mono" style={{ fontSize: 11 }}>
                Código corto usado en catálogo y presupuesto (ej. UND, GLN, M2).
              </span>
            </label>
            <label>
              <span className="fg-lbl">Nombre *</span>
              <input
                className="form-input"
                required
                placeholder="Unidad"
                value={form.nombre}
                onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
              />
            </label>
            <label>
              <span className="fg-lbl">Orden</span>
              <input
                type="number"
                className="form-input mono"
                value={form.sortOrder}
                onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value }))}
              />
            </label>
            <label className="chk-row">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
              />
              <span>Activa</span>
            </label>
          </form>
        </Modal>
      )}
    </section>
  );
}
