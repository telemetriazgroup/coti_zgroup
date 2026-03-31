import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, getBlob, postFormData } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Modal } from '../components/Modal';

const ISSUE_LABELS = {
  FALTA_RAZON_SOCIAL: 'Falta razón social',
  RAZON_DUP_LOTE: 'Razón social repetida en el archivo',
  RAZON_EN_BD: 'Razón social ya existe en el sistema',
  RUC_VACIO_INVALIDO: 'RUC con caracteres no numéricos inválidos',
  RUC_FORMATO: 'RUC debe tener 11 dígitos (Perú) o dejar vacío',
  RUC_DUP_LOTE: 'RUC repetido en el archivo',
  RUC_EN_BD: 'RUC ya registrado',
  EMAIL_INVALIDO: 'Email inválido',
};

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

  const fileInputRef = useRef(null);
  const [importModal, setImportModal] = useState(false);
  const [importPreview, setImportPreview] = useState(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importApplying, setImportApplying] = useState(false);

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

  async function downloadExcel() {
    setErr(null);
    try {
      const blob = await getBlob('/api/clients/export');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'zgroup-clientes.xlsx';
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setErr(e.message);
    }
  }

  async function onImportFile(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setErr(null);
    setImportBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      const data = await postFormData('/api/clients/import/preview', fd);
      setImportPreview(data);
      setImportModal(true);
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setImportBusy(false);
    }
  }

  async function applyExcelImport() {
    if (!importPreview?.canApply || !importPreview.rows?.length) return;
    setErr(null);
    setImportApplying(true);
    try {
      await api.post('/api/clients/import/apply', { rows: importPreview.rows });
      setImportModal(false);
      setImportPreview(null);
      fetchList(q);
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setImportApplying(false);
    }
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
        <div className="page-header-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-ghost mono" onClick={downloadExcel} disabled={loading}>
            Descargar Excel
          </button>
          {canWrite && (
            <>
              <button
                type="button"
                className="btn btn-ghost mono"
                disabled={loading || importBusy}
                onClick={() => fileInputRef.current?.click()}
              >
                {importBusy ? 'Leyendo…' : 'Importar Excel…'}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                style={{ display: 'none' }}
                onChange={onImportFile}
              />
              <button type="button" className="btn btn-primary" onClick={openNew}>
                Nuevo cliente
              </button>
            </>
          )}
        </div>
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

      {importModal && importPreview && canWrite && (
        <Modal
          wide
          title="Previsualización de importación"
          onClose={() => {
            setImportModal(false);
            setImportPreview(null);
          }}
          footer={
            <>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setImportModal(false);
                  setImportPreview(null);
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!importPreview.canApply || importApplying}
                onClick={applyExcelImport}
              >
                {importApplying ? 'Importando…' : 'Confirmar importación'}
              </button>
            </>
          }
        >
          <p className="muted mono" style={{ fontSize: 12, marginBottom: 10 }}>
            Filas: {importPreview.total}. Se valida razón social y RUC (11 dígitos) frente al archivo y a la base.{' '}
            {importPreview.canApply ? (
              <span style={{ color: 'var(--green)' }}>Listo para importar.</span>
            ) : (
              <span style={{ color: 'var(--red)' }}>Corrija el archivo y vuelva a subir.</span>
            )}
          </p>
          <div className="table-wrap catalog-import-table-wrap">
            <table className="data-table data-table--compact">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Razón social</th>
                  <th>RUC</th>
                  <th>Contacto</th>
                  <th>Email</th>
                  <th>Ciudad</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {importPreview.rows.map((r) => (
                  <tr key={r.rowIndex} className={r.issues?.length ? 'catalog-import-row--err' : ''}>
                    <td className="mono">{r.rowIndex}</td>
                    <td>{r.razonSocial}</td>
                    <td className="mono">{r.rucDisplay || '—'}</td>
                    <td>{r.contactoNombre || '—'}</td>
                    <td className="mono">{r.contactoEmail || '—'}</td>
                    <td>{r.ciudad || '—'}</td>
                    <td className="mono" style={{ fontSize: 10, lineHeight: 1.35 }}>
                      {r.issues?.length ? (
                        r.issues.map((code) => (
                          <div key={code} className="catalog-issue-tag" title={code}>
                            {ISSUE_LABELS[code] || code}
                          </div>
                        ))
                      ) : (
                        <span style={{ color: 'var(--green)' }}>OK</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}

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
