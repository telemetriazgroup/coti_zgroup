import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { mergeFinanceParams } from '@shared/finance-engine.js';

const FIELDS = [
  { key: 'adjType', label: 'M1 tipo de ajuste', type: 'select', options: ['margin', 'discount'] },
  { key: 'adjPct', label: 'M1 % margen/descuento', type: 'number', step: 0.5 },
  { key: 'enableCp', label: 'Habilitar corto plazo', type: 'bool' },
  { key: 'cpPlazo', label: 'CP plazo contrato (meses)', type: 'number' },
  { key: 'cpVida', label: 'CP vida útil (meses)', type: 'number' },
  { key: 'cpOp', label: 'CP gtos. op. %', type: 'number', step: 0.5 },
  { key: 'cpRoa', label: 'CP ROA %', type: 'number', step: 0.5 },
  { key: 'cpMerma', label: 'CP merma %', type: 'number', step: 0.5 },
  { key: 'enableLp', label: 'Habilitar largo plazo', type: 'bool' },
  { key: 'lpN', label: 'LP plazo préstamo (meses)', type: 'number' },
  { key: 'lpNContrato', label: 'LP plazo contrato (meses)', type: 'number' },
  { key: 'lpVida', label: 'LP vida útil (meses)', type: 'number' },
  { key: 'lpTeaBanco', label: 'LP TEA banco %', type: 'number', step: 0.1 },
  { key: 'lpMargen', label: 'LP margen ZGROUP %', type: 'number', step: 0.5 },
  { key: 'lpOp', label: 'LP gtos. op. %', type: 'number', step: 0.5 },
  { key: 'enableEst', label: 'Habilitar estacionalidad', type: 'bool' },
  { key: 'estOp', label: 'Est. meses operativos', type: 'number' },
  { key: 'estSb', label: 'Est. meses standby', type: 'number' },
  { key: 'cmpPeriod', label: 'Gerencia horizonte (meses)', type: 'number' },
];

export function FinanceDefaultsPage() {
  const [form, setForm] = useState(() => mergeFinanceParams({}));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const data = await api.get('/api/settings/finance-defaults');
      setForm(mergeFinanceParams(data || {}));
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const data = await api.put('/api/settings/finance-defaults', mergeFinanceParams(form));
      setForm(mergeFinanceParams(data || form));
      setMsg('Predeterminados guardados. Los proyectos nuevos los copian al crearse.');
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

  function setKey(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <section className="view-active">
      <div className="page-header">
        <h1 className="page-title">Parámetros financieros predeterminados</h1>
        <p className="page-sub muted">
          Solo admin y superusuario. Cada proyecto nuevo se crea con esta configuración. El semiadmin puede
          ajustar M1 y plazos en cada cotización; estacionalidad y gerencia quedan bloqueados.
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
      {loading ? (
        <p className="muted mono">Cargando…</p>
      ) : (
        <form className="panel" style={{ padding: 16 }} onSubmit={save}>
          <div className="fin-grid fin-grid--3">
            {FIELDS.map((f) => (
              <label key={f.key} className="fin-param">
                <span className="fin-param__label">{f.label}</span>
                {f.type === 'bool' ? (
                  <input
                    type="checkbox"
                    checked={form[f.key] !== false}
                    onChange={(e) => setKey(f.key, e.target.checked)}
                  />
                ) : f.type === 'select' ? (
                  <select
                    className="form-input mono"
                    value={form[f.key] || 'margin'}
                    onChange={(e) => setKey(f.key, e.target.value)}
                  >
                    {f.options.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="number"
                    step={f.step || 1}
                    className="form-input mono"
                    value={form[f.key] ?? ''}
                    onChange={(e) => setKey(f.key, parseFloat(e.target.value) || 0)}
                  />
                )}
              </label>
            ))}
          </div>
          <div style={{ marginTop: 16 }}>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Guardando…' : 'Guardar predeterminados'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
