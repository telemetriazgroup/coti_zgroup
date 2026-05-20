import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Modal } from './Modal';

const SOURCE_LABEL = {
  DIRECT: 'Edición directa',
  REQUEST_APPROVED: 'Solicitud aprobada',
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

/** Modal con historial de cambios de precio/nombre (y otros campos) de ítem o categoría. */
export function CatalogHistoryModal({ open, onClose, entityType, entityId, title }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [fieldFilter, setFieldFilter] = useState('all');

  const load = useCallback(async () => {
    if (!entityId || !entityType) return;
    setLoading(true);
    setErr(null);
    try {
      const path =
        entityType === 'ITEM'
          ? `/api/catalog/items/${entityId}/history`
          : `/api/catalog/categories/${entityId}/history`;
      const d = await api.get(path);
      setData(d);
      setFieldFilter('all');
    } catch (e) {
      setErr(e.message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [entityId, entityType]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  if (!open) return null;

  const priceField = data?.byField?.find((f) => f.field === 'unit_price');
  const nameField =
    entityType === 'ITEM'
      ? data?.byField?.find((f) => f.field === 'descripcion')
      : data?.byField?.find((f) => f.field === 'nombre');

  const filteredGroups =
    fieldFilter === 'all'
      ? data?.byField || []
      : (data?.byField || []).filter((f) => f.field === fieldFilter);

  return (
    <Modal
      wide
      title={title || 'Historial de modificaciones'}
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
            {entityType === 'ITEM' ? 'Ítem' : 'Categoría'}: <strong>{data.entityLabel || entityId}</strong>
          </p>

          {(priceField?.entries?.length > 0 || nameField?.entries?.length > 0) && (
            <div className="catalog-history-highlights" style={{ marginBottom: 16 }}>
              {priceField?.entries?.length > 0 && (
                <div className="panel" style={{ padding: 12, marginBottom: 10 }}>
                  <h3 className="mono" style={{ fontSize: 12, marginBottom: 8, color: 'var(--cyan)' }}>
                    Ciclo de precio
                  </h3>
                  <ChangeChain entries={priceField.entries} />
                </div>
              )}
              {nameField?.entries?.length > 0 && (
                <div className="panel" style={{ padding: 12 }}>
                  <h3 className="mono" style={{ fontSize: 12, marginBottom: 8, color: 'var(--cyan)' }}>
                    Ciclo de nombre / descripción
                  </h3>
                  <ChangeChain entries={nameField.entries} />
                </div>
              )}
            </div>
          )}

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
            <p className="muted">Sin historial para este registro.</p>
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
