import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Modal } from '../components/Modal';
import { QuotationEstadosGuideContent } from '../components/QuotationEstadosGuideContent';
import { STATUS_LABEL } from '../lib/quotationStatus';

export function ProjectsPage() {
  const { hasRole, user } = useAuth();
  const isAdmin = hasRole('ADMIN');
  const canWrite = hasRole('ADMIN', 'COMERCIAL');
  const colCount = isAdmin ? 6 : 5;

  const [list, setList] = useState([]);
  const [clients, setClients] = useState([]);
  const [viewers, setViewers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [err, setErr] = useState(null);

  const [modal, setModal] = useState(null);
  const [sel, setSel] = useState(null);
  const [auditRows, setAuditRows] = useState([]);

  const [formNew, setFormNew] = useState({ nombre: '', odooRef: '', clientId: '' });
  const [formViewer, setFormViewer] = useState({ assignedViewerId: '' });
  const [cloneName, setCloneName] = useState('');
  const [guideOpen, setGuideOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const qs = isAdmin && includeDeleted ? '?includeDeleted=true' : '';
      const data = await api.get(`/api/projects${qs}`);
      setList(data);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [isAdmin, includeDeleted]);

  const loadMeta = useCallback(async () => {
    try {
      const [cl, vw] = await Promise.all([
        api.get('/api/clients'),
        canWrite ? api.get('/api/users/viewers') : Promise.resolve([]),
      ]);
      setClients(cl);
      setViewers(vw);
    } catch {
      /* opcional */
    }
  }, [canWrite]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  async function createProject(e) {
    e.preventDefault();
    setErr(null);
    try {
      await api.post('/api/projects', {
        nombre: formNew.nombre,
        odooRef: formNew.odooRef || undefined,
        clientId: formNew.clientId || undefined,
      });
      setModal(null);
      setFormNew({ nombre: '', odooRef: '', clientId: '' });
      load();
    } catch (e2) {
      setErr(e2.message);
    }
  }

  async function assignViewer(e) {
    e.preventDefault();
    if (!sel) return;
    setErr(null);
    try {
      await api.patch(`/api/projects/${sel.id}/viewer`, {
        assignedViewerId: formViewer.assignedViewerId || null,
      });
      setModal(null);
      load();
    } catch (e2) {
      setErr(e2.message);
    }
  }

  async function doClone() {
    if (!sel) return;
    setErr(null);
    try {
      await api.post(`/api/projects/${sel.id}/clone`, {
        nombre: cloneName || undefined,
      });
      setModal(null);
      load();
    } catch (e2) {
      setErr(e2.message);
    }
  }

  async function softDelete(row) {
    if (!window.confirm(`¿Archivar proyecto "${row.nombre}"?`)) return;
    setErr(null);
    try {
      await api.del(`/api/projects/${row.id}`);
      load();
    } catch (e2) {
      setErr(e2.message);
    }
  }

  async function openAudit(row) {
    setSel(row);
    setErr(null);
    try {
      const data = await api.get(`/api/projects/${row.id}/audit`);
      setAuditRows(data);
      setModal('audit');
    } catch (e2) {
      setErr(e2.message);
    }
  }

  function openViewer(row) {
    setSel(row);
    setFormViewer({ assignedViewerId: row.assignedViewer || '' });
    setModal('viewer');
  }

  function openClone(row) {
    setSel(row);
    setCloneName(`Copia de ${row.nombre}`);
    setModal('clone');
  }

  return (
    <section className="view-active">
      <div className="page-header page-header--row">
        <div>
          <h1 className="page-title">Proyectos</h1>
          <p className="page-sub muted">
            {canWrite ? 'Gestión y clonado · asignación VIEWER' : 'Proyectos asignados a tu usuario'}
          </p>
        </div>
        <div className="page-header-actions">
          {isAdmin && (
            <label className="chk mono" style={{ fontSize: 11 }}>
              <input
                type="checkbox"
                checked={includeDeleted}
                onChange={(e) => setIncludeDeleted(e.target.checked)}
              />
              Ver archivados
            </label>
          )}
          <button
            type="button"
            className="btn btn-ghost mono"
            style={{ fontSize: 11 }}
            onClick={() => setGuideOpen(true)}
          >
            Guía de estados
          </button>
          {canWrite && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setFormNew({ nombre: '', odooRef: '', clientId: '' });
                setModal('new');
              }}
            >
              Nuevo proyecto
            </button>
          )}
        </div>
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
                <th>Nombre</th>
                <th>Estado</th>
                <th>Cliente</th>
                <th>Odoo</th>
                {isAdmin && <th>Owner</th>}
                <th className="actions-col">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={colCount} className="muted mono">
                    Cargando…
                  </td>
                </tr>
              ) : list.length === 0 ? (
                <tr>
                  <td colSpan={colCount} className="muted">
                    Sin proyectos
                  </td>
                </tr>
              ) : (
                list.map((row) => (
                  <tr key={row.id} className={row.deletedAt ? 'row-dim' : ''}>
                    <td>
                      {row.nombre}
                      {row.deletedAt && (
                        <span className="tag tag--muted mono" style={{ marginLeft: 8 }}>
                          archivado
                        </span>
                      )}
                    </td>
                    <td>
                      <span className="mono status-pill">{STATUS_LABEL[row.status] || row.status}</span>
                    </td>
                    <td>{row.clientRazonSocial || '—'}</td>
                    <td className="mono">{row.odooRef || '—'}</td>
                    {isAdmin && (
                      <td className="mono" style={{ fontSize: 11 }}>
                        {row.createdBy === user?.id ? 'tú' : row.createdBy?.slice(0, 8) + '…'}
                      </td>
                    )}
                    <td className="actions-cell">
                      <div className="proj-actions">
                        <Link
                          className="btn-action"
                          to={`/projects/${row.id}/presupuesto`}
                          title="Presupuesto e ítems"
                        >
                          <span className="btn-action__ic" aria-hidden>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <rect x="3" y="3" width="18" height="18" rx="2" />
                              <path d="M3 9h18M9 21V9" />
                            </svg>
                          </span>
                          Presupuesto
                        </Link>
                        <Link className="btn-action" to={`/projects/${row.id}/planos`} title="Planos técnicos">
                          <span className="btn-action__ic" aria-hidden>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polygon points="12 2 2 7 12 12 22 7 12 2" />
                              <polyline points="2 17 12 22 22 17" />
                              <polyline points="2 12 12 17 22 12" />
                            </svg>
                          </span>
                          Planos
                        </Link>
                        <button
                          type="button"
                          className="btn-action btn-action--muted"
                          title="Historial de cambios"
                          onClick={() => openAudit(row)}
                        >
                          <span className="btn-action__ic" aria-hidden>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                              <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
                            </svg>
                          </span>
                          Auditoría
                        </button>
                        {canWrite && !row.deletedAt && (
                          <>
                            <button
                              type="button"
                              className="btn-action btn-action--amber"
                              title="Usuario VIEWER del proyecto"
                              onClick={() => openViewer(row)}
                            >
                              <span className="btn-action__ic" aria-hidden>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                  <circle cx="12" cy="12" r="3" />
                                </svg>
                              </span>
                              VIEWER
                            </button>
                            <button
                              type="button"
                              className="btn-action btn-action--violet"
                              title="Duplicar proyecto"
                              onClick={() => openClone(row)}
                            >
                              <span className="btn-action__ic" aria-hidden>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <rect x="9" y="9" width="13" height="13" rx="2" />
                                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                </svg>
                              </span>
                              Clonar
                            </button>
                            <button
                              type="button"
                              className="btn-action btn-action--danger"
                              title="Archivar proyecto"
                              onClick={() => softDelete(row)}
                            >
                              <span className="btn-action__ic" aria-hidden>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <polyline points="21 8 21 21 3 21 3 8" />
                                  <rect x="1" y="3" width="22" height="5" />
                                  <line x1="10" y1="12" x2="14" y2="12" />
                                </svg>
                              </span>
                              Archivar
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modal === 'new' && (
        <Modal
          title="Nuevo proyecto"
          onClose={() => setModal(null)}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setModal(null)}>
                Cancelar
              </button>
              <button type="submit" form="proj-new-form" className="btn btn-primary">
                Crear
              </button>
            </>
          }
        >
          <form id="proj-new-form" className="stack-form" onSubmit={createProject}>
            <label>
              <span className="fg-lbl">Nombre *</span>
              <input
                className="form-input"
                required
                value={formNew.nombre}
                onChange={(e) => setFormNew((f) => ({ ...f, nombre: e.target.value }))}
              />
            </label>
            <label>
              <span className="fg-lbl">Referencia Odoo</span>
              <input
                className="form-input mono"
                value={formNew.odooRef}
                onChange={(e) => setFormNew((f) => ({ ...f, odooRef: e.target.value }))}
              />
            </label>
            <label>
              <span className="fg-lbl">Cliente (opcional)</span>
              <select
                className="form-input"
                value={formNew.clientId}
                onChange={(e) => setFormNew((f) => ({ ...f, clientId: e.target.value }))}
              >
                <option value="">—</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.razonSocial}
                  </option>
                ))}
              </select>
            </label>
          </form>
        </Modal>
      )}

      {modal === 'viewer' && sel && (
        <Modal
          title="Asignar VIEWER"
          onClose={() => setModal(null)}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setModal(null)}>
                Cancelar
              </button>
              <button type="submit" form="viewer-form" className="btn btn-primary">
                Guardar
              </button>
            </>
          }
        >
          <p className="muted mono" style={{ marginBottom: 12, fontSize: 12 }}>
            Proyecto: <strong>{sel.nombre}</strong>
          </p>
          <form id="viewer-form" className="stack-form" onSubmit={assignViewer}>
            <label>
              <span className="fg-lbl">Usuario VIEWER</span>
              <select
                className="form-input"
                value={formViewer.assignedViewerId}
                onChange={(e) => setFormViewer({ assignedViewerId: e.target.value })}
              >
                <option value="">— Sin asignar —</option>
                {viewers.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.email}
                  </option>
                ))}
              </select>
            </label>
          </form>
        </Modal>
      )}

      {modal === 'clone' && sel && (
        <Modal
          title="Clonar proyecto"
          onClose={() => setModal(null)}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setModal(null)}>
                Cancelar
              </button>
              <button type="button" className="btn btn-primary" onClick={doClone}>
                Clonar
              </button>
            </>
          }
        >
          <p className="muted mono" style={{ fontSize: 12, marginBottom: 12 }}>
            Se copian ítems de presupuesto y parámetros financieros. No se copian planos.
          </p>
          <label>
            <span className="fg-lbl">Nombre del nuevo proyecto</span>
            <input
              className="form-input"
              value={cloneName}
              onChange={(e) => setCloneName(e.target.value)}
            />
          </label>
        </Modal>
      )}

      {modal === 'audit' && sel && (
        <Modal
          wide
          title="Historial de auditoría"
          onClose={() => setModal(null)}
        >
          <p className="muted mono" style={{ fontSize: 12, marginBottom: 12 }}>
            {sel.nombre}
          </p>
          <div className="table-wrap" style={{ maxHeight: 360, overflow: 'auto' }}>
            <table className="data-table data-table--compact">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Evento</th>
                  <th>Detalle</th>
                </tr>
              </thead>
              <tbody>
                {auditRows.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="muted">
                      Sin eventos
                    </td>
                  </tr>
                ) : (
                  auditRows.map((a) => (
                    <tr key={a.id}>
                      <td className="mono" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                        {new Date(a.createdAt).toLocaleString()}
                      </td>
                      <td className="mono">{a.eventType}</td>
                      <td className="mono audit-json">
                        <pre>{JSON.stringify({ prev: a.prevData, next: a.newData }, null, 0)}</pre>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Modal>
      )}

      {guideOpen && (
        <Modal
          title="Guía: ciclo de vida de la cotización"
          wide
          onClose={() => setGuideOpen(false)}
          footer={
            <button type="button" className="btn btn-primary" onClick={() => setGuideOpen(false)}>
              Cerrar
            </button>
          }
        >
          <QuotationEstadosGuideContent />
        </Modal>
      )}
    </section>
  );
}
