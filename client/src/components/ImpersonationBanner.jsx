import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { Modal } from './Modal';

function labelOf(u) {
  if (!u) return '';
  const n = `${u.nombres || ''} ${u.apellidos || ''}`.trim();
  return n || u.email || '';
}

export function ImpersonationBanner() {
  const { user, stopImpersonation, startImpersonation, isImpersonating } = useAuth();
  const [stopping, setStopping] = useState(false);
  const [switchOpen, setSwitchOpen] = useState(false);
  const [candidates, setCandidates] = useState([]);
  const [q, setQ] = useState('');
  const [err, setErr] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const impersonator = user?.impersonator;
  const name = labelOf(user);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return candidates;
    return candidates.filter((r) =>
      [r.email, r.nombres, r.apellidos, r.role].filter(Boolean).join(' ').toLowerCase().includes(needle)
    );
  }, [candidates, q]);

  const openSwitch = useCallback(async () => {
    setErr(null);
    setSwitchOpen(true);
    try {
      const data = await api.get('/api/auth/impersonate/candidates');
      setCandidates(Array.isArray(data) ? data : []);
    } catch (e) {
      setErr(e.message);
    }
  }, []);

  useEffect(() => {
    if (!isImpersonating) setSwitchOpen(false);
  }, [isImpersonating]);

  if (!isImpersonating) return null;

  async function exit() {
    setStopping(true);
    setErr(null);
    try {
      await stopImpersonation();
    } catch (e) {
      setErr(e.message);
      setStopping(false);
    }
  }

  async function switchTo(id) {
    setBusyId(id);
    setErr(null);
    try {
      await startImpersonation(id);
      setSwitchOpen(false);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <div className="impersonation-banner" role="status">
        <div className="impersonation-banner__text">
          <span className="impersonation-banner__kicker mono">Virtualizando</span>
          <strong>
            {name} · {user.role}
          </strong>
          <span className="mono impersonation-banner__email">{user.email}</span>
          <span className="muted impersonation-banner__hint">
            Permisos de esta cuenta. Auditoría: {impersonator?.email || 'superadmin'}
          </span>
        </div>
        <div className="impersonation-banner__actions">
          <button type="button" className="btn btn-ghost" onClick={openSwitch}>
            Cambiar usuario
          </button>
          <button type="button" className="btn btn-primary" disabled={stopping} onClick={exit}>
            {stopping ? 'Saliendo…' : 'Salir de virtualización'}
          </button>
        </div>
      </div>
      {err && !switchOpen && (
        <div className="banner banner--err mono" style={{ margin: '0 16px 8px' }}>
          {err}
        </div>
      )}
      {switchOpen && (
        <Modal
          title="Cambiar usuario virtualizado"
          onClose={() => setSwitchOpen(false)}
          lg
        >
          {err && (
            <div className="banner banner--err mono" style={{ marginBottom: 10 }}>
              {err}
            </div>
          )}
          <input
            type="search"
            className="form-input mono"
            placeholder="Buscar…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ marginBottom: 10 }}
          />
          <div className="table-wrap zgroup-scroll" style={{ maxHeight: 360 }}>
            <table className="data-table data-table--compact">
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className={r.id === user.id ? 'budget-rev-row--current' : undefined}>
                    <td>
                      {labelOf(r)}
                      <div className="mono muted" style={{ fontSize: 11 }}>
                        {r.email}
                      </div>
                    </td>
                    <td className="mono">{r.role}</td>
                    <td className="actions-cell">
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={r.id === user.id || busyId === r.id}
                        onClick={() => switchTo(r.id)}
                      >
                        {r.id === user.id ? 'Actual' : busyId === r.id ? '…' : 'Entrar'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}
    </>
  );
}
