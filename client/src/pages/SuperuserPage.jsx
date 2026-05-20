import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, postFormData } from '../lib/api';

export function SuperuserPage() {
  const [auditRows, setAuditRows] = useState([]);
  const [auditLoading, setAuditLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);
  const [importPreview, setImportPreview] = useState(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importMode, setImportMode] = useState('merge');
  const fileRef = useRef(null);

  const loadAudit = useCallback(async () => {
    setAuditLoading(true);
    setErr(null);
    try {
      const data = await api.get('/api/superuser/audit?limit=200');
      setAuditRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setErr(e.message);
    } finally {
      setAuditLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAudit();
  }, [loadAudit]);

  async function exportAll() {
    setErr(null);
    setMsg(null);
    try {
      const data = await api.get('/api/superuser/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `zgroup-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      setMsg('Exportación descargada.');
    } catch (e) {
      setErr(e.message);
    }
  }

  async function previewImport(file) {
    if (!file) return;
    setErr(null);
    setImportPreview(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const data = await postFormData('/api/superuser/import/preview', fd);
      setImportPreview(data);
    } catch (e) {
      setErr(e.message);
    }
  }

  async function applyImport() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setErr('Seleccione un archivo JSON');
      return;
    }
    if (importMode === 'replace' && !window.confirm('Modo REEMPLAZO: borrará datos actuales antes de importar. ¿Continuar?')) {
      return;
    }
    setImportBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('mode', importMode);
      const data = await postFormData('/api/superuser/import/apply', fd);
      setMsg(`Importación OK (${data.mode}): ${JSON.stringify(data.stats)}`);
      setImportPreview(null);
      if (fileRef.current) fileRef.current.value = '';
      loadAudit();
    } catch (e) {
      setErr(e.message);
    } finally {
      setImportBusy(false);
    }
  }

  return (
    <section className="view-active">
      <div className="page-header">
        <h1 className="page-title">Superusuario — Sistema</h1>
        <p className="page-sub muted">
          Exportación/importación masiva de todos los módulos y auditoría global del sistema.
        </p>
      </div>

      {err && (
        <div className="banner banner--err mono" style={{ marginBottom: 12 }}>
          {err}
        </div>
      )}
      {msg && (
        <div className="banner banner--ok mono" style={{ marginBottom: 12 }}>
          {msg}
        </div>
      )}

      <div className="panel" style={{ marginBottom: 16 }}>
        <h2 className="panel-title">Datos del sistema</h2>
        <p className="muted mono" style={{ fontSize: 12, marginBottom: 12 }}>
          Exporta usuarios, empleados, clientes, catálogo, proyectos, ítems, compartidos y metadatos de auditoría en un
          JSON único.
        </p>
        <div className="page-header-actions" style={{ flexWrap: 'wrap', gap: 8 }}>
          <button type="button" className="btn btn-primary" onClick={exportAll}>
            Exportar todo (JSON)
          </button>
        </div>

        <hr style={{ borderColor: 'var(--border-dim)', margin: '16px 0' }} />

        <h3 className="mono" style={{ fontSize: 13, marginBottom: 8 }}>
          Importación masiva
        </h3>
        <div className="stack-form" style={{ maxWidth: 480 }}>
          <label>
            <span className="fg-lbl">Archivo JSON</span>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="form-input"
              onChange={(e) => previewImport(e.target.files?.[0])}
            />
          </label>
          <label>
            <span className="fg-lbl">Modo</span>
            <select className="form-input" value={importMode} onChange={(e) => setImportMode(e.target.value)}>
              <option value="merge">Fusionar (upsert por ID)</option>
              <option value="replace">Reemplazar (borra datos operativos antes)</option>
            </select>
          </label>
          {importPreview && (
            <pre className="mono audit-json" style={{ fontSize: 11, maxHeight: 120, overflow: 'auto' }}>
              {JSON.stringify(importPreview, null, 2)}
            </pre>
          )}
          <button type="button" className="btn btn-amber" disabled={importBusy} onClick={applyImport}>
            {importBusy ? 'Importando…' : 'Aplicar importación'}
          </button>
        </div>
      </div>

      <div className="panel panel--flush">
        <div className="panel-title" style={{ padding: '12px 16px' }}>
          Auditoría global
          <button type="button" className="btn btn-ghost mono" style={{ float: 'right', fontSize: 11 }} onClick={loadAudit}>
            Actualizar
          </button>
        </div>
        <div className="table-wrap" style={{ maxHeight: 480, overflow: 'auto' }}>
          <table className="data-table data-table--compact">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Proyecto</th>
                <th>Creador proj.</th>
                <th>Evento</th>
                <th>Actor</th>
                <th>Detalle</th>
              </tr>
            </thead>
            <tbody>
              {auditLoading ? (
                <tr>
                  <td colSpan={6} className="muted mono">
                    Cargando…
                  </td>
                </tr>
              ) : auditRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted">
                    Sin eventos
                  </td>
                </tr>
              ) : (
                auditRows.map((a) => (
                  <tr key={a.id}>
                    <td className="mono" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                      {new Date(a.createdAt).toLocaleString()}
                    </td>
                    <td>{a.projectNombre || '—'}</td>
                    <td className="mono" style={{ fontSize: 11 }}>
                      {a.projectCreatorEmail || '—'}
                    </td>
                    <td className="mono">{a.eventType}</td>
                    <td className="mono" style={{ fontSize: 11 }}>
                      {a.actorName || a.actorEmail || a.actorId?.slice(0, 8) || '—'}
                    </td>
                    <td className="mono audit-json">
                      <pre>{JSON.stringify(a.newData || a.prevData, null, 0)}</pre>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
