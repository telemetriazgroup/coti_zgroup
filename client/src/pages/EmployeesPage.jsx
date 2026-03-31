import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';

export function EmployeesPage() {
  const [loading, setLoading] = useState(true);
  const [employee, setEmployee] = useState(null);
  const [form, setForm] = useState({});
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const data = await api.get('/api/employees/me');
      const emp = data.employee;
      setEmployee(emp);
      if (emp) {
        setForm({
          nombres: emp.nombres || '',
          apellidos: emp.apellidos || '',
          cargo: emp.cargo || '',
          telefono: emp.telefono || '',
          dni: emp.dni || '',
          fotoUrl: emp.fotoUrl || '',
          fechaIngreso: emp.fechaIngreso ? String(emp.fechaIngreso).slice(0, 10) : '',
          notas: emp.notas || '',
        });
      }
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
      const payload = {
        nombres: form.nombres || undefined,
        apellidos: form.apellidos || undefined,
        cargo: form.cargo || undefined,
        telefono: form.telefono || undefined,
        dni: form.dni || undefined,
        fotoUrl: form.fotoUrl || undefined,
        fechaIngreso: form.fechaIngreso || undefined,
        notas: form.notas || undefined,
      };
      const data = await api.put('/api/employees/me', payload);
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
          <p className="page-sub muted">No hay registro de empleado vinculado a tu usuario (p. ej. rol VIEWER).</p>
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
            URL de imagen pública (Sprint 5: subida a MinIO)
          </p>
        </div>
        <form className="emp-form" onSubmit={save}>
          <div className="form-grid">
            <label className="fg-item">
              <span className="fg-lbl">Nombres</span>
              <input
                className="form-input"
                value={form.nombres}
                onChange={(e) => setForm((f) => ({ ...f, nombres: e.target.value }))}
              />
            </label>
            <label className="fg-item">
              <span className="fg-lbl">Apellidos</span>
              <input
                className="form-input"
                value={form.apellidos}
                onChange={(e) => setForm((f) => ({ ...f, apellidos: e.target.value }))}
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
