import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, getBlob, postFormData } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Modal } from '../components/Modal';
import { ClientOdooFicha } from '../components/ClientOdooFicha';
import { canWriteClients } from '../lib/userRoles';

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
  street2: '',
  zip: '',
  website: '',
  mobile: '',
  notas: '',
};

export function ClientsPage() {
  const { isSuperuser, user } = useAuth();
  const canWrite = canWriteClients(user);
  const canCreateLocal = isSuperuser();

  const [list, setList] = useState([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [err, setErr] = useState(null);

  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const fileInputRef = useRef(null);
  const [importModal, setImportModal] = useState(false);
  const [importPreview, setImportPreview] = useState(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importApplying, setImportApplying] = useState(false);
  const [includeInactive, setIncludeInactive] = useState(false);

  const fetchList = useCallback(
    async (search) => {
      setLoading(true);
      setErr(null);
      try {
        const params = new URLSearchParams();
        if (search) params.set('q', search);
        if (includeInactive) params.set('includeInactive', 'true');
        params.set('limit', '100');
        const qs = params.toString() ? `?${params.toString()}` : '';
        const data = await api.get(`/api/clients${qs}`);
        setList(Array.isArray(data) ? data : []);
      } catch (e) {
        setErr(e.message);
      } finally {
        setLoading(false);
      }
    },
    [includeInactive]
  );

  useEffect(() => {
    const t = setTimeout(() => fetchList(q), 300);
    return () => clearTimeout(t);
  }, [q, fetchList]);

  useEffect(() => {
    if (!selectedId || !detail?.outbox || detail.outbox.status !== 'pendiente') return undefined;
    const t = setInterval(async () => {
      try {
        const data = await api.get(`/api/clients/${selectedId}`);
        setDetail(data);
        fetchList(q);
      } catch {
        /* ignore */
      }
    }, 3000);
    return () => clearInterval(t);
  }, [selectedId, detail?.outbox?.status, fetchList, q]);

  async function openFicha(row) {
    setSelectedId(row.id);
    setDetailLoading(true);
    setErr(null);
    try {
      const data = await api.get(`/api/clients/${row.id}`);
      setDetail(data);
    } catch (e) {
      setErr(e.message);
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }

  function openNew() {
    setForm(emptyForm);
    setModal('new');
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
    try {
      const created = await api.post('/api/clients', {
        razonSocial: form.razonSocial || undefined,
        ruc: form.ruc || undefined,
        contactoNombre: form.contactoNombre || undefined,
        contactoEmail: form.contactoEmail || undefined,
        contactoTelefono: form.contactoTelefono || undefined,
        ciudad: form.ciudad || undefined,
        direccion: form.direccion || undefined,
        street2: form.street2 || undefined,
        zip: form.zip || undefined,
        website: form.website || undefined,
        mobile: form.mobile || undefined,
        notas: form.notas || undefined,
      });
      setModal(null);
      fetchList(q);
      if (created?.id) openFicha(created);
    } catch (e2) {
      setErr(e2.message);
    }
  }

  return (
    <section className="view-active">
      <div className="page-header page-header--row">
        <div>
          <h1 className="page-title">Clientes</h1>
          <p className="page-sub muted">
            Ficha tipo Odoo. Alta y edición se envían a staging (outbox); el HTTP no espera XML-RPC.
          </p>
        </div>
        <div className="page-header-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-ghost mono" onClick={downloadExcel} disabled={loading}>
            Descargar Excel
          </button>
          {canCreateLocal && (
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
            </>
          )}
          {canWrite && (
            <button type="button" className="btn btn-primary" onClick={openNew}>
              Nuevo cliente
            </button>
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
        <label className="chk mono" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => setIncludeInactive(e.target.checked)}
          />
          Mostrar archivados
        </label>
      </div>

      {err && (
        <div className="banner banner--err mono" style={{ marginBottom: 12 }}>
          {err}
        </div>
      )}

      <div className="clients-odoo-layout">
        <div className="panel panel--flush">
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Razón social</th>
                  <th>RUC</th>
                  <th>Ciudad</th>
                  <th>Origen</th>
                  <th className="num">Proyectos</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5} className="muted mono">
                      Cargando…
                    </td>
                  </tr>
                ) : list.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="muted">
                      Sin resultados
                    </td>
                  </tr>
                ) : (
                  list.map((row) => (
                    <tr
                      key={row.id}
                      className={
                        (row.active === false ? 'row-dim ' : '') +
                        (row.id === selectedId ? 'clients-odoo-row--on' : '')
                      }
                      style={{ cursor: 'pointer' }}
                      onClick={() => openFicha(row)}
                    >
                      <td>{row.razonSocial}</td>
                      <td className="mono">{row.ruc || '—'}</td>
                      <td>{row.ciudad || '—'}</td>
                      <td>
                        {row.outbox?.status === 'pendiente' ? (
                          <span className="tag tag--warn">Enviando</span>
                        ) : row.outbox?.status === 'fallido' || row.outbox?.status === 'conflicto' ? (
                          <span className="tag tag--warn">Error Odoo</span>
                        ) : row.syncOrigin === 'odoo' ? (
                          <span className="tag tag--cyan">Odoo</span>
                        ) : row.syncOrigin === 'linked' ? (
                          <span className="tag tag--ok">Vinculado</span>
                        ) : (
                          <span className="tag tag--warn">Pendiente en Odoo</span>
                        )}
                      </td>
                      <td className="num mono">{row.projectCount ?? 0}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {!loading && list.length >= 100 && (
            <p className="muted mono" style={{ padding: '8px 12px', fontSize: 11 }}>
              Mostrando 100. Refine la búsqueda o pulse una fila para ver la ficha.
            </p>
          )}
        </div>

        <div className="panel odoo-ficha-panel">
          {detailLoading ? (
            <p className="muted mono">Cargando ficha…</p>
          ) : detail ? (
            <ClientOdooFicha
              client={detail}
              ficha={detail.ficha}
              canEdit={canWrite}
              onSaved={(data) => {
                setDetail(data);
                fetchList(q);
              }}
              onClose={() => {
                setDetail(null);
                setSelectedId(null);
              }}
            />
          ) : (
            <p className="muted" style={{ padding: 8 }}>
              Seleccione un cliente para ver la ficha. Con permiso de escritura puede crear y editar; el envío a Odoo
              corre en segundo plano (staging).
            </p>
          )}
        </div>
      </div>

      {importModal && importPreview && canCreateLocal && (
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
            Filas: {importPreview.total}. Alta local (SUPERUSER). No escribe a Odoo.{' '}
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

      {modal === 'new' && canWrite && (
        <Modal
          title="Nuevo cliente"
          onClose={() => setModal(null)}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setModal(null)}>
                Cancelar
              </button>
              <button type="submit" form="client-form" className="btn btn-primary">
                Crear y enviar a Odoo
              </button>
            </>
          }
        >
          <p className="muted mono" style={{ fontSize: 11, marginBottom: 10 }}>
            Con un RUC de 11 dígitos, al guardar se consulta SUNAT (vía Odoo) y se completan razón social y
            dirección. Correo y teléfono no vienen de SUNAT.
          </p>
          <form id="client-form" className="stack-form" onSubmit={submitClient}>
            <label>
              <span className="fg-lbl">RUC</span>
              <input
                className="form-input mono"
                value={form.ruc}
                onChange={(e) => setForm((f) => ({ ...f, ruc: e.target.value }))}
                placeholder="11 dígitos — consulta SUNAT al guardar"
              />
            </label>
            <label>
              <span className="fg-lbl">Razón social</span>
              <input
                className="form-input"
                value={form.razonSocial}
                onChange={(e) => setForm((f) => ({ ...f, razonSocial: e.target.value }))}
                placeholder="Opcional si hay RUC válido"
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
              <span className="fg-lbl">Móvil</span>
              <input
                className="form-input mono"
                value={form.mobile || ''}
                onChange={(e) => setForm((f) => ({ ...f, mobile: e.target.value }))}
              />
            </label>
            <label>
              <span className="fg-lbl">Sitio web</span>
              <input
                className="form-input mono"
                value={form.website || ''}
                onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))}
                placeholder="https://…"
              />
            </label>
            <label>
              <span className="fg-lbl">Dirección (calle)</span>
              <textarea
                className="form-input form-textarea"
                rows={2}
                value={form.direccion}
                onChange={(e) => setForm((f) => ({ ...f, direccion: e.target.value }))}
              />
            </label>
            <label>
              <span className="fg-lbl">Calle 2</span>
              <input
                className="form-input"
                value={form.street2 || ''}
                onChange={(e) => setForm((f) => ({ ...f, street2: e.target.value }))}
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
              <span className="fg-lbl">Código postal</span>
              <input
                className="form-input mono"
                value={form.zip || ''}
                onChange={(e) => setForm((f) => ({ ...f, zip: e.target.value }))}
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
