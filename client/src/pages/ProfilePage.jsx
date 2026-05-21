import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';

function buildDefaultPasswordPreview(email) {
  const local =
    String(email || '')
      .toLowerCase()
      .trim()
      .split('@')[0]
      .replace(/[^a-z0-9._-]/g, '') || 'user';
  return `${local}${new Date().getFullYear()}!`;
}

export function ProfilePage() {
  const { user, refreshProfile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);
  const [profileForm, setProfileForm] = useState({
    nombres: '',
    apellidos: '',
    cargo: '',
    telefono: '',
    dni: '',
  });
  const [pwdForm, setPwdForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [profileBusy, setProfileBusy] = useState(false);
  const [pwdBusy, setPwdBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const data = await api.get('/api/auth/me');
      setProfileForm({
        nombres: data.nombres || '',
        apellidos: data.apellidos || '',
        cargo: data.cargo || '',
        telefono: data.telefono || '',
        dni: data.dni || '',
      });
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function saveProfile(e) {
    e.preventDefault();
    setProfileBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const data = await api.put('/api/auth/me', {
        nombres: profileForm.nombres.trim(),
        apellidos: profileForm.apellidos.trim(),
        cargo: profileForm.cargo.trim() || undefined,
        telefono: profileForm.telefono.trim() || undefined,
        dni: profileForm.dni.trim() || undefined,
      });
      refreshProfile?.(data);
      setMsg('Datos actualizados.');
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setProfileBusy(false);
    }
  }

  async function savePassword(e) {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    if (pwdForm.newPassword !== pwdForm.confirmPassword) {
      setErr('La confirmación no coincide con la nueva contraseña');
      return;
    }
    if (pwdForm.newPassword.length < 8) {
      setErr('La nueva contraseña debe tener al menos 8 caracteres');
      return;
    }
    setPwdBusy(true);
    try {
      await api.put('/api/auth/me/password', {
        currentPassword: pwdForm.currentPassword,
        newPassword: pwdForm.newPassword,
      });
      setPwdForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setMsg('Contraseña actualizada correctamente.');
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setPwdBusy(false);
    }
  }

  const defaultPwdHint = buildDefaultPasswordPreview(user?.email);

  return (
    <section className="view-active">
      <div className="page-header">
        <h1 className="page-title">Mi perfil</h1>
        <p className="page-sub muted">Actualice sus datos y cambie su contraseña de forma segura.</p>
      </div>

      {err && (
        <div className="banner banner--err mono" style={{ marginBottom: 12 }}>
          {err}
        </div>
      )}
      {msg && (
        <div className="banner mono" style={{ marginBottom: 12, borderColor: 'var(--green)', color: 'var(--green)' }}>
          {msg}
        </div>
      )}

      <div className="profile-grid">
        <div className="panel" style={{ padding: 16 }}>
          <h2 className="panel-title" style={{ marginBottom: 12 }}>
            Datos personales
          </h2>
          {loading ? (
            <p className="muted mono">Cargando…</p>
          ) : (
            <form className="stack-form" onSubmit={saveProfile}>
              <label>
                <span className="fg-lbl">Email</span>
                <input className="form-input mono" value={user?.email || ''} readOnly disabled />
              </label>
              <label>
                <span className="fg-lbl">Rol</span>
                <input className="form-input mono" value={user?.role || ''} readOnly disabled />
              </label>
              <label>
                <span className="fg-lbl">Nombres</span>
                <input
                  className="form-input"
                  value={profileForm.nombres}
                  onChange={(e) => setProfileForm((f) => ({ ...f, nombres: e.target.value }))}
                />
              </label>
              <label>
                <span className="fg-lbl">Apellidos</span>
                <input
                  className="form-input"
                  value={profileForm.apellidos}
                  onChange={(e) => setProfileForm((f) => ({ ...f, apellidos: e.target.value }))}
                />
              </label>
              <label>
                <span className="fg-lbl">Cargo</span>
                <input
                  className="form-input"
                  value={profileForm.cargo}
                  onChange={(e) => setProfileForm((f) => ({ ...f, cargo: e.target.value }))}
                />
              </label>
              <label>
                <span className="fg-lbl">Teléfono</span>
                <input
                  className="form-input mono"
                  value={profileForm.telefono}
                  onChange={(e) => setProfileForm((f) => ({ ...f, telefono: e.target.value }))}
                />
              </label>
              <label>
                <span className="fg-lbl">DNI</span>
                <input
                  className="form-input mono"
                  value={profileForm.dni}
                  onChange={(e) => setProfileForm((f) => ({ ...f, dni: e.target.value }))}
                />
              </label>
              <button type="submit" className="btn btn-primary" disabled={profileBusy}>
                {profileBusy ? 'Guardando…' : 'Guardar datos'}
              </button>
            </form>
          )}
        </div>

        <div className="panel" style={{ padding: 16 }}>
          <h2 className="panel-title" style={{ marginBottom: 12 }}>
            Cambiar contraseña
          </h2>
          <p className="muted mono" style={{ fontSize: 12, marginBottom: 12, lineHeight: 1.45 }}>
            Debe ingresar su contraseña actual. Mínimo 8 caracteres en la nueva.
          </p>
          <form className="stack-form" onSubmit={savePassword}>
            <label>
              <span className="fg-lbl">Contraseña actual *</span>
              <input
                type="password"
                className="form-input mono"
                required
                autoComplete="current-password"
                value={pwdForm.currentPassword}
                onChange={(e) => setPwdForm((f) => ({ ...f, currentPassword: e.target.value }))}
              />
            </label>
            <label>
              <span className="fg-lbl">Nueva contraseña *</span>
              <input
                type="password"
                className="form-input mono"
                required
                minLength={8}
                autoComplete="new-password"
                value={pwdForm.newPassword}
                onChange={(e) => setPwdForm((f) => ({ ...f, newPassword: e.target.value }))}
              />
            </label>
            <label>
              <span className="fg-lbl">Confirmar nueva contraseña *</span>
              <input
                type="password"
                className="form-input mono"
                required
                minLength={8}
                autoComplete="new-password"
                value={pwdForm.confirmPassword}
                onChange={(e) => setPwdForm((f) => ({ ...f, confirmPassword: e.target.value }))}
              />
            </label>
            <button type="submit" className="btn btn-primary" disabled={pwdBusy}>
              {pwdBusy ? 'Actualizando…' : 'Cambiar contraseña'}
            </button>
          </form>
          <p className="muted mono" style={{ fontSize: 11, marginTop: 16, lineHeight: 1.4 }}>
            Si un administrador reinicia su acceso, el formato por defecto es:{' '}
            <span style={{ color: 'var(--amber)' }}>{defaultPwdHint}</span> (usuario del email + año + !).
          </p>
        </div>
      </div>
    </section>
  );
}
