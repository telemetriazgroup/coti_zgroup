import React, { useCallback, useState } from 'react';
import { api } from '../lib/api';
import { Modal } from './Modal';

export function CatalogPrefixRegularizePanel({ onApplied }) {
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);
  const [fixInvalid, setFixInvalid] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);

  const analyze = useCallback(async () => {
    setLoading(true);
    setErr(null);
    setMsg(null);
    try {
      const data = await api.get('/api/catalog/prefix-regularization/preview');
      setPreview(data);
    } catch (e) {
      setErr(e.message);
      setPreview(null);
    } finally {
      setLoading(false);
    }
  }, []);

  async function applyRegularization() {
    setApplying(true);
    setErr(null);
    try {
      const data = await api.post('/api/catalog/prefix-regularization/apply', {
        confirm: true,
        fixInvalidCodigos: fixInvalid,
      });
      setMsg(
        `Regularización aplicada: ${data.categoriesUpdated} categoría(s), ${data.itemsRenamed} código(s) corregido(s).`
      );
      setConfirmOpen(false);
      setAuthChecked(false);
      await analyze();
      onApplied?.();
    } catch (e) {
      setErr(e.message);
    } finally {
      setApplying(false);
    }
  }

  const needing = preview?.categories?.filter((c) => !c.skipped && c.hasChanges) || [];

  return (
    <div className="panel" style={{ padding: 16 }}>
      <div className="panel-hdr" style={{ marginBottom: 12 }}>
        <span className="panel-title">Regularizar prefijos y correlativos</span>
      </div>
      <p className="muted mono" style={{ fontSize: 12, marginBottom: 14, lineHeight: 1.45 }}>
        Analiza todas las categorías con prefijo configurado. Ajusta el correlativo siguiente según los códigos
        existentes y, si lo autoriza, renombra ítems que no cumplan el formato PREFIJO-####.
      </p>

      {err && (
        <div className="banner banner--err mono" style={{ marginBottom: 12 }}>
          {err}
        </div>
      )}
      {msg && (
        <div className="banner mono" style={{ marginBottom: 12, borderColor: 'var(--green)', color: 'var(--green)' }}>
          {msg}
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16, alignItems: 'center' }}>
        <button type="button" className="btn btn-primary mono" disabled={loading} onClick={analyze}>
          {loading ? 'Analizando…' : 'Analizar catálogo'}
        </button>
        {preview && (
          <>
            <label className="chk-row">
              <input type="checkbox" checked={fixInvalid} onChange={(e) => setFixInvalid(e.target.checked)} />
              <span className="mono" style={{ fontSize: 12 }}>
                Corregir códigos con formato inválido
              </span>
            </label>
            <button
              type="button"
              className="btn btn-ghost mono"
              style={{ color: 'var(--amber)' }}
              disabled={!needing.length || applying}
              onClick={() => setConfirmOpen(true)}
            >
              Autorizar y aplicar cambios
            </button>
          </>
        )}
      </div>

      {preview?.summary && (
        <p className="mono muted" style={{ fontSize: 12, marginBottom: 12 }}>
          Categorías: {preview.summary.total} · Con prefijo: {preview.summary.withPrefix} · Requieren ajuste:{' '}
          {preview.summary.needingUpdate} · Ítems con formato inválido: {preview.summary.invalidItems}
        </p>
      )}

      {preview?.categories?.length > 0 && (
        <div className="table-wrap">
          <table className="data-table data-table--compact">
            <thead>
              <tr>
                <th>Categoría</th>
                <th>Prefijo</th>
                <th className="num">Ítems</th>
                <th className="num">Inválidos</th>
                <th className="num">next_seq</th>
                <th className="num">→ propuesto</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {preview.categories.map((c) => (
                <tr key={c.categoryId} className={!c.skipped && c.hasChanges ? '' : 'row-dim'}>
                  <td>{c.nombre}</td>
                  <td className="mono">{c.prefix || '—'}</td>
                  <td className="num mono">{c.skipped ? '—' : c.itemCount}</td>
                  <td className="num mono">{c.skipped ? '—' : c.invalidCount}</td>
                  <td className="num mono">{c.skipped ? '—' : c.currentNextSeq}</td>
                  <td className="num mono">{c.skipped ? '—' : c.proposedNextSeq}</td>
                  <td className="mono" style={{ fontSize: 11 }}>
                    {c.skipped ? (
                      <span className="muted">{c.reason}</span>
                    ) : c.hasChanges ? (
                      <span style={{ color: 'var(--amber)' }}>Pendiente</span>
                    ) : (
                      <span style={{ color: 'var(--green)' }}>OK</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {needing.some((c) => c.proposedFixes?.length > 0) && (
        <div style={{ marginTop: 16 }}>
          <h3 className="mono" style={{ fontSize: 13, marginBottom: 8 }}>
            Códigos propuestos (formato inválido)
          </h3>
          <div className="table-wrap">
            <table className="data-table data-table--compact">
              <thead>
                <tr>
                  <th>Categoría</th>
                  <th>Actual</th>
                  <th>→ Propuesto</th>
                </tr>
              </thead>
              <tbody>
                {needing.flatMap((c) =>
                  (c.proposedFixes || []).map((f) => (
                    <tr key={f.id}>
                      <td>{c.nombre}</td>
                      <td className="mono">{f.codigo}</td>
                      <td className="mono" style={{ color: 'var(--cyan)' }}>
                        {f.suggestedCodigo}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {confirmOpen && (
        <Modal
          title="Autorizar regularización"
          onClose={() => {
            setConfirmOpen(false);
            setAuthChecked(false);
          }}
          footer={
            <>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setConfirmOpen(false);
                  setAuthChecked(false);
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!authChecked || applying}
                onClick={applyRegularization}
              >
                {applying ? 'Aplicando…' : 'Confirmar y aplicar'}
              </button>
            </>
          }
        >
          <p className="muted" style={{ marginBottom: 12, lineHeight: 1.45 }}>
            Se actualizarán los correlativos de <strong>{needing.length}</strong> categoría(s).
            {fixInvalid && preview?.summary?.invalidItems > 0 && (
              <>
                {' '}
                Se renombrarán <strong>{preview.summary.invalidItems}</strong> ítem(s) al formato PREFIJO-####.
              </>
            )}
          </p>
          <label className="chk-row">
            <input type="checkbox" checked={authChecked} onChange={(e) => setAuthChecked(e.target.checked)} />
            <span>Autorizo esta regularización como superusuario</span>
          </label>
        </Modal>
      )}
    </div>
  );
}
