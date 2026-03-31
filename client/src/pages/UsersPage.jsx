import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api, getBlob, postFormData } from '../lib/api';
import { Modal } from '../components/Modal';

const ISSUE_LABELS = {
  FALTA_EMAIL: 'Falta email',
  EMAIL_INVALIDO: 'Email inválido',
  EMAIL_DUP_LOTE: 'Email repetido en el archivo',
  EMAIL_EN_BD: 'Email ya registrado',
  PASSWORD_INVALIDO: 'Contraseña obligatoria (mín. 8 caracteres)',
  ROL_INVALIDO: 'Rol inválido (ADMIN, COMERCIAL, VIEWER)',
  FALTA_NOMBRES: 'Nombres obligatorios para este rol',
  FALTA_APELLIDOS: 'Apellidos obligatorios para este rol',
};

const ROLES = [
  { value: 'ADMIN', label: 'ADMIN' },
  { value: 'COMERCIAL', label: 'COMERCIAL' },
  { value: 'VIEWER', label: 'VIEWER' },
];

const emptyCreate = {
  email: '',
  password: '',
  role: 'COMERCIAL',
  nombres: '',
  apellidos: '',
  cargo: '',
  telefono: '',
  dni: '',
};

export function UsersPage() {
  const { hasRole, user: me } = useAuth();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [modal, setModal] = useState(null);
  const [createForm, setCreateForm] = useState(emptyCreate);
  const [editForm, setEditForm] = useState(null);

  const fileInputRef = useRef(null);
  const pendingFileRef = useRef(null);
  const [importModal, setImportModal] = useState(false);
  const [importPreview, setImportPreview] = useState(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importApplying, setImportApplying] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const data = await api.get('/api/users');
      setList(data);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!hasRole('ADMIN')) {
    return <Navigate to="/dashboard" replace />;
  }

  function openCreate() {
    setCreateForm(emptyCreate);
    setModal('create');
  }

  async function submitCreate(e) {
    e.preventDefault();
    setErr(null);
    const body = {
      email: createForm.email.trim().toLowerCase(),
      password: createForm.password,
      role: createForm.role,
    };
    if (createForm.role !== 'VIEWER') {
      body.nombres = createForm.nombres.trim();
      body.apellidos = createForm.apellidos.trim();
      if (createForm.cargo) body.cargo = createForm.cargo;
      if (createForm.telefono) body.telefono = createForm.telefono;
      if (createForm.dni) body.dni = createForm.dni;
    }
    try {
      await api.post('/api/users', body);
      setModal(null);
      load();
    } catch (e2) {
      setErr(e2.message);
    }
  }

  async function openEdit(row) {
    setErr(null);
    try {
      const data = await api.get(`/api/users/${row.id}`);
      setEditForm({
        id: data.id,
        email: data.email,
        role: data.role,
        active: data.active,
        password: '',
        nombres: data.nombres || '',
        apellidos: data.apellidos || '',
        cargo: data.cargo || '',
        telefono: data.telefono || '',
        dni: data.dni || '',
        notas: data.notas || '',
      });
      setModal('edit');
    } catch (e2) {
      setErr(e2.message);
    }
  }

  async function submitEdit(e) {
    e.preventDefault();
    if (!editForm) return;
    setErr(null);
    try {
      const body = {
        role: editForm.role,
        active: editForm.active,
        nombres: editForm.nombres || undefined,
        apellidos: editForm.apellidos || undefined,
        cargo: editForm.cargo || undefined,
        telefono: editForm.telefono || undefined,
        dni: editForm.dni || undefined,
        notas: editForm.notas || undefined,
      };
      if (editForm.password && editForm.password.length >= 8) {
        body.password = editForm.password;
      }
      await api.put(`/api/users/${editForm.id}`, body);
      setModal(null);
      setEditForm(null);
      load();
    } catch (e2) {
      setErr(e2.message);
    }
  }

  async function downloadExcel() {
    setErr(null);
    try {
      const blob = await getBlob('/api/users/export');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'zgroup-usuarios.xlsx';
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
    pendingFileRef.current = f;
    setErr(null);
    setImportBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      const data = await postFormData('/api/users/import/preview', fd);
      setImportPreview(data);
      setImportModal(true);
    } catch (e2) {
      pendingFileRef.current = null;
      setErr(e2.message);
    } finally {
      setImportBusy(false);
    }
  }

  async function applyExcelImport() {
    const f = pendingFileRef.current;
    if (!f || !importPreview?.canApply) return;
    setErr(null);
    setImportApplying(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      await postFormData('/api/users/import/apply', fd);
      setImportModal(false);
      setImportPreview(null);
      pendingFileRef.current = null;
      load();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setImportApplying(false);
    }
  }

  async function deactivate(row) {
    if (row.id === me?.id) {
      setErr('No puedes desactivar tu propio usuario');
      return;
    }
    if (!window.confirm(`¿Desactivar a ${row.email}?`)) return;
    setErr(null);
    try {
      await api.del(`/api/users/${row.id}`);
      load();
    } catch (e2) {
      setErr(e2.message);
    }
  }

  return (
    <section className="view-active">
      <div className="page-header page-header--row">
        <div>
          <h1 className="page-title">Usuarios</h1>
          <p className="page-sub muted">Alta, roles y desactivación (solo ADMIN)</p>
        </div>
        <div className="page-header-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-ghost mono" onClick={downloadExcel} disabled={loading}>
            Descargar Excel
          </button>
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
          <button type="button" className="btn btn-primary" onClick={openCreate}>
            Nuevo usuario
          </button>
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
                <th>Email</th>
                <th>Rol</th>
                <th>Nombre</th>
                <th>Estado</th>
                <th className="actions-col">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="muted mono">
                    Cargando…
                  </td>
                </tr>
              ) : (
                list.map((row) => (
                  <tr key={row.id} className={!row.active ? 'row-dim' : ''}>
                    <td className="mono" style={{ fontSize: 12 }}>
                      {row.email}
                    </td>
                    <td>
                      <span className="mono">{row.role}</span>
                    </td>
                    <td>
                      {row.nombres
                        ? `${row.nombres} ${row.apellidos || ''}`.trim()
                        : '—'}
                    </td>
                    <td>{row.active ? <span className="tag tag--ok">Activo</span> : <span className="tag tag--off">Inactivo</span>}</td>
                    <td className="actions-cell">
                      <button type="button" className="btn-link mono" onClick={() => openEdit(row)}>
                        Editar
                      </button>
                      {row.active && row.id !== me?.id && (
                        <button type="button" className="btn-link btn-link--danger mono" onClick={() => deactivate(row)}>
                          Desactivar
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {importModal && importPreview && (
        <Modal
          wide
          title="Previsualización de importación"
          onClose={() => {
            setImportModal(false);
            setImportPreview(null);
            pendingFileRef.current = null;
          }}
          footer={
            <>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setImportModal(false);
                  setImportPreview(null);
                  pendingFileRef.current = null;
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
            Filas: {importPreview.total}. Email y contraseña (mín. 8) obligatorios; rol ADMIN/COMERCIAL requiere nombres y
            apellidos. La confirmación vuelve a enviar el mismo archivo (las contraseñas no viajan por JSON).{' '}
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
                  <th>Email</th>
                  <th>Rol</th>
                  <th>Nombres</th>
                  <th>Apellidos</th>
                  <th>Contraseña</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {importPreview.rows.map((r) => (
                  <tr key={r.rowIndex} className={r.issues?.length ? 'catalog-import-row--err' : ''}>
                    <td className="mono">{r.rowIndex}</td>
                    <td className="mono">{r.email}</td>
                    <td className="mono">{r.role}</td>
                    <td>{r.nombres || '—'}</td>
                    <td>{r.apellidos || '—'}</td>
                    <td className="mono">{r.passwordOk ? '✓ OK (≥8)' : '✗'}</td>
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

      {modal === 'create' && (
        <Modal
          title="Nuevo usuario"
          onClose={() => setModal(null)}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setModal(null)}>
                Cancelar
              </button>
              <button type="submit" form="user-create-form" className="btn btn-primary">
                Crear
              </button>
            </>
          }
        >
          <form id="user-create-form" className="stack-form" onSubmit={submitCreate}>
            <label>
              <span className="fg-lbl">Email *</span>
              <input
                className="form-input mono"
                type="email"
                required
                autoComplete="off"
                value={createForm.email}
                onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))}
              />
            </label>
            <label>
              <span className="fg-lbl">Contraseña * (mín. 8)</span>
              <input
                className="form-input mono"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={createForm.password}
                onChange={(e) => setCreateForm((f) => ({ ...f, password: e.target.value }))}
              />
            </label>
            <label>
              <span className="fg-lbl">Rol *</span>
              <select
                className="form-input"
                value={createForm.role}
                onChange={(e) => setCreateForm((f) => ({ ...f, role: e.target.value }))}
              >
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            {createForm.role !== 'VIEWER' && (
              <>
                <label>
                  <span className="fg-lbl">Nombres *</span>
                  <input
                    className="form-input"
                    required
                    value={createForm.nombres}
                    onChange={(e) => setCreateForm((f) => ({ ...f, nombres: e.target.value }))}
                  />
                </label>
                <label>
                  <span className="fg-lbl">Apellidos *</span>
                  <input
                    className="form-input"
                    required
                    value={createForm.apellidos}
                    onChange={(e) => setCreateForm((f) => ({ ...f, apellidos: e.target.value }))}
                  />
                </label>
                <label>
                  <span className="fg-lbl">Cargo</span>
                  <input
                    className="form-input"
                    value={createForm.cargo}
                    onChange={(e) => setCreateForm((f) => ({ ...f, cargo: e.target.value }))}
                  />
                </label>
                <label>
                  <span className="fg-lbl">Teléfono</span>
                  <input
                    className="form-input mono"
                    value={createForm.telefono}
                    onChange={(e) => setCreateForm((f) => ({ ...f, telefono: e.target.value }))}
                  />
                </label>
                <label>
                  <span className="fg-lbl">DNI</span>
                  <input
                    className="form-input mono"
                    value={createForm.dni}
                    onChange={(e) => setCreateForm((f) => ({ ...f, dni: e.target.value }))}
                  />
                </label>
              </>
            )}
            {createForm.role === 'VIEWER' && (
              <p className="muted mono" style={{ fontSize: 12 }}>
                Los usuarios VIEWER no tienen ficha de empleado; solo acceso de lectura a proyectos asignados.
              </p>
            )}
          </form>
        </Modal>
      )}

      {modal === 'edit' && editForm && (
        <Modal
          title="Editar usuario"
          onClose={() => {
            setModal(null);
            setEditForm(null);
          }}
          footer={
            <>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setModal(null);
                  setEditForm(null);
                }}
              >
                Cancelar
              </button>
              <button type="submit" form="user-edit-form" className="btn btn-primary">
                Guardar
              </button>
            </>
          }
        >
          <form id="user-edit-form" className="stack-form" onSubmit={submitEdit}>
            <p className="mono muted" style={{ fontSize: 12, marginBottom: 8 }}>
              {editForm.email}
            </p>
            <label>
              <span className="fg-lbl">Nueva contraseña (opcional, mín. 8)</span>
              <input
                className="form-input mono"
                type="password"
                minLength={8}
                autoComplete="new-password"
                placeholder="••••••••"
                value={editForm.password}
                onChange={(e) => setEditForm((f) => ({ ...f, password: e.target.value }))}
              />
            </label>
            <label>
              <span className="fg-lbl">Rol</span>
              <select
                className="form-input"
                value={editForm.role}
                onChange={(e) => setEditForm((f) => ({ ...f, role: e.target.value }))}
              >
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="chk-row">
              <input
                type="checkbox"
                checked={editForm.active}
                onChange={(e) => setEditForm((f) => ({ ...f, active: e.target.checked }))}
                disabled={editForm.id === me?.id}
              />
              <span>Usuario activo</span>
            </label>
            {editForm.role !== 'VIEWER' && (
              <>
                <label>
                  <span className="fg-lbl">Nombres</span>
                  <input
                    className="form-input"
                    value={editForm.nombres}
                    onChange={(e) => setEditForm((f) => ({ ...f, nombres: e.target.value }))}
                  />
                </label>
                <label>
                  <span className="fg-lbl">Apellidos</span>
                  <input
                    className="form-input"
                    value={editForm.apellidos}
                    onChange={(e) => setEditForm((f) => ({ ...f, apellidos: e.target.value }))}
                  />
                </label>
                <label>
                  <span className="fg-lbl">Cargo</span>
                  <input
                    className="form-input"
                    value={editForm.cargo}
                    onChange={(e) => setEditForm((f) => ({ ...f, cargo: e.target.value }))}
                  />
                </label>
                <label>
                  <span className="fg-lbl">Teléfono</span>
                  <input
                    className="form-input mono"
                    value={editForm.telefono}
                    onChange={(e) => setEditForm((f) => ({ ...f, telefono: e.target.value }))}
                  />
                </label>
                <label>
                  <span className="fg-lbl">DNI</span>
                  <input
                    className="form-input mono"
                    value={editForm.dni}
                    onChange={(e) => setEditForm((f) => ({ ...f, dni: e.target.value }))}
                  />
                </label>
                <label>
                  <span className="fg-lbl">Notas</span>
                  <textarea
                    className="form-input form-textarea"
                    rows={2}
                    value={editForm.notas}
                    onChange={(e) => setEditForm((f) => ({ ...f, notas: e.target.value }))}
                  />
                </label>
              </>
            )}
          </form>
        </Modal>
      )}
    </section>
  );
}
