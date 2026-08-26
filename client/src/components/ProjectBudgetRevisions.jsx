import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { Modal } from './Modal';

function formatWhen(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-PE');
}

function formatUsd(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n));
}

function sortedItems(items) {
  return [...(items || [])].sort((a, b) => {
    const sa = Number(a.sortOrder ?? 0);
    const sb = Number(b.sortOrder ?? 0);
    if (sa !== sb) return sa - sb;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });
}

function kitGroupMap(items) {
  const map = new Map();
  let n = 0;
  for (const row of sortedItems(items)) {
    if (row.bundleId && !map.has(row.bundleId)) {
      n += 1;
      map.set(row.bundleId, ((n - 1) % 6) + 1);
    }
  }
  return map;
}

function diffIdSet(arr) {
  return new Set((arr || []).map((x) => x.id));
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
      {title ? <div className="fg-lbl">{title}</div> : null}
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

function SnapshotTable({ title, subtitle, items, statusById, peerById, totals, tone, changeDir = 'toPeer' }) {
  const groups = useMemo(() => kitGroupMap(items), [items]);
  const rows = sortedItems(items);
  return (
    <section className={`budget-rev-snap budget-rev-snap--${tone || 'neutral'}`}>
      <header className="budget-rev-snap__hdr">
        <div>
          <h3 className="budget-rev-snap__title">{title}</h3>
          {subtitle ? <p className="budget-rev-snap__sub muted mono">{subtitle}</p> : null}
        </div>
        <div className="budget-rev-snap__kpi">
          <span className="mono">{totals?.lineCount ?? rows.filter((r) => !r.isBundleComponent).length} partidas</span>
          <strong className="mono">{formatUsd(totals?.lista)}</strong>
        </div>
      </header>
      <div className="table-wrap budget-rev-snap__table zgroup-scroll">
        <table className="data-table data-table--compact budget-rev-snap-table">
          <thead>
            <tr>
              <th className="num">#</th>
              <th>Código</th>
              <th>Descripción</th>
              <th>Unidad</th>
              <th className="num">Cant.</th>
              <th className="num">P. unit.</th>
              <th className="num">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="muted">
                  Sin líneas en este estado.
                </td>
              </tr>
            ) : (
              rows.map((row, idx) => {
                const status = statusById?.get(row.id) || 'keep';
                const peer = row.id ? peerById?.get(row.id) : undefined;
                const isHeader = row.isBundleHeader === true;
                const isComponent = row.isBundleComponent === true;
                const kitG = row.bundleId ? groups.get(row.bundleId) : null;
                const qty = Number(row.qty);
                const price = Number(row.unitPrice);
                const sub = isComponent ? null : qty * price;
                const qtyChanged = Boolean(peer) && Number(peer.qty) !== qty;
                const priceChanged = Boolean(peer) && Number(peer.unitPrice) !== price;
                const fromQty = changeDir === 'fromPeer' ? peer?.qty : qty;
                const toQty = changeDir === 'fromPeer' ? qty : peer?.qty;
                const fromPrice = changeDir === 'fromPeer' ? peer?.unitPrice : price;
                const toPrice = changeDir === 'fromPeer' ? price : peer?.unitPrice;
                return (
                  <tr
                    key={row.id || `${row.codigo}-${idx}`}
                    className={
                      `budget-rev-snap__row budget-rev-snap__row--${status}` +
                      (kitG && status === 'keep' ? ` budget-rev-snap__row--kit-g${kitG}` : '') +
                      (isHeader ? ' budget-rev-snap__row--kit-header' : '') +
                      (isComponent ? ' budget-rev-snap__row--kit-component' : '')
                    }
                  >
                    <td className="num mono">
                      {status === 'add' ? '+' : status === 'remove' ? '−' : status === 'change' ? '~' : isComponent ? '↳' : idx + 1}
                    </td>
                    <td className="mono">{row.codigo || '—'}</td>
                    <td>
                      {isHeader ? <span className="tag tag--ok budget-rev-snap__kit">KIT</span> : null}
                      {row.descripcion || '—'}
                    </td>
                    <td className={`mono ${row.tipo === 'CONSUMIBLE' ? 'budget-td-unidad--consumible' : 'budget-td-unidad--activo'}`}>
                      {row.unidad || '—'}
                    </td>
                    <td className="num mono">
                      {qtyChanged ? (
                        <>
                          <span className="budget-rev-diff__from">{fromQty}</span>
                          {' → '}
                          <span>{toQty}</span>
                        </>
                      ) : (
                        qty
                      )}
                    </td>
                    <td className="num mono">
                      {isComponent
                        ? '—'
                        : priceChanged
                          ? (
                            <>
                              <span className="budget-rev-diff__from">{formatUsd(fromPrice)}</span>
                              {' → '}
                              <span>{formatUsd(toPrice)}</span>
                            </>
                          )
                          : formatUsd(price)}
                    </td>
                    <td className="num mono">{sub == null ? '—' : formatUsd(sub)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CompareModal({
  row,
  detail,
  loading,
  onClose,
  onRestore,
  onVariant,
  restoreBusy,
  confirmingRestore,
  setConfirmingRestore,
}) {
  const [showPrevDiff, setShowPrevDiff] = useState(false);
  const isCurrent = row?.isCurrent === true;
  const currentItems = detail?.currentPayload?.items || [];
  const afterItems = detail?.revision?.payload?.items || [];
  const diff = detail?.diffFromCurrent;
  const afterById = useMemo(() => new Map(afterItems.map((i) => [i.id, i])), [afterItems]);
  const currentById = useMemo(() => new Map(currentItems.map((i) => [i.id, i])), [currentItems]);

  const currentStatus = useMemo(() => {
    const removed = diffIdSet(diff?.items?.removed);
    const changed = diffIdSet(diff?.items?.changed);
    const m = new Map();
    for (const it of currentItems) {
      if (removed.has(it.id)) m.set(it.id, 'remove');
      else if (changed.has(it.id)) m.set(it.id, 'change');
      else m.set(it.id, 'keep');
    }
    return m;
  }, [currentItems, diff]);

  const afterStatus = useMemo(() => {
    const added = diffIdSet(diff?.items?.added);
    const changed = diffIdSet(diff?.items?.changed);
    const m = new Map();
    for (const it of afterItems) {
      if (added.has(it.id)) m.set(it.id, 'add');
      else if (changed.has(it.id)) m.set(it.id, 'change');
      else m.set(it.id, 'keep');
    }
    return m;
  }, [afterItems, diff]);

  const listaNow = detail?.totals?.current?.lista ?? 0;
  const listaAfter = detail?.totals?.after?.lista ?? 0;
  const delta = Math.round((listaAfter - listaNow) * 100) / 100;

  return (
    <Modal
      title={`Comparar · revisión #${row?.seq ?? ''}`}
      onClose={onClose}
      panelClassName="modal-panel--rev-compare"
      footer={
        <>
          <button type="button" className="btn btn-ghost" disabled={restoreBusy} onClick={onClose}>
            Cerrar
          </button>
          <button type="button" className="btn btn-ghost" disabled={restoreBusy || loading} onClick={onVariant}>
            Abrir variante
          </button>
          {!isCurrent &&
            (confirmingRestore ? (
              <>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={restoreBusy}
                  onClick={() => setConfirmingRestore(false)}
                >
                  Cancelar
                </button>
                <button type="button" className="btn btn-primary" disabled={restoreBusy || loading} onClick={onRestore}>
                  {restoreBusy ? 'Restaurando…' : 'Confirmar restauración'}
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                disabled={restoreBusy || loading}
                onClick={() => setConfirmingRestore(true)}
              >
                Restaurar este estado
              </button>
            ))}
        </>
      }
    >
      {loading || !detail ? (
        <p className="muted mono">Cargando comparación…</p>
      ) : (
        <div className="budget-rev-compare">
          <p className="muted budget-rev-compare__help">
            Izquierda: cómo está el proyecto ahora. Derecha: cómo quedaría si restaura la foto del{' '}
            <strong>{formatWhen(row.createdAt)}</strong> ({row.causeLabel}). El verde aparece, el rojo se va, el ámbar
            cambia cantidad o precio. <strong>Abrir variante</strong> copia esa foto a un proyecto nuevo; el actual no
            se modifica.
          </p>
          <div className="budget-rev-compare__legend mono">
            <span className="budget-rev-legend budget-rev-legend--add">+ se agrega</span>
            <span className="budget-rev-legend budget-rev-legend--del">− se quita</span>
            <span className="budget-rev-legend budget-rev-legend--chg">~ se modifica</span>
            <span className="budget-rev-compare__delta">
              Lista:{' '}
              <span className={delta > 0 ? 'budget-rev-diff__row--add' : delta < 0 ? 'budget-rev-diff__row--del' : ''}>
                {delta > 0 ? '+' : ''}
                {formatUsd(delta)}
              </span>
            </span>
          </div>
          {confirmingRestore && (
            <div className="banner banner--err mono" style={{ marginBottom: 10 }}>
              El presupuesto actual se reemplaza por la columna derecha. Antes se guarda una foto; se puede revertir.
            </div>
          )}
          <div className="budget-rev-compare__cols">
            <SnapshotTable
              title="Proyecto actual"
              subtitle="Estado vivo"
              items={currentItems}
              statusById={currentStatus}
              peerById={afterById}
              totals={detail.totals?.current}
              tone="now"
              changeDir="toPeer"
            />
            <SnapshotTable
              title={`Tras restaurar · #${row.seq}`}
              subtitle={row.causeLabel}
              items={afterItems}
              statusById={afterStatus}
              peerById={currentById}
              totals={detail.totals?.after}
              tone="after"
              changeDir="fromPeer"
            />
          </div>
          <button
            type="button"
            className="btn-link mono budget-rev-compare__more"
            onClick={() => setShowPrevDiff((v) => !v)}
          >
            {showPrevDiff ? 'Ocultar cambio vs. foto anterior' : 'Ver cambio vs. foto anterior (lista)'}
          </button>
          {showPrevDiff && (
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
          )}
        </div>
      )}
    </Modal>
  );
}

/** Historial tipo git del presupuesto. Solo SUPERUSER: comparar, restaurar o abrir variante. */
export function ProjectBudgetRevisions({ projectId, projectName, onRestored }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [compareRow, setCompareRow] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [confirmingRestore, setConfirmingRestore] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [cloneTarget, setCloneTarget] = useState(null);
  const [cloneName, setCloneName] = useState('');
  const [cloneBusy, setCloneBusy] = useState(false);

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

  const loadDetail = useCallback(
    async (id) => {
      setDetail(null);
      setDetailLoading(true);
      try {
        const data = await api.get(`/api/projects/${projectId}/budget-revisions/${id}`);
        setDetail(data);
        return data;
      } catch (e) {
        setErr(e.message);
        return null;
      } finally {
        setDetailLoading(false);
      }
    },
    [projectId]
  );

  async function openCompare(row, { restore = false } = {}) {
    setConfirmingRestore(restore);
    setCompareRow(row);
    await loadDetail(row.id);
  }

  function defaultCloneName(row) {
    const base = projectName ? `Copia de ${projectName}` : 'Copia de cotización';
    return `${base} · rev #${row.seq}`;
  }

  function openVariant(row) {
    setCloneTarget(row);
    setCloneName(defaultCloneName(row));
  }

  async function confirmRestore() {
    if (!compareRow || restoreBusy) return;
    setRestoreBusy(true);
    setErr(null);
    try {
      await api.post(`/api/projects/${projectId}/budget-revisions/${compareRow.id}/restore`, {});
      setCompareRow(null);
      setDetail(null);
      setConfirmingRestore(false);
      await load();
      if (onRestored) await onRestored();
    } catch (e) {
      setErr(e.message);
    } finally {
      setRestoreBusy(false);
    }
  }

  async function confirmClone() {
    if (!cloneTarget || cloneBusy) return;
    setCloneBusy(true);
    setErr(null);
    try {
      const data = await api.post(`/api/projects/${projectId}/budget-revisions/${cloneTarget.id}/clone`, {
        nombre: cloneName.trim(),
      });
      setCloneTarget(null);
      setCompareRow(null);
      if (data?.projectId) {
        navigate(`/projects/${data.projectId}/presupuesto`);
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setCloneBusy(false);
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
            Cada cambio queda fotografiado. Compare el presupuesto actual con cómo quedaría al restaurar, o abra una{' '}
            <strong>variante</strong> (proyecto nuevo) sin modificar este. Restaurar sí reemplaza el actual; también se
            registra y se puede revertir.
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
                    <tr key={r.id} className={r.isCurrent ? 'budget-rev-row--current' : undefined}>
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
                      <td className="budget-rev-actions">
                        <button type="button" className="btn-link mono" onClick={() => openCompare(r)}>
                          Comparar
                        </button>
                        <button type="button" className="btn-link mono" onClick={() => openVariant(r)}>
                          Variante
                        </button>
                        {!r.isCurrent && (
                          <button type="button" className="btn-link mono" onClick={() => openCompare(r, { restore: true })}>
                            Restaurar
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {compareRow && (
        <CompareModal
          row={compareRow}
          detail={detail}
          loading={detailLoading}
          restoreBusy={restoreBusy}
          confirmingRestore={confirmingRestore}
          setConfirmingRestore={setConfirmingRestore}
          onClose={() => {
            if (restoreBusy) return;
            setCompareRow(null);
            setConfirmingRestore(false);
          }}
          onRestore={confirmRestore}
          onVariant={() => openVariant(compareRow)}
        />
      )}

      {cloneTarget && (
        <Modal
          title="Abrir variante de esta versión"
          onClose={() => !cloneBusy && setCloneTarget(null)}
          footer={
            <>
              <button type="button" className="btn btn-ghost" disabled={cloneBusy} onClick={() => setCloneTarget(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={cloneBusy || !cloneName.trim()}
                onClick={confirmClone}
              >
                {cloneBusy ? 'Creando…' : 'Crear y abrir'}
              </button>
            </>
          }
        >
          <p className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
            Se crea un proyecto <strong>BORRADOR</strong> con el presupuesto de la revisión #{cloneTarget.seq} (
            {formatWhen(cloneTarget.createdAt)}). Este proyecto no se restaura ni se modifica.
          </p>
          <div className="stack-form" style={{ marginTop: 12 }}>
            <label className="fg-lbl" htmlFor="budget-rev-clone-name">
              Nombre de la variante
            </label>
            <input
              id="budget-rev-clone-name"
              className="form-input"
              value={cloneName}
              maxLength={200}
              disabled={cloneBusy}
              onChange={(e) => setCloneName(e.target.value)}
            />
          </div>
        </Modal>
      )}
    </div>
  );
}
