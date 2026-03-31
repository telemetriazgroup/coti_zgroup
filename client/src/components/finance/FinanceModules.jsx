import React, { useMemo, useState } from 'react';
import { computeFinance, mergeFinanceParams } from '@shared/finance-engine.js';

function formatUsd(n) {
  if (n == null || Number.isNaN(n)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

function Accordion({ id, title, subtitle, badge, open, onToggle, children, disabled }) {
  return (
    <div className={`fin-acc ${disabled ? 'fin-acc--off' : ''}`}>
      <button
        type="button"
        className="fin-acc__head"
        onClick={() => onToggle(id)}
        aria-expanded={open}
      >
        <span className="fin-acc__chev">{open ? '▼' : '▶'}</span>
        <span className="fin-acc__title">{title}</span>
        {badge && (
          <span className="fin-acc__badge mono" style={{ marginLeft: 'auto' }}>
            {badge}
          </span>
        )}
      </button>
      {subtitle && <div className="fin-acc__sub mono muted">{subtitle}</div>}
      {open && <div className="fin-acc__body">{children}</div>}
    </div>
  );
}

export function FinanceModules({
  baseLista,
  baseActivos,
  baseConsumibles,
  financeParams,
  onFinanceParamsChange,
  viewerMode,
}) {
  const p = useMemo(() => mergeFinanceParams(financeParams), [financeParams]);
  const fin = useMemo(
    () =>
      computeFinance({
        baseLista,
        baseActivos,
        baseConsumibles,
        params: p,
      }),
    [baseLista, baseActivos, baseConsumibles, p]
  );

  const [open, setOpen] = useState(() => ({
    m1: true,
    m2: false,
    m3: false,
    m4: false,
    m5: true,
  }));
  const [showAmort, setShowAmort] = useState(false);

  const toggle = (id) => setOpen((o) => ({ ...o, [id]: !o[id] }));

  function patch(next) {
    onFinanceParamsChange({ ...p, ...next });
  }

  const { m1, m2, m3, m4, m5 } = fin;
  const hideSensitive = !!viewerMode;

  return (
    <div className="fin-wrap">
      <h2 className="budget-panel-title" style={{ marginBottom: 12 }}>
        Módulos financieros
      </h2>
      <p className="muted mono" style={{ fontSize: 11, marginBottom: 12 }}>
        M1 define TOTAL VENTA; M2–M4 se recalculan en cascada; M5 resume CP vs LP (mismo criterio que PDF
        Gerencia). Activa modalidades y ajusta parámetros.
      </p>

      <div className="fin-toggles mono">
        <label className="fin-check">
          <input
            type="checkbox"
            checked={p.enableCp !== false}
            disabled={hideSensitive}
            onChange={(e) => patch({ enableCp: e.target.checked })}
          />
          Corto plazo (CP)
        </label>
        <label className="fin-check">
          <input
            type="checkbox"
            checked={p.enableLp !== false}
            disabled={hideSensitive}
            onChange={(e) => patch({ enableLp: e.target.checked })}
          />
          Largo plazo (LP)
        </label>
        <label className="fin-check">
          <input
            type="checkbox"
            checked={p.enableEst !== false}
            disabled={hideSensitive}
            onChange={(e) => patch({ enableEst: e.target.checked })}
          />
          Estacionalidad
        </label>
      </div>

      <Accordion
        id="m1"
        title="M1 · Venta directa"
        subtitle="Base lista y ajuste comercial"
        badge={`TOTAL VENTA ${formatUsd(m1.ventaTotal)}`}
        open={open.m1}
        onToggle={toggle}
      >
        {!hideSensitive && (
          <div className="fin-row fin-row--modes">
            <button
              type="button"
              className={`fin-pill ${m1.adjType === 'margin' ? 'fin-pill--on' : ''}`}
              onClick={() => patch({ adjType: 'margin' })}
            >
              Margen seguridad
            </button>
            <button
              type="button"
              className={`fin-pill ${m1.adjType === 'discount' ? 'fin-pill--on' : ''}`}
              onClick={() => patch({ adjType: 'discount' })}
            >
              Descuento
            </button>
          </div>
        )}
        <div className="fin-grid">
          <label>
            <span className="fg-lbl">
              {m1.adjType === 'margin' ? 'Margen (+) %' : 'Descuento (−) %'}
            </span>
            <input
              type="number"
              step="0.5"
              className="form-input mono"
              disabled={hideSensitive}
              value={p.adjPct ?? 0}
              onChange={(e) => patch({ adjPct: parseFloat(e.target.value) || 0 })}
            />
          </label>
        </div>
        <div className="fin-kpis mono">
          <div>
            <span className="muted">Base lista</span> {formatUsd(m1.base)}
          </div>
          {!hideSensitive && (
            <div>
              <span className="muted">Ajuste</span>{' '}
              <span style={{ color: m1.adjType === 'margin' ? 'var(--amber)' : 'var(--red)' }}>
                {m1.adjType === 'margin' ? '+' : '−'}
                {formatUsd(m1.ventaAdj)}
              </span>
            </div>
          )}
          <div className="fin-kpi-strong">
            <span className="muted">TOTAL VENTA</span> {formatUsd(m1.ventaTotal)}
          </div>
        </div>
        {m1.discount100Warning && (
          <div className="banner banner--warn mono" style={{ marginTop: 8 }}>
            Descuento 100%: venta $0 — revisar parámetros.
          </div>
        )}
      </Accordion>

      <Accordion
        id="m2"
        title="M2 · Corto plazo"
        subtitle={p.enableCp === false ? 'Desactivado' : 'Capital propio / alquiler'}
        badge={p.enableCp === false ? '—' : `${formatUsd(m2.rentaCliente)}/mes`}
        open={open.m2}
        onToggle={toggle}
        disabled={p.enableCp === false}
      >
        {p.enableCp !== false && (
          <>
            {!hideSensitive && (
              <div className="fin-grid fin-grid--3">
                <label>
                  <span className="fg-lbl">Plazo contrato (meses)</span>
                  <input
                    type="number"
                    min={1}
                    className="form-input mono"
                    value={p.cpPlazo}
                    onChange={(e) => patch({ cpPlazo: parseInt(e.target.value, 10) || 1 })}
                  />
                </label>
                <label>
                  <span className="fg-lbl">Vida útil CP (meses)</span>
                  <input
                    type="number"
                    min={1}
                    className="form-input mono"
                    value={p.cpVida}
                    onChange={(e) => patch({ cpVida: parseInt(e.target.value, 10) || 1 })}
                  />
                </label>
                <label>
                  <span className="fg-lbl">Gtos. op. % anual</span>
                  <input
                    type="number"
                    step="0.5"
                    className="form-input mono"
                    value={p.cpOp}
                    onChange={(e) => patch({ cpOp: parseFloat(e.target.value) || 0 })}
                  />
                </label>
                <label>
                  <span className="fg-lbl">ROA % anual</span>
                  <input
                    type="number"
                    step="0.5"
                    className="form-input mono"
                    value={p.cpRoa}
                    onChange={(e) => patch({ cpRoa: parseFloat(e.target.value) || 0 })}
                  />
                </label>
                <label>
                  <span className="fg-lbl">Merma montaje %</span>
                  <input
                    type="number"
                    step="0.5"
                    className="form-input mono"
                    value={p.cpMerma}
                    onChange={(e) => patch({ cpMerma: parseFloat(e.target.value) || 0 })}
                  />
                </label>
              </div>
            )}
            <div className="fin-table mono">
              {!hideSensitive && (
                <>
                  <div className="fin-table__row">
                    <span>Depreciación / mes</span>
                    <span>{formatUsd(m2.depreciationMonthly)}</span>
                  </div>
                  <div className="fin-table__row">
                    <span>Merma / mes</span>
                    <span>{formatUsd(m2.mermaMonthly)}</span>
                  </div>
                  <div className="fin-table__row">
                    <span>Gtos. op. / mes</span>
                    <span>{formatUsd(m2.gopMonthly)}</span>
                  </div>
                  {baseConsumibles > 0 && (
                    <div className="fin-table__row">
                      <span>Consumibles / mes</span>
                      <span>{formatUsd(m2.consumiblesMonthly)}</span>
                    </div>
                  )}
                  <div className="fin-table__row">
                    <span style={{ color: 'var(--amber)' }}>ROA / mes (ganancia)</span>
                    <span style={{ color: 'var(--amber)' }}>{formatUsd(m2.roaMonthly)}</span>
                  </div>
                </>
              )}
              <div className="fin-table__row fin-table__row--hi">
                <span>Renta al cliente</span>
                <span>{formatUsd(m2.rentaCliente)}/mes</span>
              </div>
            </div>
            {!hideSensitive && (
              <div className="fin-kpi-line">
                <span className="fin-kpi-tag fin-kpi-tag--green">
                  Ganancia / mes {formatUsd(m2.gananciaMensual)}
                </span>
                <span className="fin-kpi-tag fin-kpi-tag--cyan">
                  Punto equilibrio {m2.peDisplay}
                </span>
              </div>
            )}
            {m2.warningVidaMenorPlazo && (
              <div className="banner banner--warn mono" style={{ marginTop: 8 }}>
                Vida útil &lt; plazo contrato: depreciación acumulada excede valor en el plazo.
              </div>
            )}
          </>
        )}
      </Accordion>

      <Accordion
        id="m3"
        title="M3 · Largo plazo (leasing)"
        subtitle={p.enableLp === false ? 'Desactivado' : 'Sistema francés · F1 / F2'}
        badge={p.enableLp === false ? '—' : `${formatUsd(m3.lpRentaF1)}/m F1`}
        open={open.m3}
        onToggle={toggle}
        disabled={p.enableLp === false}
      >
        {p.enableLp !== false && (
          <>
            {hideSensitive && (
              <p className="mono" style={{ marginBottom: 8 }}>
                Renta cliente F1: <span style={{ color: 'var(--cyan)' }}>{formatUsd(m3.lpRentaF1)}/mes</span>
              </p>
            )}
            {!hideSensitive && (
              <div className="fin-grid fin-grid--3">
                <label>
                  <span className="fg-lbl">Vida útil LP (meses)</span>
                  <input
                    type="number"
                    min={1}
                    className="form-input mono"
                    value={p.lpVida}
                    onChange={(e) => patch({ lpVida: parseInt(e.target.value, 10) || 1 })}
                  />
                </label>
                <label>
                  <span className="fg-lbl">Plazo préstamo banco (meses)</span>
                  <input
                    type="number"
                    min={1}
                    className="form-input mono"
                    value={p.lpN}
                    onChange={(e) => patch({ lpN: parseInt(e.target.value, 10) || 1 })}
                  />
                </label>
                <label>
                  <span className="fg-lbl">Plazo contrato (meses)</span>
                  <input
                    type="number"
                    min={1}
                    className="form-input mono"
                    value={p.lpNContrato}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10) || 1;
                      patch({ lpNContrato: Math.max(p.lpN || 24, v) });
                    }}
                  />
                </label>
                <label>
                  <span className="fg-lbl">TEA banco %</span>
                  <input
                    type="number"
                    step="0.1"
                    className="form-input mono"
                    value={p.lpTeaBanco}
                    onChange={(e) => patch({ lpTeaBanco: parseFloat(e.target.value) || 0 })}
                  />
                </label>
                <label>
                  <span className="fg-lbl">TEA cotización cliente %</span>
                  <input
                    type="number"
                    step="0.1"
                    className="form-input mono"
                    value={p.lpTeaCot}
                    onChange={(e) => patch({ lpTeaCot: parseFloat(e.target.value) || 0 })}
                  />
                </label>
                <label>
                  <span className="fg-lbl">Gtos. op. % anual</span>
                  <input
                    type="number"
                    step="0.5"
                    className="form-input mono"
                    value={p.lpOp}
                    onChange={(e) => patch({ lpOp: parseFloat(e.target.value) || 0 })}
                  />
                </label>
                <label>
                  <span className="fg-lbl">Gastos formalización USD</span>
                  <input
                    type="number"
                    step="1"
                    className="form-input mono"
                    value={p.lpForm}
                    onChange={(e) => patch({ lpForm: parseFloat(e.target.value) || 0 })}
                  />
                </label>
                <label>
                  <span className="fg-lbl">Renta post-préstamo % F1</span>
                  <input
                    type="number"
                    step="1"
                    className="form-input mono"
                    value={p.lpPostPct}
                    onChange={(e) => patch({ lpPostPct: parseFloat(e.target.value) || 0 })}
                  />
                </label>
                <label>
                  <span className="fg-lbl">Fondo reposición % anual</span>
                  <input
                    type="number"
                    step="0.5"
                    className="form-input mono"
                    value={p.lpFondoRep}
                    onChange={(e) => patch({ lpFondoRep: parseFloat(e.target.value) || 0 })}
                  />
                </label>
              </div>
            )}
            {m3.lpSpreadNegative && !hideSensitive && (
              <div className="banner banner--err mono">
                Tasa cliente &lt; TEA banco: spread negativo. Ajuste tasas.
              </div>
            )}
            <div className="fin-timeline mono">
              <div className="fin-timeline__bar">
                <div
                  className="fin-timeline__f1"
                  style={{ flex: `0 0 ${m3.timeline.f1Pct}%` }}
                  title="F1"
                />
                <div
                  className="fin-timeline__f2"
                  style={{ flex: `0 0 ${m3.timeline.f2Pct}%` }}
                  title="F2"
                />
                <div
                  className="fin-timeline__marker"
                  style={{ left: `calc(${m3.timeline.f1Pct}% - 1px)` }}
                />
              </div>
              <div className="fin-timeline__lbl muted" style={{ fontSize: 10 }}>
                F1 {m3.lpNPrestamo}m · F2 {m3.lpNF2}m · Total {m3.lpNContrato}m
              </div>
            </div>
            {!hideSensitive && (
              <div className="fin-table mono">
                <div className="fin-table__row">
                  <span>Cuota banco</span>
                  <span>{formatUsd(m3.cuotaBanco)}</span>
                </div>
                <div className="fin-table__row">
                  <span>Cuota cliente (mismo N)</span>
                  <span>{formatUsd(m3.cuotaCliente)}</span>
                </div>
                <div className="fin-table__row">
                  <span>Spread / mes</span>
                  <span>{formatUsd(m3.lpSpread)}</span>
                </div>
                <div className="fin-table__row fin-table__row--hi">
                  <span>Renta F1 (cliente)</span>
                  <span>{formatUsd(m3.lpRentaF1)}/mes</span>
                </div>
                <div className="fin-table__row">
                  <span>Renta F2</span>
                  <span>{formatUsd(m3.lpRentaF2)}/mes</span>
                </div>
                <div className="fin-table__row">
                  <span>Util. F1 / mes</span>
                  <span>{formatUsd(m3.lpGanF1)}</span>
                </div>
                <div className="fin-table__row">
                  <span>Util. F2 / mes</span>
                  <span>{formatUsd(m3.lpGanF2)}</span>
                </div>
                <div className="fin-table__row">
                  <span>Total ciclo utilidad</span>
                  <span>{formatUsd(m3.lpTotalCiclo)}</span>
                </div>
                <div className="fin-table__row">
                  <span>PE formalización</span>
                  <span>{m3.lpPEDisplay}</span>
                </div>
              </div>
            )}
            {m3.activarFondoReposicion && !hideSensitive && (
              <div className="banner banner--warn mono" style={{ marginTop: 8 }}>
                Contrato &gt; 80% vida útil: fondo reposición {formatUsd(m3.lpFondoMensual)}/mes.
              </div>
            )}
            {!hideSensitive && (
              <button
                type="button"
                className="btn btn-ghost mono"
                style={{ marginTop: 8 }}
                onClick={() => setShowAmort((s) => !s)}
              >
                {showAmort ? '▲ Ocultar' : '▼'} Tabla amortización banco
              </button>
            )}
            {showAmort && !hideSensitive && (
              <div className="fin-amort-wrap">
                <table className="data-table fin-amort">
                  <thead>
                    <tr>
                      <th>N°</th>
                      <th className="num">Saldo ini.</th>
                      <th className="num">Interés</th>
                      <th className="num">Amort.</th>
                      <th className="num">Cuota</th>
                    </tr>
                  </thead>
                  <tbody>
                    {m3.amortization.map((r) => (
                      <tr key={r.period}>
                        <td className="mono">{r.period}</td>
                        <td className="num mono">{formatUsd(r.saldoInicial)}</td>
                        <td className="num mono">{formatUsd(r.interes)}</td>
                        <td className="num mono">{formatUsd(r.amortizacion)}</td>
                        <td className="num mono">{formatUsd(r.cuota)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Accordion>

      <Accordion
        id="m4"
        title="M4 · Estacionalidad"
        subtitle={p.enableEst === false ? 'Desactivado' : 'Tabla 5 años · Regla de Oro'}
        badge={p.enableEst === false ? '—' : `${formatUsd(m4.estIngTotalYear)}/año`}
        open={open.m4}
        onToggle={toggle}
        disabled={p.enableEst === false}
      >
        {p.enableEst !== false && (
          <>
            {hideSensitive && (
              <p className="mono" style={{ marginBottom: 8 }}>
                Ingreso anual estimado:{' '}
                <span style={{ color: 'var(--cyan)' }}>{formatUsd(m4.estIngTotalYear)}/año</span>
              </p>
            )}
            {!hideSensitive && (
              <div className="fin-grid fin-grid--3">
                <label>
                  <span className="fg-lbl">Meses operativos</span>
                  <input
                    type="number"
                    min={1}
                    className="form-input mono"
                    value={p.estOp}
                    onChange={(e) => patch({ estOp: parseInt(e.target.value, 10) || 1 })}
                  />
                </label>
                <label>
                  <span className="fg-lbl">Meses standby</span>
                  <input
                    type="number"
                    min={1}
                    className="form-input mono"
                    value={p.estSb}
                    onChange={(e) => patch({ estSb: parseInt(e.target.value, 10) || 1 })}
                  />
                </label>
                <label>
                  <span className="fg-lbl">Seguro % anual</span>
                  <input
                    type="number"
                    step="0.1"
                    className="form-input mono"
                    value={p.estSeguro}
                    onChange={(e) => patch({ estSeguro: parseFloat(e.target.value) || 0 })}
                  />
                </label>
                <label>
                  <span className="fg-lbl">% ajuste standby</span>
                  <input
                    type="number"
                    step="1"
                    className="form-input mono"
                    value={p.estSbPct}
                    onChange={(e) => patch({ estSbPct: parseFloat(e.target.value) || 0 })}
                  />
                </label>
              </div>
            )}
            {m4.standbyBelowMin && !hideSensitive && (
              <div className="banner banner--err mono">
                Standby {formatUsd(m4.estRentaSb)}/mes &lt; costo mínimo {formatUsd(m4.estCostoMin)}
                . Subir % standby a ≥ {m4.minStandbyPct}%.
              </div>
            )}
            {!hideSensitive && (
              <div className="fin-kpis mono" style={{ marginTop: 8 }}>
                <div>
                  <span className="muted">Ratio estacional</span> {m4.seasonalRatio.toFixed(4)}
                </div>
                <div>
                  <span className="muted">Regla de Oro (5 años)</span>{' '}
                  {m4.reglaDeOro.ok ? '✓' : '⚠'}{' '}
                  {formatUsd(m4.reglaDeOro.actual)} vs {formatUsd(m4.reglaDeOro.expected)}
                </div>
              </div>
            )}
            <div className="table-wrap" style={{ marginTop: 8 }}>
              <table className="data-table fin-5y">
                <thead>
                  <tr>
                    <th>Año</th>
                    <th className="num">Ingreso</th>
                    <th className="num">Pago banco</th>
                    <th className="num">Gtos.op</th>
                    <th className="num">Util. neta</th>
                    <th className="num">Acum.</th>
                  </tr>
                </thead>
                <tbody>
                  {m4.fiveYearRows.map((row) => (
                    <React.Fragment key={row.year}>
                      <tr className={row.year % 2 === 0 ? 'fin-5y--even' : ''}>
                        <td className="mono">
                          Año {row.year}
                          <div className="muted" style={{ fontSize: 9 }}>
                            {row.phaseLabel} · m{row.monthStart}–{row.monthEnd}
                          </div>
                        </td>
                        <td className="num mono">{formatUsd(row.ingBruto)}</td>
                        <td className="num mono">{formatUsd(row.pagoBanco)}</td>
                        <td className="num mono">{formatUsd(row.gopYear)}</td>
                        <td className="num mono">{formatUsd(row.utilNeta)}</td>
                        <td className="num mono">{formatUsd(row.cumAcum)}</td>
                      </tr>
                      {row.showTransitionBanner && !hideSensitive && (
                        <tr className="fin-5y-banner fin-5y-banner--cyan">
                          <td colSpan={6}>
                            Mes {m3.lpNPrestamo}: banco liquidado — transición F1→F2
                          </td>
                        </tr>
                      )}
                      {row.showF2FullYearBanner && !hideSensitive && (
                        <tr className="fin-5y-banner fin-5y-banner--green">
                          <td colSpan={6}>Pago banco $0 — activo libre</td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="mono">
                    <td>Σ 5 años</td>
                    <td className="num">{formatUsd(m4.totals5y.totIng)}</td>
                    <td className="num">{formatUsd(m4.totals5y.totBanco)}</td>
                    <td className="num">{formatUsd(m4.totals5y.totGop)}</td>
                    <td className="num">{formatUsd(m4.totals5y.totUtil)}</td>
                    <td className="num">{formatUsd(m4.totals5y.cumAcum)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </Accordion>

      <Accordion
        id="m5"
        title="M5 · Panel gerencial"
        subtitle="Comparativa CP vs LP · PDF Gerencia"
        badge={
          m5.lpMasBaratoCliente ? 'LP más barata (F1)' : 'Revisar rentas'
        }
        open={open.m5}
        onToggle={toggle}
      >
        {!hideSensitive && (
          <div className="fin-grid fin-grid--3" style={{ marginBottom: 12 }}>
            <label>
              <span className="fg-lbl">Horizonte comparativo (meses)</span>
              <input
                type="number"
                min={1}
                max={120}
                className="form-input mono"
                value={p.cmpPeriod ?? 24}
                onChange={(e) =>
                  patch({ cmpPeriod: Math.min(120, Math.max(1, parseInt(e.target.value, 10) || 24)) })
                }
              />
            </label>
          </div>
        )}
        <div className="fin-table mono" style={{ marginBottom: 12 }}>
          <div className="fin-table__row">
            <span>Horizonte</span>
            <span>
              {m5.cmpPeriod} meses
            </span>
          </div>
          <div className="fin-table__row">
            <span>Renta al cliente (ref.) · CP</span>
            <span>{formatUsd(m5.cpRenta)}/mes</span>
          </div>
          <div className="fin-table__row">
            <span>Renta Fase 1 · LP</span>
            <span>{formatUsd(m5.lpRentaF1)}/mes</span>
          </div>
          {!hideSensitive && (
            <>
              <div className="fin-table__row fin-table__row--hi">
                <span>Utilidad acum. en periodo · CP</span>
                <span>{formatUsd(m5.cpTotPeriodo)}</span>
              </div>
              <div className="fin-table__row fin-table__row--hi">
                <span>Utilidad acum. en periodo · LP</span>
                <span>{formatUsd(m5.lpTotPeriodo)}</span>
              </div>
            </>
          )}
        </div>
        {!hideSensitive && (
          <div
            className="banner mono"
            style={{ marginBottom: 8, borderLeft: '3px solid var(--cyan)' }}
          >
            <strong>Veredicto</strong>
            <div style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>{m5.veredicto}</div>
          </div>
        )}
        {hideSensitive && (
          <p className="muted mono" style={{ fontSize: 11 }}>
            Opciones referenciales: CP {formatUsd(m5.cpRenta)}/mes · LP F1 {formatUsd(m5.lpRentaF1)}/mes.
            Detalle gerencial reservado al equipo comercial.
          </p>
        )}
        {!hideSensitive && (
          <p className="muted mono" style={{ fontSize: 10, marginTop: 8 }}>
            Esta vista coincide con la sección «Panel gerencial (M5)» del PDF Gerencia al exportar.
          </p>
        )}
      </Accordion>
    </div>
  );
}
