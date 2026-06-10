import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { formatAuditEventType, summarizeAuditRow } from '../lib/projectAuditLabels';

/** Historial de movimientos del presupuesto (solo admin con permiso). */
export function ProjectBudgetHistory({ projectId, open, onToggle }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setErr(null);
    try {
      const data = await api.get(`/api/projects/${projectId}/audit`);
      setRows(Array.isArray(data) ? data : []);
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

  return (
    <div className="panel budget-history-panel">
      <div className="panel-hdr budget-history-panel__hdr">
        <button type="button" className="budget-history-panel__toggle" onClick={onToggle}>
          <span className="panel-title">Historial del presupuesto</span>
          <span className="mono muted" style={{ fontSize: 11 }}>
            {open ? '▾' : '▸'} {rows.length > 0 ? `${rows.length} evento(s)` : 'Auditoría'}
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
            Movimientos registrados en este proyecto: altas, cambios y bajas de líneas, estado, compartidos, etc.
          </p>
          {err && (
            <div className="banner banner--err mono" style={{ marginBottom: 10 }}>
              {err}
            </div>
          )}
          <div className="table-wrap budget-history-table-wrap zgroup-scroll">
            <table className="data-table data-table--compact">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Evento</th>
                  <th>Usuario</th>
                  <th>Detalle</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={4} className="muted mono">
                      Cargando…
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="muted">
                      Sin eventos registrados
                    </td>
                  </tr>
                ) : (
                  rows.map((a) => (
                    <tr key={a.id}>
                      <td className="mono" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                        {new Date(a.createdAt).toLocaleString('es-PE')}
                      </td>
                      <td className="mono" style={{ fontSize: 11 }}>
                        {formatAuditEventType(a.eventType)}
                      </td>
                      <td className="mono" style={{ fontSize: 11 }}>
                        {a.actorName || a.actorEmail || '—'}
                      </td>
                      <td className="mono muted" style={{ fontSize: 11, maxWidth: 280 }}>
                        {summarizeAuditRow(a)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
