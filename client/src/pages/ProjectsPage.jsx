import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Modal } from '../components/Modal';
import { ClientPicker } from '../components/ClientPicker';
import { QuotationEstadosGuideContent } from '../components/QuotationEstadosGuideContent';
import { STATUS_LABEL } from '../lib/quotationStatus';
import {
  ProjectFiltersBar,
  useProjectListFilters,
  extractProjectCreators,
} from '../components/ProjectFiltersBar';

export function ProjectsPage() {
  const { hasRole, user, isAdmin, isSuperuser, canShareProjects } = useAuth();
  const canWrite = hasRole('ADMIN', 'COMERCIAL', 'SUPERUSER');
  const showCreatorCol = isSuperuser() || isAdmin();
  const colCount = showCreatorCol ? 7 : 6;

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
  const [formEdit, setFormEdit] = useState({ nombre: '', odooRef: '', clientId: '' });
  const [editBusy, setEditBusy] = useState(false);
  const [formViewer, setFormViewer] = useState({ assignedViewerId: '' });
  const [formShare, setFormShare] = useState([]);
  const [shareUsers, setShareUsers] = useState([]);
  const [shareSelected, setShareSelected] = useState([]);
  const [shareSearch, setShareSearch] = useState('');
  const [shareSearchBusy, setShareSearchBusy] = useState(false);
  const shareSearchTimer = useRef(null);
  const [cloneName, setCloneName] = useState('');
  const [guideOpen, setGuideOpen] = useState(false);
  const [creators, setCreators] = useState([]);

  const { filters, setFilters, query } = useProjectListFilters({
    includeDeleted,
    isAdmin: isAdmin(),
    isSuperuser: isSuperuser(),
  });

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const data = await api.get(`/api/projects${query}`);
      setList(data);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    if (!showCreatorCol) return;
    api
      .get('/api/projects' + ((isSuperuser() || isAdmin()) && includeDeleted ? '?includeDeleted=true' : ''))
      .then((data) => setCreators(extractProjectCreators(data)))
      .catch(() => setCreators([]));
  }, [showCreatorCol, isSuperuser, isAdmin, includeDeleted]);

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

  function openEdit(row) {
    setSel(row);
    setFormEdit({
      nombre: row.nombre || '',
      odooRef: row.odooRef || '',
      clientId: row.clientId || '',
    });
    setModal('edit');
  }

  async function saveEditProject(e) {
    e.preventDefault();
    if (!sel) return;
    setEditBusy(true);
    setErr(null);
    try {
      await api.put(`/api/projects/${sel.id}`, {
        nombre: formEdit.nombre.trim(),
        odooRef: formEdit.odooRef.trim() || null,
        clientId: formEdit.clientId || null,
      });
      setModal(null);
      load();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setEditBusy(false);
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
    if (!isSuperuser()) return;
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

  async function openShare(row) {
    setSel(row);
    setErr(null);
    setShareSearch('');
    try {
      const [shares, users] = await Promise.all([
        api.get(`/api/projects/${row.id}/shares`),
        api.get('/api/users/shareable'),
      ]);
      const ids = (shares || []).map((s) => s.userId);
      setFormShare(ids);
      setShareSelected(
        (shares || []).map((s) => ({
          id: s.userId,
          email: s.email,
          role: s.role,
          nombre: s.nombre,
        }))
      );
      setShareUsers(users || []);
      setModal('share');
    } catch (e2) {
      setErr(e2.message);
    }
  }

  useEffect(() => {
    if (modal !== 'share') return undefined;
    if (shareSearchTimer.current) clearTimeout(shareSearchTimer.current);
    shareSearchTimer.current = setTimeout(async () => {
      setShareSearchBusy(true);
      try {
        const qs = shareSearch.trim() ? `?q=${encodeURIComponent(shareSearch.trim())}` : '';
        const users = await api.get(`/api/users/shareable${qs}`);
        setShareUsers(users || []);
      } catch {
        /* ignore search errors */
      } finally {
        setShareSearchBusy(false);
      }
    }, 300);
    return () => {
      if (shareSearchTimer.current) clearTimeout(shareSearchTimer.current);
    };
  }, [modal, shareSearch]);

  const shareListUsers = useMemo(() => {
    const byId = new Map();
    for (const u of shareSelected) byId.set(u.id, u);
    for (const u of shareUsers) byId.set(u.id, u);
    return [...byId.values()].sort((a, b) => a.email.localeCompare(b.email));
  }, [shareSelected, shareUsers]);

  function toggleShareUser(u) {
    setFormShare((prev) => {
      const on = prev.includes(u.id);
      if (on) {
        setShareSelected((sel) => sel.filter((x) => x.id !== u.id));
        return prev.filter((id) => id !== u.id);
      }
      setShareSelected((sel) => (sel.some((x) => x.id === u.id) ? sel : [...sel, u]));
      return [...prev, u.id];
    });
  }

  async function saveShare(e) {
    e.preventDefault();
    if (!sel) return;
    setErr(null);
    try {
      await api.put(`/api/projects/${sel.id}/shares`, { userIds: formShare });
      setModal(null);
      load();
    } catch (e2) {
      setErr(e2.message);
    }
  }

  function canManageRow(row) {
    if (isSuperuser()) return true;
    return isAdmin() && row.createdBy === user?.id;
  }

  function canEditProjectMeta(row) {
    if (isSuperuser()) return true;
    if (!isAdmin()) return false;
    return row.accessKind === 'own' || row.accessKind === 'team';
  }

  function accessLabel(row) {
    if (row.accessKind === 'own') return null;
    if (row.accessKind === 'shared') {
      const who = row.sharedByName || row.sharedByEmail || 'admin';
      return `Compartido por ${who}`;
    }
    if (row.accessKind === 'team') {
      const who = row.createdByName || row.createdByEmail || 'comercial';
      return `Equipo: ${who}`;
    }
    if (row.accessKind === 'group') {
      const who = row.createdByName || row.createdByEmail || 'admin/comercial';
      return `Grupo: ${who}`;
    }
    if (isSuperuser()) return row.createdByName || row.createdByEmail || '—';
    return null;
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
          {(isSuperuser() || isAdmin()) && (
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

      <ProjectFiltersBar
        filters={filters}
        setFilters={setFilters}
        clients={clients}
        creators={creators}
        showCreatorFilter={showCreatorCol}
      />

      <div className="panel panel--flush">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Estado</th>
                <th>Cliente</th>
                <th>Odoo</th>
                {showCreatorCol && <th>Creador</th>}
                <th>Acceso</th>
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
                    {showCreatorCol && (
                      <td className="mono" style={{ fontSize: 11 }}>
                        {row.createdBy === user?.id
                          ? 'tú'
                          : row.createdByName || row.createdByEmail || row.createdBy?.slice(0, 8) + '…'}
                      </td>
                    )}
                    <td className="mono" style={{ fontSize: 11 }}>
                      {row.accessKind === 'own' && <span className="tag tag--ok">Propio</span>}
                      {row.accessKind === 'shared' && (
                        <span className="tag tag--amber" title={row.sharedByEmail || ''}>
                          Compartido
                        </span>
                      )}
                      {row.accessKind === 'team' && (
                        <span className="tag" style={{ borderColor: 'var(--violet)', color: 'var(--violet)' }}>
                          Equipo
                        </span>
                      )}
                      {row.accessKind === 'group' && (
                        <span className="tag" style={{ borderColor: 'var(--cyan)', color: 'var(--cyan)' }}>
                          Grupo
                        </span>
                      )}
                      {accessLabel(row) && row.accessKind !== 'own' && (
                        <span className="muted" style={{ display: 'block', marginTop: 4 }}>
                          {accessLabel(row)}
                        </span>
                      )}
                    </td>
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
                        {isSuperuser() && (
                          <button
                            type="button"
                            className="btn-action btn-action--muted"
                            title="Historial de cambios (solo superusuario)"
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
                        )}
                        {canShareProjects() && canManageRow(row) && !row.deletedAt && (
                          <button
                            type="button"
                            className="btn-action btn-action--cyan"
                            title="Compartir con otros usuarios"
                            onClick={() => openShare(row)}
                          >
                            <span className="btn-action__ic" aria-hidden>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13" />
                              </svg>
                            </span>
                            Compartir
                          </button>
                        )}
                        {canEditProjectMeta(row) && !row.deletedAt && (
                          <button
                            type="button"
                            className="btn-action"
                            title="Editar nombre, cliente u Odoo"
                            onClick={() => openEdit(row)}
                          >
                            <span className="btn-action__ic" aria-hidden>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M12 20h9" />
                                <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
                              </svg>
                            </span>
                            Editar
                          </button>
                        )}
                        {canManageRow(row) && !row.deletedAt && (
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
                        {canWrite && !row.deletedAt && (
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
              <ClientPicker
                clients={clients}
                value={formNew.clientId}
                onChange={(clientId) => setFormNew((f) => ({ ...f, clientId }))}
                onClientsChange={setClients}
                canCreate={canWrite}
                optional
              />
            </label>
          </form>
        </Modal>
      )}

      {modal === 'edit' && sel && (
        <Modal
          title="Editar proyecto"
          onClose={() => !editBusy && setModal(null)}
          footer={
            <>
              <button type="button" className="btn btn-ghost" disabled={editBusy} onClick={() => setModal(null)}>
                Cancelar
              </button>
              <button type="submit" form="proj-edit-form" className="btn btn-primary" disabled={editBusy}>
                {editBusy ? 'Guardando…' : 'Guardar'}
              </button>
            </>
          }
        >
          <form id="proj-edit-form" className="stack-form" onSubmit={saveEditProject}>
            <label>
              <span className="fg-lbl">Nombre *</span>
              <input
                className="form-input"
                required
                value={formEdit.nombre}
                onChange={(e) => setFormEdit((f) => ({ ...f, nombre: e.target.value }))}
              />
            </label>
            <label>
              <span className="fg-lbl">Referencia Odoo</span>
              <input
                className="form-input mono"
                value={formEdit.odooRef}
                onChange={(e) => setFormEdit((f) => ({ ...f, odooRef: e.target.value }))}
              />
            </label>
            <label>
              <span className="fg-lbl">Cliente (opcional)</span>
              <ClientPicker
                clients={clients}
                value={formEdit.clientId}
                onChange={(clientId) => setFormEdit((f) => ({ ...f, clientId }))}
                onClientsChange={setClients}
                canCreate={isAdmin()}
                optional
              />
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

      {modal === 'share' && sel && (
        <Modal
          title="Compartir proyecto"
          onClose={() => setModal(null)}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setModal(null)}>
                Cancelar
              </button>
              <button type="submit" form="share-form" className="btn btn-primary">
                Guardar
              </button>
            </>
          }
        >
          <p className="muted mono" style={{ marginBottom: 12, fontSize: 12 }}>
            Proyecto: <strong>{sel.nombre}</strong> — seleccione ADMIN o COMERCIAL con acceso de edición.
          </p>
          <form id="share-form" className="stack-form" onSubmit={saveShare}>
            <label>
              <span className="fg-lbl">Buscar usuario</span>
              <input
                type="search"
                className="form-input"
                placeholder="Email o nombre…"
                value={shareSearch}
                onChange={(e) => setShareSearch(e.target.value)}
                autoFocus
              />
            </label>
            {formShare.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                {shareSelected.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    className="tag mono"
                    style={{ cursor: 'pointer' }}
                    onClick={() => toggleShareUser(u)}
                    title="Quitar"
                  >
                    {u.email} ×
                  </button>
                ))}
              </div>
            )}
            <p className="muted mono" style={{ fontSize: 11, marginBottom: 4 }}>
              {shareSearchBusy ? 'Buscando…' : `${formShare.length} seleccionado(s)`}
            </p>
            <div className="stack-form" style={{ maxHeight: 240, overflow: 'auto' }}>
              {shareListUsers.length === 0 ? (
                <p className="muted">No hay usuarios disponibles.</p>
              ) : (
                shareListUsers.map((u) => (
                  <label key={u.id} className="chk mono" style={{ fontSize: 12 }}>
                    <input
                      type="checkbox"
                      checked={formShare.includes(u.id)}
                      onChange={() => toggleShareUser(u)}
                    />
                    {u.email} ({u.role}) {u.nombre ? `— ${u.nombre}` : ''}
                  </label>
                ))
              )}
            </div>
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
                  <th>Actor</th>
                  <th>Detalle</th>
                </tr>
              </thead>
              <tbody>
                {auditRows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="muted">
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
                      <td className="mono" style={{ fontSize: 11 }}>
                        {a.actorName || a.actorEmail || a.actorId?.slice(0, 8) || '—'}
                      </td>
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
