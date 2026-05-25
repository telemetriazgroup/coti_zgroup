import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { Modal } from '../components/Modal';

function cellPreview(val) {
  if (val == null) return '—';
  if (typeof val === 'object') return JSON.stringify(val);
  const s = String(val);
  return s.length > 80 ? `${s.slice(0, 77)}…` : s;
}

export function DbBrowserPage() {
  const [tables, setTables] = useState([]);
  const [selected, setSelected] = useState('');
  const [schema, setSchema] = useState(null);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [limit] = useState(50);
  const [loading, setLoading] = useState(true);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);
  const [editRow, setEditRow] = useState(null);
  const [editDraft, setEditDraft] = useState({});
  const [editPwd, setEditPwd] = useState('');
  const [editBusy, setEditBusy] = useState(false);

  const loadTables = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const data = await api.get('/api/superuser/db/tables');
      const list = data.tables || [];
      setTables(list);
      if (!selected && list.length) setSelected(list[0].name);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [selected]);

  const loadRows = useCallback(async () => {
    if (!selected) return;
    setRowsLoading(true);
    setErr(null);
    try {
      const [schemaData, rowData] = await Promise.all([
        api.get(`/api/superuser/db/tables/${encodeURIComponent(selected)}/schema`),
        api.get(
          `/api/superuser/db/tables/${encodeURIComponent(selected)}/rows?limit=${limit}&offset=${offset}`
        ),
      ]);
      setSchema(schemaData);
      setRows(rowData.rows || []);
      setTotal(rowData.total || 0);
    } catch (e) {
      setErr(e.message);
      setSchema(null);
      setRows([]);
    } finally {
      setRowsLoading(false);
    }
  }, [selected, limit, offset]);

  useEffect(() => {
    loadTables();
  }, [loadTables]);

  useEffect(() => {
    setOffset(0);
  }, [selected]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  const columns = useMemo(() => schema?.columns?.map((c) => c.name) || [], [schema]);
  const editableCols = useMemo(
    () => new Set((schema?.columns || []).filter((c) => c.editable).map((c) => c.name)),
    [schema]
  );
  const pkCols = schema?.primaryKey || [];

  function openEdit(row) {
    if (schema?.readOnly) return;
    const draft = {};
    for (const col of schema.columns || []) {
      if (col.editable) draft[col.name] = row[col.name] ?? '';
    }
    setEditRow(row);
    setEditDraft(draft);
    setEditPwd('');
  }

  async function saveEdit(e) {
    e.preventDefault();
    if (!editRow || !schema) return;
    setEditBusy(true);
    setErr(null);
    try {
      const primaryKey = {};
      for (const pk of pkCols) primaryKey[pk] = editRow[pk];
      await api.put(`/api/superuser/db/tables/${encodeURIComponent(selected)}/rows`, {
        primaryKey,
        updates: editDraft,
        confirmPassword: editPwd,
      });
      setMsg('Registro actualizado.');
      setEditRow(null);
      loadRows();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setEditBusy(false);
    }
  }

  const page = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <section className="view-active">
      <div className="page-header">
        <h1 className="page-title">Explorador de datos</h1>
        <p className="page-sub muted">
          Vista directa de tablas PostgreSQL. Permite consultar y modificar registros (con contraseña).{' '}
          <strong>No permite eliminar filas.</strong>
        </p>
        <div className="page-header-actions">
          <Link to="/superusuario" className="btn btn-ghost mono">
            ← Sistema / Backup
          </Link>
        </div>
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

      <div className="db-browser">
        <aside className="db-browser__sidebar panel">
          <div className="panel-hdr">
            <span className="panel-title">Tablas</span>
          </div>
          {loading ? (
            <p className="muted mono" style={{ padding: 12 }}>
              Cargando…
            </p>
          ) : (
            <ul className="db-browser__table-list">
              {tables.map((t) => (
                <li key={t.name}>
                  <button
                    type="button"
                    className={'db-browser__table-btn' + (selected === t.name ? ' db-browser__table-btn--on' : '')}
                    onClick={() => setSelected(t.name)}
                  >
                    <span className="mono">{t.name}</span>
                    <span className="muted mono" style={{ fontSize: 10 }}>
                      {t.rowCount} filas{t.readOnly ? ' · solo lectura' : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <div className="db-browser__main panel panel--flush">
          <div className="panel-hdr" style={{ padding: '12px 16px' }}>
            <span className="panel-title mono">{selected || '—'}</span>
            {schema?.readOnly && <span className="tag tag--warn">Solo lectura</span>}
            <button type="button" className="btn btn-ghost mono" style={{ marginLeft: 'auto' }} onClick={loadRows}>
              Actualizar
            </button>
          </div>
          <div className="table-wrap db-browser__grid zgroup-scroll">
            {rowsLoading ? (
              <p className="muted mono" style={{ padding: 16 }}>
                Cargando filas…
              </p>
            ) : (
              <table className="data-table data-table--compact">
                <thead>
                  <tr>
                    {columns.map((c) => (
                      <th key={c} className="mono" style={{ fontSize: 10 }}>
                        {c}
                      </th>
                    ))}
                    {!schema?.readOnly && pkCols.length > 0 && <th>Acción</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={columns.length + 1} className="muted">
                        Sin registros
                      </td>
                    </tr>
                  ) : (
                    rows.map((row, idx) => (
                      <tr key={idx}>
                        {columns.map((c) => (
                          <td key={c} className="mono db-browser__cell" title={String(row[c] ?? '')}>
                            {cellPreview(row[c])}
                          </td>
                        ))}
                        {!schema?.readOnly && pkCols.length > 0 && (
                          <td>
                            <button type="button" className="btn-link mono" onClick={() => openEdit(row)}>
                              Editar
                            </button>
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </div>
          <div className="db-browser__pager mono">
            <button
              type="button"
              className="btn btn-ghost"
              disabled={offset <= 0}
              onClick={() => setOffset((o) => Math.max(0, o - limit))}
            >
              ← Anterior
            </button>
            <span className="muted">
              Página {page} / {totalPages} · {total} registros
            </span>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={offset + limit >= total}
              onClick={() => setOffset((o) => o + limit)}
            >
              Siguiente →
            </button>
          </div>
        </div>
      </div>

      {editRow && schema && (
        <Modal
          title={`Editar fila · ${selected}`}
          wide
          onClose={() => setEditRow(null)}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setEditRow(null)}>
                Cancelar
              </button>
              <button type="submit" form="db-edit-form" className="btn btn-primary" disabled={editBusy}>
                {editBusy ? 'Guardando…' : 'Guardar cambios'}
              </button>
            </>
          }
        >
          <form id="db-edit-form" className="stack-form" onSubmit={saveEdit}>
            <p className="muted mono" style={{ fontSize: 11 }}>
              PK: {pkCols.map((k) => `${k}=${editRow[k]}`).join(', ')}
            </p>
            {Object.keys(editDraft).map((col) => (
              <label key={col}>
                <span className="fg-lbl mono">{col}</span>
                <input
                  className="form-input mono"
                  value={editDraft[col] ?? ''}
                  onChange={(e) => setEditDraft((d) => ({ ...d, [col]: e.target.value }))}
                />
              </label>
            ))}
            <label>
              <span className="fg-lbl">Su contraseña *</span>
              <input
                type="password"
                className="form-input mono"
                required
                autoComplete="current-password"
                value={editPwd}
                onChange={(e) => setEditPwd(e.target.value)}
              />
            </label>
          </form>
        </Modal>
      )}
    </section>
  );
}
