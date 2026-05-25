import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Modal } from './Modal';

const SOURCE_LABEL = {
  DIRECT: 'Edición directa',
  ARCHIVE: 'Archivado',
  RESTORE: 'Restaurado',
  IMPORT: 'Importación Excel',
};

function ChangeChain({ entries }) {
  if (!entries?.length) return <p className="muted">Sin cambios registrados.</p>;

  return (
    <div className="catalog-history-chain">
      {entries.map((e, idx) => (
        <div key={e.id} className="catalog-history-chain__step">
          <div className="catalog-history-chain__dot" aria-hidden />
          <div className="catalog-history-chain__body">
            <div className="catalog-history-chain__values mono">
              <span className="catalog-history-chain__old">{e.oldDisplay}</span>
              <span className="catalog-history-chain__arrow">→</span>
              <span className="catalog-history-chain__new">{e.newDisplay}</span>
            </div>
            <div className="catalog-history-chain__meta muted mono">
              {new Date(e.createdAt).toLocaleString('es-PE')} · {e.actorName || e.actorEmail || '—'} ·{' '}
              {SOURCE_LABEL[e.changeSource] || e.changeSource}
            </div>
          </div>
          {idx < entries.length - 1 && <div className="catalog-history-chain__line" aria-hidden />}
        </div>
      ))}
    </div>
  );
}

export function ClientHistoryModal({ open, onClose, clientId, title }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [fieldFilter, setFieldFilter] = useState('all');

  const load = useCallback(async () => {
    if (!clientId) return;
    setLoading(true);
    setErr(null);
    try {
      const d = await api.get(`/api/clients/${clientId}/history`);
      setData(d);
      setFieldFilter('all');
    } catch (e) {
      setErr(e.message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  if (!open) return null;

  const filteredGroups =
    fieldFilter === 'all'
      ? data?.byField || []
      : (data?.byField || []).filter((f) => f.field === fieldFilter);

  return (
    <Modal
      wide
      title={title || 'Historial del cliente'}
      onClose={onClose}
      footer={
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Cerrar
        </button>
      }
    >
      {loading && <p className="muted mono">Cargando historial…</p>}
      {err && (
        <div className="banner banner--err mono" style={{ marginBottom: 12 }}>
          {err}
        </div>
      )}
      {data && !loading && (
        <>
          <p className="muted mono" style={{ fontSize: 12, marginBottom: 14 }}>
            Cliente: <strong>{data.clientLabel || clientId}</strong>
          </p>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            <button
              type="button"
              className={`btn btn-ghost mono${fieldFilter === 'all' ? ' active' : ''}`}
              style={{ fontSize: 11 }}
              onClick={() => setFieldFilter('all')}
            >
              Todos los campos
            </button>
            {(data.byField || []).map((f) => (
              <button
                key={f.field}
                type="button"
                className={`btn btn-ghost mono${fieldFilter === f.field ? ' active' : ''}`}
                style={{ fontSize: 11 }}
                onClick={() => setFieldFilter(f.field)}
              >
                {f.fieldLabel} ({f.entries.length})
              </button>
            ))}
          </div>

          {filteredGroups.length === 0 ? (
            <p className="muted">Sin historial para este cliente.</p>
          ) : (
            filteredGroups.map((group) => (
              <div key={group.field} style={{ marginBottom: 16 }}>
                <h3 className="mono" style={{ fontSize: 12, marginBottom: 8 }}>
                  {group.fieldLabel}
                </h3>
                <ChangeChain entries={group.entries} />
              </div>
            ))
          )}
        </>
      )}
    </Modal>
  );
}
