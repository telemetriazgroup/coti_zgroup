import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, postFormData } from '../lib/api';

export function SuperuserPage() {
  const [auditRows, setAuditRows] = useState([]);
  const [auditLoading, setAuditLoading] = useState(true);
  const [lockouts, setLockouts] = useState([]);
  const [lockoutsLoading, setLockoutsLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);
  const [importPreview, setImportPreview] = useState(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importMode, setImportMode] = useState('merge');
  const [odooHealth, setOdooHealth] = useState(null);
  const [odooBusy, setOdooBusy] = useState(false);
  const [odooProjectBusy, setOdooProjectBusy] = useState(false);
  const [odooLink, setOdooLink] = useState(null);
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

  const loadLockouts = useCallback(async () => {
    setLockoutsLoading(true);
    try {
      const data = await api.get('/api/superuser/login-lockouts');
      setLockouts(Array.isArray(data) ? data : []);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLockoutsLoading(false);
    }
  }, []);

  const loadOdooHealth = useCallback(async () => {
    try {
      const data = await api.get('/api/odoo/sync/health');
      setOdooHealth(data);
    } catch (e) {
      setOdooHealth({ error: e.message });
    }
    try {
      const link = await api.get('/api/odoo/sync/clients-link');
      setOdooLink(link);
    } catch {
      setOdooLink(null);
    }
  }, []);

  useEffect(() => {
    loadAudit();
    loadLockouts();
    loadOdooHealth();
  }, [loadAudit, loadLockouts, loadOdooHealth]);

  async function triggerOdooProject() {
    setErr(null);
    setMsg(null);
    setOdooProjectBusy(true);
    try {
      const data = await api.post('/api/odoo/sync/project-clients');
      setMsg(
        `CRM actualizado: ${data.upserted} empresas, ${data.deactivated} archivadas, ${data.link?.linked || 0} RUC vinculados, ${data.link?.ambiguousN || 0} ambiguos.`
      );
      await loadOdooHealth();
    } catch (e) {
      setErr(e.message);
    } finally {
      setOdooProjectBusy(false);
    }
  }

  async function triggerOdooPull() {
    setErr(null);
    setMsg(null);
    setOdooBusy(true);
    try {
      await api.post('/api/odoo/sync/partners', { force: true });
      setMsg('Sincronización de contactos Odoo encolada. El estado se actualiza abajo.');
      await new Promise((r) => setTimeout(r, 2000));
      await loadOdooHealth();
    } catch (e) {
      setErr(e.message);
    } finally {
      setOdooBusy(false);
    }
  }

  async function resetLockout(row) {
    setErr(null);
    try {
      await api.post('/api/superuser/login-lockouts/reset', {
        email: row.email,
        userId: row.userId || undefined,
      });
      setMsg(`Cuenta desbloqueada: ${row.userEmail || row.email}`);
      loadLockouts();
    } catch (e) {
      setErr(e.message);
    }
  }

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
    if (
      importMode === 'replace' &&
      !window.confirm(
        'Modo REEMPLAZO: borra proyectos, catálogo, clientes y usuarios actuales. Se conserva solo el SUPERUSER con el que está conectado. ¿Continuar?'
      )
    ) {
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
          Exportación/importación masiva de todos los módulos y auditoría global del sistema.{' '}
          <Link to="/superusuario/virtualizar">Virtualizar un usuario</Link> para ver su interfaz y dar soporte.
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
        <h2 className="panel-title">Contactos Odoo</h2>
        <p className="muted mono" style={{ fontSize: 12, marginBottom: 12 }}>
          Caché local de res.partner. El picker de proyecto busca aquí (etapa 4), sin llamar a Odoo.
        </p>
        {odooHealth?.error ? (
          <p className="muted">{odooHealth.error}</p>
        ) : odooHealth ? (
          <div className="kpi-grid dash-analytics__kpis" style={{ marginBottom: 12 }}>
            <div className="kpi-card">
              <div className="kpi-label mono">Configurado</div>
              <div className="kpi-value" style={{ fontSize: 16 }}>{odooHealth.configured ? 'Sí' : 'No'}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label mono">Cron 15 min</div>
              <div className="kpi-value" style={{ fontSize: 16 }}>{odooHealth.syncEnabled ? 'ON' : 'OFF'}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label mono">Caché contactos</div>
              <div className="kpi-value">{odooHealth.counts?.total ?? '—'}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label mono">CRM Odoo / local</div>
              <div className="kpi-value" style={{ fontSize: 16 }}>
                {odooHealth.crm
                  ? `${odooHealth.crm.odoo + odooHealth.crm.linked} / ${odooHealth.crm.local}`
                  : '—'}
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label mono">Última OK</div>
              <div className="kpi-value" style={{ fontSize: 14 }}>
                {odooHealth.state?.lastOkAt
                  ? new Date(odooHealth.state.lastOkAt).toLocaleString('es-PE')
                  : 'nunca'}
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label mono">Outbox</div>
              <div className="kpi-value" style={{ fontSize: 16 }}>
                {odooHealth.outbox
                  ? `${odooHealth.outbox.pending || 0} pend. / ${odooHealth.outbox.failed || 0} fail / ${odooHealth.outbox.conflict || 0} conf.`
                  : '—'}
              </div>
            </div>
          </div>
        ) : (
          <p className="muted">Cargando estado…</p>
        )}
        {odooHealth?.stale && (
          <p className="muted" style={{ marginBottom: 8 }}>
            Última sync con más de 45 min. Si el cron está OFF, pulse actualizar.
          </p>
        )}
        {odooHealth?.state?.lastError && (
          <p className="banner banner--err mono" style={{ marginBottom: 8 }}>
            {odooHealth.state.lastError}
          </p>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-primary" disabled={odooBusy} onClick={triggerOdooPull}>
            {odooBusy ? 'Encolando…' : 'Actualizar contactos'}
          </button>
          <button type="button" className="btn btn-ghost" disabled={odooProjectBusy} onClick={triggerOdooProject}>
            {odooProjectBusy ? 'Proyectando…' : 'Proyectar a CRM'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={loadOdooHealth}>
            Refrescar estado
          </button>
        </div>
        {odooLink && (odooLink.ambiguousN > 0 || odooLink.unmatched > 0) && (
          <p className="muted mono" style={{ fontSize: 11, marginTop: 10 }}>
            RUC 1:1 pendientes: {odooLink.linked} vinculables, {odooLink.unmatched} sin match, {odooLink.ambiguousN}{' '}
            ambiguos (no se fusionan).
          </p>
        )}
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <h2 className="panel-title">Datos del sistema</h2>
          <p className="muted mono" style={{ fontSize: 12, marginBottom: 12 }}>
            Exporta usuarios, empleados, clientes, catálogo, proyectos, ítems, compartidos y metadatos de auditoría en un
            JSON único. En <strong>Reemplazar</strong> se conserva el SUPERUSER con el que está conectado (email y
            contraseña); el resto de usuarios se borra y se carga desde el archivo.
          </p>
        <div className="page-header-actions" style={{ flexWrap: 'wrap', gap: 8 }}>
          <button type="button" className="btn btn-primary" onClick={exportAll}>
            Exportar todo (JSON)
          </button>
          <a href="#/superusuario/datos" className="btn btn-ghost mono">
            Explorador de datos BD →
          </a>
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
              <option value="replace">Reemplazar (borra todo salvo este SUPERUSER)</option>
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

      <div className="panel panel--flush" style={{ marginBottom: 16 }}>
        <div className="panel-title" style={{ padding: '12px 16px' }}>
          Cuentas bloqueadas por login
          <button
            type="button"
            className="btn btn-ghost mono"
            style={{ float: 'right', fontSize: 11 }}
            onClick={loadLockouts}
          >
            Actualizar
          </button>
        </div>
        <p className="muted mono" style={{ fontSize: 12, padding: '0 16px 8px' }}>
          El límite de intentos aplica por correo, no por IP. Puede reiniciar el conteo de una cuenta bloqueada.
        </p>
        <div className="table-wrap" style={{ maxHeight: 240, overflow: 'auto' }}>
          <table className="data-table data-table--compact">
            <thead>
              <tr>
                <th>Email</th>
                <th>Intentos</th>
                <th>Bloqueado hasta</th>
                <th className="actions-col">Acción</th>
              </tr>
            </thead>
            <tbody>
              {lockoutsLoading ? (
                <tr>
                  <td colSpan={4} className="muted mono">
                    Cargando…
                  </td>
                </tr>
              ) : lockouts.length === 0 ? (
                <tr>
                  <td colSpan={4} className="muted">
                    Sin cuentas bloqueadas
                  </td>
                </tr>
              ) : (
                lockouts.map((row) => (
                  <tr key={row.email}>
                    <td className="mono" style={{ fontSize: 11 }}>
                      {row.userEmail || row.email}
                    </td>
                    <td className="mono num">{row.failedCount}</td>
                    <td className="mono" style={{ fontSize: 11 }}>
                      {row.lockedUntil ? new Date(row.lockedUntil).toLocaleString() : '—'}
                    </td>
                    <td className="actions-col">
                      <button type="button" className="btn-link mono" onClick={() => resetLockout(row)}>
                        Desbloquear
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
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
