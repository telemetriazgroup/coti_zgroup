import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { Modal } from '../components/Modal';

function emptyForm() {
  return {
    nombres: '',
    apellidos: '',
    cargo: '',
    telefono: '',
    dni: '',
    fotoUrl: '',
    fechaIngreso: '',
    notas: '',
  };
}

function employeeToForm(emp) {
  if (!emp) return emptyForm();
  return {
    nombres: emp.nombres || '',
    apellidos: emp.apellidos || '',
    cargo: emp.cargo || '',
    telefono: emp.telefono || '',
    dni: emp.dni || '',
    fotoUrl: emp.fotoUrl || '',
    fechaIngreso: emp.fechaIngreso ? String(emp.fechaIngreso).slice(0, 10) : '',
    notas: emp.notas || '',
  };
}

function FormFields({ form, setForm }) {
  return (
    <>
      <div className="form-grid">
        <label className="fg-item">
          <span className="fg-lbl">Nombres</span>
          <input
            className="form-input"
            value={form.nombres}
            onChange={(e) => setForm((f) => ({ ...f, nombres: e.target.value }))}
            required
          />
        </label>
        <label className="fg-item">
          <span className="fg-lbl">Apellidos</span>
          <input
            className="form-input"
            value={form.apellidos}
            onChange={(e) => setForm((f) => ({ ...f, apellidos: e.target.value }))}
            required
          />
        </label>
        <label className="fg-item">
          <span className="fg-lbl">Cargo</span>
          <input
            className="form-input"
            value={form.cargo}
            onChange={(e) => setForm((f) => ({ ...f, cargo: e.target.value }))}
          />
        </label>
        <label className="fg-item">
          <span className="fg-lbl">Teléfono</span>
          <input
            className="form-input"
            value={form.telefono}
            onChange={(e) => setForm((f) => ({ ...f, telefono: e.target.value }))}
          />
        </label>
        <label className="fg-item">
          <span className="fg-lbl">DNI</span>
          <input
            className="form-input"
            value={form.dni}
            onChange={(e) => setForm((f) => ({ ...f, dni: e.target.value }))}
          />
        </label>
        <label className="fg-item">
          <span className="fg-lbl">Fecha ingreso</span>
          <input
            type="date"
            className="form-input"
            value={form.fechaIngreso}
            onChange={(e) => setForm((f) => ({ ...f, fechaIngreso: e.target.value }))}
          />
        </label>
        <label className="fg-item fg-item--full">
          <span className="fg-lbl">URL foto</span>
          <input
            className="form-input"
            value={form.fotoUrl}
            onChange={(e) => setForm((f) => ({ ...f, fotoUrl: e.target.value }))}
            placeholder="https://…"
          />
        </label>
        <label className="fg-item fg-item--full">
          <span className="fg-lbl">Notas</span>
          <textarea
            className="form-input form-textarea"
            rows={3}
            value={form.notas}
            onChange={(e) => setForm((f) => ({ ...f, notas: e.target.value }))}
          />
        </label>
      </div>
    </>
  );
}

function payloadFromForm(form) {
  return {
    nombres: form.nombres || undefined,
    apellidos: form.apellidos || undefined,
    cargo: form.cargo || undefined,
    telefono: form.telefono || undefined,
    dni: form.dni || undefined,
    fotoUrl: form.fotoUrl || undefined,
    fechaIngreso: form.fechaIngreso || undefined,
    notas: form.notas || undefined,
  };
}

/** Perfil del usuario autenticado (COMERCIAL / ADMIN con ficha) */
function MyEmployeeCard() {
  const [loading, setLoading] = useState(true);
  const [employee, setEmployee] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const data = await api.get('/api/employees/me');
      const emp = data.employee;
      setEmployee(emp);
      if (emp) setForm(employeeToForm(emp));
    } catch (e) {
      setErr(e.message || 'Error al cargar');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save(e) {
    e.preventDefault();
    setMsg(null);
    setErr(null);
    try {
      const data = await api.put('/api/employees/me', payloadFromForm(form));
      setEmployee(data.employee);
      setMsg('Cambios guardados');
    } catch (e) {
      setErr(e.message || 'Error al guardar');
    }
  }

  if (loading) {
    return (
      <section className="view-active">
        <p className="muted mono">Cargando…</p>
      </section>
    );
  }

  if (!employee) {
    return (
      <section className="view-active">
        <div className="page-header">
          <h1 className="page-title">Mi ficha</h1>
          <p className="page-sub muted">
            No hay registro de empleado vinculado a tu usuario. Si debería existir, pide a un administrador
            que cree tu ficha en Empleados.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="view-active">
      <div className="page-header">
        <h1 className="page-title">Mi ficha</h1>
        <p className="page-sub muted mono">{employee.email}</p>
      </div>

      {err && (
        <div className="banner banner--err mono" style={{ marginBottom: 16 }}>
          {err}
        </div>
      )}
      {msg && (
        <div className="banner banner--ok mono" style={{ marginBottom: 16 }}>
          {msg}
        </div>
      )}

      <div className="panel emp-panel">
        <div className="emp-photo-col">
          <div className="emp-photo-wrap">
            {form.fotoUrl ? (
              <img src={form.fotoUrl} alt="" className="emp-photo" />
            ) : (
              <div className="emp-photo-ph mono">Sin foto</div>
            )}
          </div>
          <p className="muted mono" style={{ fontSize: 10, marginTop: 8 }}>
            URL de imagen pública
          </p>
        </div>
        <form className="emp-form" onSubmit={save}>
          <FormFields form={form} setForm={setForm} />
          <div className="form-actions">
            <button type="submit" className="btn btn-primary">
              Guardar
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

/** Listado y ABM de fichas (solo ADMIN) */
function EmployeesAdmin() {
  const { user } = useAuth();
  const [list, setList] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [q, setQ] = useState('');
  const [modal, setModal] = useState(null);
  const [sel, setSel] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [newUserId, setNewUserId] = useState('');
  const [busy, setBusy] = useState(false);
  const [userToggleId, setUserToggleId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [emps, us] = await Promise.all([api.get('/api/employees'), api.get('/api/users')]);
      setList(Array.isArray(emps) ? emps : []);
      setUsers(Array.isArray(us) ? us : []);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const empUserIds = useMemo(() => new Set(list.map((e) => e.userId)), [list]);

  const candidatesNew = useMemo(() => {
    return users.filter((u) => u.role !== 'VIEWER' && !empUserIds.has(u.id));
  }, [users, empUserIds]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return list;
    return list.filter((e) => {
      const hay = `${e.apellidos || ''} ${e.nombres || ''} ${e.cargo || ''} ${e.email || ''}`.toLowerCase();
      return hay.includes(s);
    });
  }, [list, q]);

  function openEdit(row) {
    setErr(null);
    setSel(row);
    setForm(employeeToForm(row));
    setModal('edit');
  }

  function openCreate() {
    setErr(null);
    setSel(null);
    setForm(emptyForm());
    setNewUserId(candidatesNew[0]?.id || '');
    setModal('create');
  }

  async function submitCreate(e) {
    e.preventDefault();
    if (!newUserId) {
      setErr('Seleccione un usuario');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const p = payloadFromForm(form);
      await api.post('/api/employees', {
        userId: newUserId,
        nombres: form.nombres.trim(),
        apellidos: form.apellidos.trim(),
        cargo: p.cargo,
        telefono: p.telefono,
        dni: p.dni,
        fotoUrl: p.fotoUrl,
        fechaIngreso: p.fechaIngreso,
        notas: p.notas,
      });
      setErr(null);
      setModal(null);
      await load();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitEdit(e) {
    e.preventDefault();
    if (!sel) return;
    setBusy(true);
    setErr(null);
    try {
      await api.put(`/api/employees/${sel.id}`, payloadFromForm(form));
      setErr(null);
      setModal(null);
      await load();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

  function closeModal() {
    if (busy) return;
    setErr(null);
    setModal(null);
  }

  async function toggleEmployeeUserActive(row, nextActive) {
    if (!nextActive && row.userId === user?.id) {
      setErr('No puedes desactivar tu propio usuario.');
      return;
    }
    const verb = nextActive ? 'reactivar' : 'desactivar';
    if (!window.confirm(`¿${verb} el acceso del usuario vinculado a ${row.apellidos}, ${row.nombres}?`)) return;
    setErr(null);
    setUserToggleId(row.userId);
    try {
      await api.put(`/api/users/${row.userId}`, { active: nextActive });
      await load();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setUserToggleId(null);
    }
  }

  return (
    <section className="view-active">
      <div className="page-header page-header--row">
        <div>
          <h1 className="page-title">Empleados</h1>
          <p className="page-sub muted mono">
            Fichas de personal (ADMIN). Cada usuario COMERCIAL o ADMIN puede tener una ficha; los VIEWER no.
          </p>
        </div>
        <div className="page-header-actions">
          <button type="button" className="btn btn-primary" onClick={openCreate} disabled={candidatesNew.length === 0}>
            Nueva ficha
          </button>
        </div>
      </div>

      {err && !modal && (
        <div className="banner banner--err mono" style={{ marginBottom: 12 }}>
          {err}
        </div>
      )}

      <div className="toolbar">
        <input
          type="search"
          className="form-input toolbar-search mono"
          placeholder="Buscar por nombre, cargo o email…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button type="button" className="btn btn-ghost mono" onClick={() => load()}>
          Actualizar
        </button>
      </div>

      <div className="panel panel--flush">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Apellidos</th>
                <th>Nombres</th>
                <th>Cargo</th>
                <th>Email</th>
                <th>Rol</th>
                <th>Usuario</th>
                <th className="actions-col">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="muted mono">
                    Cargando…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="muted">
                    {list.length === 0 ? 'No hay fichas. Cree una vinculada a un usuario.' : 'Sin resultados'}
                  </td>
                </tr>
              ) : (
                filtered.map((row) => (
                  <tr key={row.id}>
                    <td className="mono">{row.apellidos}</td>
                    <td className="mono">{row.nombres}</td>
                    <td>{row.cargo || '—'}</td>
                    <td className="mono" style={{ fontSize: 12 }}>
                      {row.email}
                    </td>
                    <td>
                      <span className="mono">{row.role}</span>
                    </td>
                    <td>
                      {row.userActive === false ? (
                        <span className="tag tag--off">Inactivo</span>
                      ) : (
                        <span className="tag tag--ok">Activo</span>
                      )}
                    </td>
                    <td className="actions-cell">
                      <div className="proj-actions proj-actions--inline">
                        <button type="button" className="btn-action" onClick={() => openEdit(row)}>
                          <span className="btn-action__ic" aria-hidden>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                            </svg>
                          </span>
                          Editar
                        </button>
                        {row.userActive !== false ? (
                          <button
                            type="button"
                            className="btn-action btn-action--danger"
                            disabled={userToggleId === row.userId || row.userId === user?.id}
                            title={row.userId === user?.id ? 'No puedes desactivar tu propio usuario' : undefined}
                            onClick={() => toggleEmployeeUserActive(row, false)}
                          >
                            <span className="btn-action__ic" aria-hidden>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <circle cx="12" cy="12" r="10" />
                                <path d="M4.93 4.93l14.14 14.14" />
                              </svg>
                            </span>
                            {userToggleId === row.userId ? '…' : 'Desactivar'}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn-action btn-action--ok"
                            disabled={userToggleId === row.userId}
                            onClick={() => toggleEmployeeUserActive(row, true)}
                          >
                            <span className="btn-action__ic" aria-hidden>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                                <polyline points="22 4 12 14.01 9 11.01" />
                              </svg>
                            </span>
                            {userToggleId === row.userId ? '…' : 'Reactivar'}
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

      {modal === 'create' && (
        <Modal
          title="Nueva ficha de empleado"
          onClose={closeModal}
          footer={
            <>
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={closeModal}>
                Cancelar
              </button>
              <button type="submit" form="emp-create-form" className="btn btn-primary" disabled={busy}>
                {busy ? 'Guardando…' : 'Crear'}
              </button>
            </>
          }
        >
          {candidatesNew.length === 0 ? (
            <p className="muted mono">No hay usuarios ADMIN/COMERCIAL sin ficha. Cree usuarios en Usuarios primero.</p>
          ) : (
            <form id="emp-create-form" onSubmit={submitCreate}>
              {err && (
                <div className="banner banner--err mono" style={{ marginBottom: 12 }}>
                  {err}
                </div>
              )}
              <label className="fg-item" style={{ marginBottom: 14, display: 'block' }}>
                <span className="fg-lbl">Usuario (sin ficha aún)</span>
                <select
                  className="form-input"
                  value={newUserId}
                  onChange={(e) => setNewUserId(e.target.value)}
                  required
                >
                  {candidatesNew.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.email} · {u.role}
                    </option>
                  ))}
                </select>
              </label>
              <FormFields form={form} setForm={setForm} />
            </form>
          )}
        </Modal>
      )}

      {modal === 'edit' && sel && (
        <Modal
          title={`Editar: ${sel.apellidos}, ${sel.nombres}`}
          wide
          onClose={closeModal}
          footer={
            <>
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={closeModal}>
                Cancelar
              </button>
              <button type="submit" form="emp-edit-form" className="btn btn-primary" disabled={busy}>
                {busy ? 'Guardando…' : 'Guardar'}
              </button>
            </>
          }
        >
          <p className="muted mono" style={{ fontSize: 12, marginBottom: 12 }}>
            {sel.email} · {sel.role}
          </p>
          <form id="emp-edit-form" onSubmit={submitEdit}>
            {err && (
              <div className="banner banner--err mono" style={{ marginBottom: 12 }}>
                {err}
              </div>
            )}
            <div className="emp-admin-split">
              <div className="emp-photo-col">
                <div className="emp-photo-wrap">
                  {form.fotoUrl ? (
                    <img src={form.fotoUrl} alt="" className="emp-photo" />
                  ) : (
                    <div className="emp-photo-ph mono">Sin foto</div>
                  )}
                </div>
              </div>
              <div className="emp-form" style={{ flex: 1 }}>
                <FormFields form={form} setForm={setForm} />
              </div>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}

export function EmployeesPage() {
  const { hasRole } = useAuth();
  if (hasRole('ADMIN')) {
    return <EmployeesAdmin />;
  }
  return <MyEmployeeCard />;
}
