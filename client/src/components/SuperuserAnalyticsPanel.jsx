import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';

function formatUsd(n) {
  if (n == null || Number.isNaN(n)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

function userLabel(u) {
  const name = [u.nombres, u.apellidos].filter(Boolean).join(' ').trim();
  return name || u.email || '—';
}

const PERIOD_TABS = [
  { id: 'day', label: 'Por día (30 días)' },
  { id: 'week', label: 'Por semana (12 sem.)' },
  { id: 'month', label: 'Por mes (12 meses)' },
];

function PeriodSeriesTable({ rows, periodLabel }) {
  if (!rows?.length) {
    return <p className="muted">Sin datos en el periodo.</p>;
  }
  return (
    <div className="table-wrap">
      <table className="data-table data-table--compact">
        <thead>
          <tr>
            <th>{periodLabel}</th>
            <th className="num">Cotizaciones</th>
            <th className="num">Ítems agregados</th>
            <th className="num">Valor lista</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.period}>
              <td className="mono">{r.period}</td>
              <td className="num mono">{r.projectsCount}</td>
              <td className="num mono">{r.itemsCount}</td>
              <td className="num mono">{formatUsd(r.pipelineValue)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SuperuserAnalyticsPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [periodTab, setPeriodTab] = useState('day');

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const res = await api.get('/api/dashboard/superuser-analytics');
        if (alive) setData(res);
      } catch (e) {
        if (alive) {
          setData(null);
          setErr(e.message || 'No se pudieron cargar las analíticas');
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const seriesRows = useMemo(() => {
    if (!data?.series) return [];
    if (periodTab === 'week') return data.series.week || [];
    if (periodTab === 'month') return data.series.month || [];
    return data.series.day || [];
  }, [data, periodTab]);

  const periodLabel =
    periodTab === 'week' ? 'Semana' : periodTab === 'month' ? 'Mes' : 'Día';

  if (loading) {
    return (
      <div className="panel dash-analytics">
        <div className="panel-hdr">
          <span className="panel-title">Indicadores de cotizaciones</span>
        </div>
        <p className="muted">Cargando analíticas…</p>
      </div>
    );
  }

  if (err) {
    return (
      <div className="panel dash-analytics">
        <div className="panel-hdr">
          <span className="panel-title">Indicadores de cotizaciones</span>
        </div>
        <p className="banner banner--err">{err}</p>
      </div>
    );
  }

  const ov = data?.overview || {};

  return (
    <>
      <h2 className="budget-panel-title dash-analytics__title">Indicadores de cotizaciones</h2>

      <div className="kpi-grid dash-analytics__kpis">
        <div className="kpi-card">
          <div className="kpi-label mono">Usuarios con cotizaciones</div>
          <div className="kpi-value">{ov.usersWithProjects ?? '—'}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label mono">Cotizaciones (total)</div>
          <div className="kpi-value">{ov.projectsTotal ?? '—'}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label mono">Valor lista (total)</div>
          <div className="kpi-value">{formatUsd(ov.pipelineTotal)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label mono">Ítems en presupuestos</div>
          <div className="kpi-value">{ov.itemsTotal ?? '—'}</div>
        </div>
      </div>

      <div className="kpi-grid dash-analytics__kpis dash-analytics__kpis--period">
        <div className="kpi-card kpi-card--accent">
          <div className="kpi-label mono">Cotizaciones hoy</div>
          <div className="kpi-value">{ov.projectsToday ?? 0}</div>
          <div className="kpi-sub muted">Esta semana: {ov.projectsWeek ?? 0} · Este mes: {ov.projectsMonth ?? 0}</div>
        </div>
        <div className="kpi-card kpi-card--accent">
          <div className="kpi-label mono">Ítems agregados hoy</div>
          <div className="kpi-value">{ov.itemsToday ?? 0}</div>
          <div className="kpi-sub muted">Esta semana: {ov.itemsWeek ?? 0} · Este mes: {ov.itemsMonth ?? 0}</div>
        </div>
      </div>

      <div className="panel dash-analytics">
        <div className="panel-hdr dash-analytics__hdr">
          <span className="panel-title">Actividad por periodo</span>
          <div className="dash-analytics__tabs" role="tablist" aria-label="Granularidad del periodo">
            {PERIOD_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={periodTab === t.id}
                className={`btn btn-ghost${periodTab === t.id ? ' dash-analytics__tab--active' : ''}`}
                onClick={() => setPeriodTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <PeriodSeriesTable rows={seriesRows} periodLabel={periodLabel} />
      </div>

      <div className="panel dash-analytics" style={{ marginTop: 16 }}>
        <div className="panel-hdr">
          <span className="panel-title">Por usuario</span>
        </div>
        <div className="table-wrap">
          <table className="data-table data-table--compact">
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Rol</th>
                <th className="num">Cotiz.</th>
                <th className="num">Valor lista</th>
                <th className="num">Ítems</th>
                <th className="num" title="Cotizaciones creadas hoy">Cot. hoy</th>
                <th className="num" title="Cotizaciones creadas esta semana">Cot. sem.</th>
                <th className="num" title="Cotizaciones creadas este mes">Cot. mes</th>
                <th className="num" title="Ítems agregados hoy">It. hoy</th>
                <th className="num" title="Ítems agregados esta semana">It. sem.</th>
                <th className="num" title="Ítems agregados este mes">It. mes</th>
              </tr>
            </thead>
            <tbody>
              {data?.byUser?.length ? (
                data.byUser.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <span className="mono">{userLabel(u)}</span>
                      {u.email && userLabel(u) !== u.email && (
                        <div className="muted" style={{ fontSize: 11 }}>{u.email}</div>
                      )}
                    </td>
                    <td className="mono">{u.role}</td>
                    <td className="num mono">{u.projectsTotal}</td>
                    <td className="num mono">{formatUsd(u.pipelineValue)}</td>
                    <td className="num mono">{u.itemsTotal}</td>
                    <td className="num mono">{u.projectsToday}</td>
                    <td className="num mono">{u.projectsWeek}</td>
                    <td className="num mono">{u.projectsMonth}</td>
                    <td className="num mono">{u.itemsToday}</td>
                    <td className="num mono">{u.itemsWeek}</td>
                    <td className="num mono">{u.itemsMonth}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={11} className="muted">
                    Ningún usuario ha creado cotizaciones aún.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel dash-analytics" style={{ marginTop: 16 }}>
        <div className="panel-hdr">
          <span className="panel-title">Ítems más referenciados en cotizaciones</span>
        </div>
        <div className="table-wrap">
          <table className="data-table data-table--compact">
            <thead>
              <tr>
                <th>#</th>
                <th>Código</th>
                <th>Descripción</th>
                <th className="num">Líneas</th>
                <th className="num">Cotizaciones</th>
                <th className="num">Cant. total</th>
                <th className="num">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {data?.topCatalogItems?.length ? (
                data.topCatalogItems.map((it, i) => (
                  <tr key={it.catalogItemId}>
                    <td className="num mono">{i + 1}</td>
                    <td className="mono">{it.codigo}</td>
                    <td>{it.descripcion}</td>
                    <td className="num mono">{it.lineCount}</td>
                    <td className="num mono">{it.projectCount}</td>
                    <td className="num mono">{it.totalQty}</td>
                    <td className="num mono">{formatUsd(it.totalSubtotal)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="muted">
                    Sin ítems de catálogo en presupuestos.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
