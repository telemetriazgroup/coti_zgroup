import React, { useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Modal } from './Modal';
import { MIN_PASSWORD_LENGTH } from '../lib/passwordPolicy';

export function ForcePasswordModal() {
  const { refreshProfile, logout } = useAuth();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [err, setErr] = useState(null);

  async function onSubmit(e) {
    e.preventDefault();
    setErr(null);
    if (newPassword !== confirmPassword) {
      setErr('La confirmación no coincide con la nueva contraseña');
      return;
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setErr(`La nueva contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`);
      return;
    }
    if (newPassword === '123456789') {
      setErr('No puede reutilizar la contraseña temporal. Use una clave personal.');
      return;
    }
    setBusy(true);
    try {
      await api.put('/api/auth/me/password', { newPassword });
      refreshProfile?.({ mustChangePassword: false });
    } catch (e2) {
      setErr(e2.message || 'No se pudo actualizar la contraseña');
    } finally {
      setBusy(false);
    }
  }

  async function onExit() {
    if (busy || leaving) return;
    setLeaving(true);
    try {
      await logout();
    } finally {
      setLeaving(false);
    }
  }

  const locked = busy || leaving;

  return (
    <Modal
      title="Actualice su contraseña"
      persistent
      onClose={() => {}}
      panelClassName="modal-panel--force-pwd"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onExit} disabled={locked}>
            {leaving ? 'Saliendo…' : 'Salir'}
          </button>
          <button type="submit" form="force-pwd-form" className="btn btn-primary" disabled={locked}>
            {busy ? 'Guardando…' : 'Actualizar contraseña'}
          </button>
        </>
      }
    >
      <form id="force-pwd-form" className="stack-form" onSubmit={onSubmit}>
        <p className="force-pwd-lead">
          Ingresó con la clave temporal <span className="mono">123456789</span>. Debe cambiarla para continuar,
          o pulse <strong>Salir</strong> para volver al login.
        </p>
        <div className="force-pwd-hint">
          <strong>Sugerencia:</strong> use la misma contraseña con la que accede a{' '}
          <span className="mono">Odoo</span> para no tener múltiples cuentas.
        </div>
        <label>
          <span className="fg-lbl">Nueva contraseña *</span>
          <div className="pwd-wrap">
            <input
              className="form-input mono pwd-input"
              type={showPwd ? 'text' : 'password'}
              minLength={MIN_PASSWORD_LENGTH}
              required
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <button
              type="button"
              className="pwd-toggle"
              onClick={() => setShowPwd((s) => !s)}
              title="Mostrar/ocultar"
            >
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
          </div>
        </label>
        <label>
          <span className="fg-lbl">Confirmar nueva contraseña *</span>
          <input
            className="form-input mono"
            type={showPwd ? 'text' : 'password'}
            minLength={MIN_PASSWORD_LENGTH}
            required
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </label>
        {err && <div className="msg error show">{err}</div>}
      </form>
    </Modal>
  );
}
