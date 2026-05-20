import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { Modal } from './Modal';

/** Modal reutilizable para compartir un proyecto con ADMIN/COMERCIAL. */
export function ProjectShareModal({ projectId, projectName, open, onClose, onSaved }) {
  const [formShare, setFormShare] = useState([]);
  const [shareSelected, setShareSelected] = useState([]);
  const [shareUsers, setShareUsers] = useState([]);
  const [shareSearch, setShareSearch] = useState('');
  const [shareSearchBusy, setShareSearchBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const shareSearchTimer = useRef(null);

  useEffect(() => {
    if (!open || !projectId) return;
    setErr(null);
    setShareSearch('');
    (async () => {
      try {
        const [shares, users] = await Promise.all([
          api.get(`/api/projects/${projectId}/shares`),
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
      } catch (e) {
        setErr(e.message);
      }
    })();
  }, [open, projectId]);

  useEffect(() => {
    if (!open) return undefined;
    if (shareSearchTimer.current) clearTimeout(shareSearchTimer.current);
    shareSearchTimer.current = setTimeout(async () => {
      setShareSearchBusy(true);
      try {
        const qs = shareSearch.trim() ? `?q=${encodeURIComponent(shareSearch.trim())}` : '';
        const users = await api.get(`/api/users/shareable${qs}`);
        setShareUsers(users || []);
      } catch {
        /* ignore */
      } finally {
        setShareSearchBusy(false);
      }
    }, 300);
    return () => {
      if (shareSearchTimer.current) clearTimeout(shareSearchTimer.current);
    };
  }, [open, shareSearch]);

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
    if (!projectId) return;
    setBusy(true);
    setErr(null);
    try {
      await api.put(`/api/projects/${projectId}/shares`, { userIds: formShare });
      onSaved?.();
      onClose?.();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <Modal
      wide
      title="Compartir proyecto"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" form="project-share-form" className="btn btn-primary" disabled={busy}>
            {busy ? 'Guardando…' : 'Guardar'}
          </button>
        </>
      }
    >
      <p className="muted mono" style={{ marginBottom: 12, fontSize: 12 }}>
        Proyecto: <strong>{projectName || projectId}</strong> — seleccione ADMIN o COMERCIAL con acceso de edición.
      </p>
      {err && (
        <div className="banner banner--err mono" style={{ marginBottom: 10, fontSize: 12 }}>
          {err}
        </div>
      )}
      <form id="project-share-form" className="stack-form" onSubmit={saveShare}>
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
                <input type="checkbox" checked={formShare.includes(u.id)} onChange={() => toggleShareUser(u)} />
                {u.email} ({u.role}) {u.nombre ? `— ${u.nombre}` : ''}
              </label>
            ))
          )}
        </div>
      </form>
    </Modal>
  );
}
