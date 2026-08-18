import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Modal } from './Modal';

function formatWhen(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-PE');
}

function DiffBlock({ title, diff, emptyHint }) {
  const added = diff?.added || [];
  const removed = diff?.removed || [];
  const changed = diff?.changed || [];
  if (!added.length && !removed.length && !changed.length) {
    return <p className="muted mono" style={{ fontSize: 11 }}>{emptyHint}</p>;
  }
  return (
    <div className="budget-rev-diff">
      <div className="fg-lbl">{title}</div>
      {removed.map((r) => (
        <div key={`rm-${r.id}`} className="budget-rev-diff__row budget-rev-diff__row--del">
          − {r.label}
          {r.qty != null ? ` · qty ${r.qty}` : ''}
        </div>
      ))}
      {added.map((r) => (
        <div key={`ad-${r.id}`} className="budget-rev-diff__row budget-rev-diff__row--add">
          + {r.label}
          {r.qty != null ? ` · qty ${r.qty}` : ''}
        </div>
      ))}
      {changed.map((r) => (
        <div key={`ch-${r.id}`} className="budget-rev-diff__row budget-rev-diff__row--chg">
          ~ {r.label}
          <ul className="budget-rev-diff__fields">
            {(r.fields || []).map((f) => (
              <li key={f.key}>
                {f.label}: <span className="budget-rev-diff__from">{String(f.from ?? '—')}</span>
                {' → '}
                <span className="budget-rev-diff__to">{String(f.to ?? '—')}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** Historial tipo git del presupuesto. Solo SUPERUSER: ver evolución y restaurar. */
export function ProjectBudgetRevisions({ projectId, onRestored }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState(null);
  const [restoreBusy, setRestoreBusy] = useState(false);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setErr(null);
    try {
      const data = await api.get(`/api/projects/${projectId}/budget-revisions`);
      setRows(Array.isArray(data?.revisions) ? data.revisions : []);
    } catch (e) {
      setErr(e.message);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (open && projectId) load();
  }, [open, projectId, load]);

  async function openDetail(id) {
    if (detailId === id) {
      setDetailId(null);
      setDetail(null);
      return;
    }
    setDetailId(id);
    setDetail(null);
    setDetailLoading(true);
    try {
      const data = await api.get(`/api/projects/${projectId}/budget-revisions/${id}`);
      setDetail(data);
    } catch (e) {
      setErr(e.message);
    } finally {
      setDetailLoading(false);
    }
  }

  async function confirmRestore() {
    if (!restoreTarget || restoreBusy) return;
    setRestoreBusy(true);
    setErr(null);
    try {
      await api.post(`/api/projects/${projectId}/budget-revisions/${restoreTarget.id}/restore`, {});
      setRestoreTarget(null);
      setDetailId(null);
      setDetail(null);
      await load();
      if (onRestored) await onRestored();
    } catch (e) {
      setErr(e.message);
    } finally {
      setRestoreBusy(false);
    }
  }

  return (
    <div className="panel budget-history-panel">
      <div className="panel-hdr budget-history-panel__hdr">
        <button type="button" className="budget-history-panel__toggle" onClick={() => setOpen((v) => !v)}>
          <span className="panel-title">Versiones de la cotización</span>
          <span className="mono muted" style={{ fontSize: 11 }}>
            {open ? '▾' : '▸'} SUPERUSER · {rows.length > 0 ? `${rows.length} revisión(es)` : 'historial restaurable'}
          </span>
        </button>
        {open && (
          <button type="button" className="btn btn-ghost mono" style={{ fontSize: 11 }} disabled={loading} onClick={load}>
            Actualizar
          </button>
        )}
      </div>
      {open && (
        <>
          <p className="muted mono budget-history-panel__help">
            Cada cambio de líneas queda fotografiado (fecha y hora). Puede comparar qué se agregó o quitó y volver a
            un estado anterior. La restauración también se registra y se puede revertir.
          </p>
          {err && (
            <div className="banner banner--err mono" style={{ marginBottom: 10 }}>
              {err}
            </div>
          )}
          <div className="table-wrap budget-history-table-wrap budget-history-table-wrap--revs zgroup-scroll">
            <table className="data-table data-table--compact">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Fecha</th>
                  <th>Qué pasó</th>
                  <th>Usuario</th>
                  <th>Cambio</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} className="muted mono">
                      Cargando…
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="muted">
                      Aún no hay versiones. Se crean al agregar, editar o borrar líneas.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <React.Fragment key={r.id}>
                      <tr className={r.isCurrent ? 'budget-rev-row--current' : undefined}>
                        <td className="mono" style={{ fontSize: 11 }}>
                          {r.seq}
                          {r.isCurrent ? ' · ahora' : ''}
                          {r.kind === 'RESTORE' ? ' · restaura' : ''}
                        </td>
                        <td className="mono" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                          {formatWhen(r.createdAt)}
                        </td>
                        <td className="mono" style={{ fontSize: 11 }}>
                          {r.causeLabel}
                        </td>
                        <td className="mono" style={{ fontSize: 11 }}>
                          {r.actorName || r.actorEmail || '—'}
                        </td>
                        <td className="mono" style={{ fontSize: 11 }}>
                          <span className="budget-rev-diff__row--add">+{r.addedCount || 0}</span>
                          {' · '}
                          <span className="budget-rev-diff__row--del">−{r.removedCount || 0}</span>
                          {' · '}
                          <span className="budget-rev-diff__row--chg">~{r.changedCount || 0}</span>
                          <span className="muted"> · {r.itemCount} línea(s)</span>
                        </td>
                        <td>
                          <button type="button" className="btn-link mono" onClick={() => openDetail(r.id)}>
                            {detailId === r.id ? 'Ocultar' : 'Ver diff'}
                          </button>
                          {!r.isCurrent && (
                            <button type="button" className="btn-link mono" onClick={() => setRestoreTarget(r)}>
                              Restaurar
                            </button>
                          )}
                        </td>
                      </tr>
                      {detailId === r.id && (
                        <tr>
                          <td colSpan={6}>
                            {detailLoading || !detail ? (
                              <p className="muted mono" style={{ fontSize: 11 }}>
                                Cargando diff…
                              </p>
                            ) : (
                              <div className="budget-rev-detail">
                                <DiffBlock
                                  title="Respecto a la versión anterior"
                                  diff={{
                                    added: [
                                      ...(detail.diffFromPrevious?.items?.added || []),
                                      ...(detail.diffFromPrevious?.bundles?.added || []),
                                    ],
                                    removed: [
                                      ...(detail.diffFromPrevious?.items?.removed || []),
                                      ...(detail.diffFromPrevious?.bundles?.removed || []),
                                    ],
                                    changed: [
                                      ...(detail.diffFromPrevious?.items?.changed || []),
                                      ...(detail.diffFromPrevious?.bundles?.changed || []),
                                    ],
                                  }}
                                  emptyHint="Sin cambios de líneas respecto a la versión anterior (o es la primera foto)."
                                />
                                {!r.isCurrent && (
                                  <DiffBlock
                                    title="Si restaura: diferencia vs. estado actual"
                                    diff={{
                                      added: [
                                        ...(detail.diffFromCurrent?.items?.added || []),
                                        ...(detail.diffFromCurrent?.bundles?.added || []),
                                      ],
                                      removed: [
                                        ...(detail.diffFromCurrent?.items?.removed || []),
                                        ...(detail.diffFromCurrent?.bundles?.removed || []),
                                      ],
                                      changed: [
                                        ...(detail.diffFromCurrent?.items?.changed || []),
                                        ...(detail.diffFromCurrent?.bundles?.changed || []),
                                      ],
                                    }}
                                    emptyHint="Igual al estado actual."
                                  />
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {restoreTarget && (
        <Modal
          title="Restaurar cotización"
          onClose={() => !restoreBusy && setRestoreTarget(null)}
          footer={
            <>
              <button type="button" className="btn btn-ghost" disabled={restoreBusy} onClick={() => setRestoreTarget(null)}>
                Cancelar
              </button>
              <button type="button" className="btn btn-primary" disabled={restoreBusy} onClick={confirmRestore}>
                {restoreBusy ? 'Restaurando…' : 'Restaurar este estado'}
              </button>
            </>
          }
        >
          <p className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
            El presupuesto volverá al estado del <strong>{formatWhen(restoreTarget.createdAt)}</strong> (revisión #
            {restoreTarget.seq}: {restoreTarget.causeLabel}). El estado actual se guarda antes; esa restauración también
            queda en el historial y se puede revertir.
          </p>
        </Modal>
      )}
    </div>
  );
}
