import React, { useCallback, useMemo, useState } from 'react';
import { computeFinance, mergeFinanceParams } from '@shared/finance-engine.js';

function formatUsd(n) {
  if (n == null || Number.isNaN(n)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

function formatPen(n) {
  if (n == null || Number.isNaN(n)) return '—';
  return new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(n);
}

/** USD base del motor; PEN = nUsd * tc (referencial). */
function formatDisplay(nUsd, displayCurrency, tc) {
  if (nUsd == null || Number.isNaN(nUsd)) return '—';
  const tcN = Number(tc) > 0 ? Number(tc) : 3.75;
  if (displayCurrency === 'PEN') return formatPen(nUsd * tcN);
  return formatUsd(nUsd);
}

/** Etiqueta + texto explicativo + control (UX módulos financieros) */
function FinParam({ label, hint, children }) {
  return (
    <label className="fin-param">
      <span className="fin-param__label">{label}</span>
      {hint ? <p className="fin-param__hint">{hint}</p> : null}
      {children}
    </label>
  );
}

const HINT = {
  adjPct:
    'Porcentaje aplicado sobre la base lista: en modo «Margen» se suma al precio; en «Descuento» se resta. Define el precio objetivo de venta (M1).',
  cpPlazo:
    'Duración del contrato de arriendo en corto plazo (meses). Reparte merma y consumibles en el tiempo y fija el horizonte de la cuota CP.',
  cpVida:
    'Meses en los que se deprecia el activo en CP. A mayor vida útil, menor depreciación mensual y suele bajar la renta.',
  cpOp:
    'Gastos operativos anuales expresados como % del valor de venta. Se convierten a costo mensual fijo en el modelo.',
  cpRoa:
    'Retorno sobre activo esperado (anual). Es la ganancia objetivo mensual que el modelo asigna al arrendador.',
  cpMerma:
    'Pérdida de valor por montaje / desmontaje repartida en el plazo del contrato (sobre el valor de venta).',
  lpVida:
    'Vida útil contable del equipo en largo plazo (meses). Se usa para umbrales (p. ej. fondo reposición) y contexto del contrato.',
  lpN:
    'Plazo del préstamo bancario en meses (sistema francés): define cuotas banco/cliente hasta liquidación.',
  lpNContrato:
    'Duración total del contrato con el cliente (≥ plazo préstamo). Después del préstamo sigue la fase F2 con otra renta.',
  lpTeaBanco:
    'Tasa Efectiva Anual del financiamiento bancario. Entra en la cuota del préstamo (sistema francés).',
  lpTeaCot:
    'TEA cobrada o referida al cliente en la cuota. El spread respecto al banco es parte del análisis M3.',
  lpOp:
    'Gastos operativos anualizados sobre el valor de venta, convertidos a costo mensual en LP (como en CP).',
  lpForm:
    'Gastos únicos de formalización (USD) que capitalizan el monto financiado al inicio del préstamo.',
  lpPostPct:
    'Tras pagar el préstamo, la renta F2 se expresa como porcentaje de la renta de Fase 1.',
  lpFondoRep:
    'Porcentaje anual sobre el activo para fondo de reposición cuando el contrato supera el umbral de vida útil.',
  estOp:
    'Meses al año con operación a plena renta de referencia (estacionalidad M4).',
  estSb:
    'Meses al año en régimen standby (menor ingreso); el % de ajuste aplica sobre la renta de referencia.',
  estSeguro:
    'Costo de seguro anual como porcentaje del valor de venta (referencia de costo fijo).',
  estSbPct:
    'Porcentaje de la renta F1 que se aplica como ingreso en meses standby (regla operativa del modelo).',
  cmpPeriod:
    'Cantidad de meses para acumular utilidades CP vs LP y emitir el veredicto comparativo (M5 y PDF Gerencia).',
};

/** Panel derecho estilo zgroup-cotizaciones-v10-final.html (mod-hdr + mod-badge + colores por módulo). */
function ModSection({ modId, badgeNum, tone, title, titleExtra, headerRight, open, onToggle, children, disabled }) {
  return (
    <div className={`fin-mod ${disabled ? 'fin-mod--off' : ''} fin-mod--tone-${tone}`}>
      <button
        type="button"
        className="fin-mod-hdr"
        onClick={() => onToggle(modId)}
        aria-expanded={open}
      >
        <div className={`fin-mod-badge fin-mod-badge--${tone}`}>
          <span>{badgeNum}</span>
        </div>
        <div className="fin-mod-hdr-titles">
          <span className="fin-mod-title">{title}</span>
          {titleExtra ? <span className="fin-mod-title-extra mono">{titleExtra}</span> : null}
        </div>
        {headerRight ? <span className="fin-mod-hdr-val mono">{headerRight}</span> : null}
        <span className="fin-mod-chev">{open ? '▼' : '▶'}</span>
      </button>
      {open && <div className="fin-mod-body">{children}</div>}
    </div>
  );
}

function FinCurrencyBar({ displayCurrency, onDisplayCurrency, tc, onTcChange, disabled }) {
  const pen = displayCurrency === 'PEN';
  return (
    <div className="fin-cur-bar">
      <span className="fin-cur-bar__hint mono">Vista importes</span>
      <div className="fin-cur-bar__inner">
        <button
          type="button"
          className={`fin-cur-btn ${!pen ? 'fin-cur-btn--on' : ''}`}
          disabled={disabled}
          onClick={() => onDisplayCurrency('USD')}
        >
          USD $
        </button>
        <span className="fin-cur-sep">|</span>
        <button
          type="button"
          className={`fin-cur-btn ${pen ? 'fin-cur-btn--on' : ''}`}
          disabled={disabled}
          onClick={() => onDisplayCurrency('PEN')}
        >
          PEN S/
        </button>
        {pen && (
          <div className="fin-tc-row">
            <span className="mono fin-tc-lbl">T.C.</span>
            <input
              type="number"
              min="1"
              step="0.01"
              className="fin-tc-input mono"
              disabled={disabled}
              value={tc}
              onChange={(e) => onTcChange(parseFloat(e.target.value) || 0)}
            />
            <span className="fin-tc-unit mono">PEN/USD</span>
          </div>
        )}
      </div>
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
  tc: tcProp,
  onTcChange,
  finPanelClassName = '',
}) {
  const p = useMemo(() => mergeFinanceParams(financeParams), [financeParams]);
  const tc = tcProp != null && Number(tcProp) > 0 ? Number(tcProp) : 3.75;
  const cur = p.displayCurrency === 'PEN' ? 'PEN' : 'USD';
  const fmt = useCallback((n) => formatDisplay(n, cur, tc), [cur, tc]);
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
  const handleTc = typeof onTcChange === 'function' ? onTcChange : () => {};
  const setDisplayCurrency = (c) => patch({ displayCurrency: c });

  return (
    <div className={`fin-panel${finPanelClassName ? ` ${finPanelClassName}` : ''}`}>
      <div className="fin-panel__head">
        <h2 className="fin-panel__title">Módulos financieros</h2>
        <p className="fin-panel__intro">
          <strong>M1</strong> fija el total de venta; <strong>M2–M4</strong> en cascada (CP / LP / estacionalidad).{' '}
          <strong>M5</strong> compara con el PDF Gerencia. Importes en USD (motor); vista PEN referencial con T.C.
        </p>
        <FinCurrencyBar
          displayCurrency={cur}
          onDisplayCurrency={setDisplayCurrency}
          tc={tc}
          onTcChange={handleTc}
          disabled={hideSensitive}
        />
      </div>

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

      <ModSection
        modId="m1"
        badgeNum="1"
        tone="cyan"
        title="VENTA DIRECTA"
        titleExtra="Base lista · ajuste comercial"
        headerRight={fmt(m1.ventaTotal)}
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
          <FinParam
            label={m1.adjType === 'margin' ? 'Margen (+) %' : 'Descuento (−) %'}
            hint={HINT.adjPct}
          >
            <input
              type="number"
              step="0.5"
              className="form-input mono fin-input-lg"
              disabled={hideSensitive}
              value={p.adjPct ?? 0}
              onChange={(e) => patch({ adjPct: parseFloat(e.target.value) || 0 })}
            />
          </FinParam>
        </div>
        <div className="fin-result fin-result--cyan mono">
          <div className="fin-result__row">
            <span className="muted">Base lista</span>
            <span>{fmt(m1.base)}</span>
          </div>
          {!hideSensitive && (
            <div className="fin-result__row">
              <span className="muted">{m1.adjType === 'margin' ? '+ Seguridad' : '− Descuento'}</span>
              <span style={{ color: m1.adjType === 'margin' ? 'var(--amber)' : 'var(--red)' }}>
                {m1.adjType === 'margin' ? '+' : '−'}
                {fmt(m1.ventaAdj)}
              </span>
            </div>
          )}
          <div className="fin-result__total">
            <span className="fin-result__total-lbl">TOTAL VENTA</span>
            <span className="fin-result__total-val">{fmt(m1.ventaTotal)}</span>
          </div>
        </div>
        {m1.discount100Warning && (
          <div className="banner banner--warn mono" style={{ marginTop: 8 }}>
            Descuento 100%: venta $0 — revisar parámetros.
          </div>
        )}
      </ModSection>

      <ModSection
        modId="m2"
        badgeNum="2"
        tone="amber"
        title="CORTO PLAZO"
        titleExtra="CAPITAL PROPIO"
        headerRight={p.enableCp === false ? '—' : `${fmt(m2.rentaCliente)}/mes`}
        open={open.m2}
        onToggle={toggle}
        disabled={p.enableCp === false}
      >
        {p.enableCp !== false && (
          <>
            {!hideSensitive && (
              <div className="fin-grid fin-grid--3">
                <FinParam label="Plazo contrato (meses)" hint={HINT.cpPlazo}>
                  <input
                    type="number"
                    min={1}
                    className="form-input mono fin-input-lg"
                    value={p.cpPlazo}
                    onChange={(e) => patch({ cpPlazo: parseInt(e.target.value, 10) || 1 })}
                  />
                </FinParam>
                <FinParam label="Vida útil CP (meses)" hint={HINT.cpVida}>
                  <input
                    type="number"
                    min={1}
                    className="form-input mono fin-input-lg"
                    value={p.cpVida}
                    onChange={(e) => patch({ cpVida: parseInt(e.target.value, 10) || 1 })}
                  />
                </FinParam>
                <FinParam label="Gtos. op. % anual" hint={HINT.cpOp}>
                  <input
                    type="number"
                    step="0.5"
                    className="form-input mono fin-input-lg"
                    value={p.cpOp}
                    onChange={(e) => patch({ cpOp: parseFloat(e.target.value) || 0 })}
                  />
                </FinParam>
                <FinParam label="ROA % anual" hint={HINT.cpRoa}>
                  <input
                    type="number"
                    step="0.5"
                    className="form-input mono fin-input-lg"
                    value={p.cpRoa}
                    onChange={(e) => patch({ cpRoa: parseFloat(e.target.value) || 0 })}
                  />
                </FinParam>
                <FinParam label="Merma montaje %" hint={HINT.cpMerma}>
                  <input
                    type="number"
                    step="0.5"
                    className="form-input mono fin-input-lg"
                    value={p.cpMerma}
                    onChange={(e) => patch({ cpMerma: parseFloat(e.target.value) || 0 })}
                  />
                </FinParam>
              </div>
            )}
            <div className="fin-table mono fin-table--xl">
              {!hideSensitive && (
                <>
                  <div className="fin-table__row">
                    <span>Depreciación / mes</span>
                    <span>{fmt(m2.depreciationMonthly)}</span>
                  </div>
                  <div className="fin-table__row">
                    <span>Merma / mes</span>
                    <span>{fmt(m2.mermaMonthly)}</span>
                  </div>
                  <div className="fin-table__row">
                    <span>Gtos. op. / mes</span>
                    <span>{fmt(m2.gopMonthly)}</span>
                  </div>
                  {baseConsumibles > 0 && (
                    <div className="fin-table__row">
                      <span>Consumibles / mes</span>
                      <span>{fmt(m2.consumiblesMonthly)}</span>
                    </div>
                  )}
                  <div className="fin-table__row">
                    <span style={{ color: 'var(--amber)' }}>ROA / mes (ganancia)</span>
                    <span style={{ color: 'var(--amber)' }}>{fmt(m2.roaMonthly)}</span>
                  </div>
                </>
              )}
              <div className="fin-table__row fin-table__row--hi">
                <span>Renta al cliente</span>
                <span>{fmt(m2.rentaCliente)}/mes</span>
              </div>
            </div>
            {!hideSensitive && (
              <div className="fin-kpi-line">
                <span className="fin-kpi-tag fin-kpi-tag--green">
                  Ganancia / mes {fmt(m2.gananciaMensual)}
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
      </ModSection>

      <ModSection
        modId="m3"
        badgeNum="3"
        tone="green"
        title="LARGO PLAZO"
        titleExtra="BANCO FINANCIA"
        headerRight={p.enableLp === false ? '—' : `${fmt(m3.lpRentaF1)}/m F1`}
        open={open.m3}
        onToggle={toggle}
        disabled={p.enableLp === false}
      >
        {p.enableLp !== false && (
          <>
            {hideSensitive && (
              <p className="mono" style={{ marginBottom: 8 }}>
                Renta cliente F1: <span style={{ color: 'var(--cyan)' }}>{fmt(m3.lpRentaF1)}/mes</span>
              </p>
            )}
            {!hideSensitive && (
              <div className="fin-grid fin-grid--3">
                <FinParam label="Vida útil LP (meses)" hint={HINT.lpVida}>
                  <input
                    type="number"
                    min={1}
                    className="form-input mono fin-input-lg"
                    value={p.lpVida}
                    onChange={(e) => patch({ lpVida: parseInt(e.target.value, 10) || 1 })}
                  />
                </FinParam>
                <FinParam label="Plazo préstamo banco (meses)" hint={HINT.lpN}>
                  <input
                    type="number"
                    min={1}
                    className="form-input mono fin-input-lg"
                    value={p.lpN}
                    onChange={(e) => patch({ lpN: parseInt(e.target.value, 10) || 1 })}
                  />
                </FinParam>
                <FinParam label="Plazo contrato (meses)" hint={HINT.lpNContrato}>
                  <input
                    type="number"
                    min={1}
                    className="form-input mono fin-input-lg"
                    value={p.lpNContrato}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10) || 1;
                      patch({ lpNContrato: Math.max(p.lpN || 24, v) });
                    }}
                  />
                </FinParam>
                <FinParam label="TEA banco %" hint={HINT.lpTeaBanco}>
                  <input
                    type="number"
                    step="0.1"
                    className="form-input mono fin-input-lg"
                    value={p.lpTeaBanco}
                    onChange={(e) => patch({ lpTeaBanco: parseFloat(e.target.value) || 0 })}
                  />
                </FinParam>
                <FinParam label="TEA cotización cliente %" hint={HINT.lpTeaCot}>
                  <input
                    type="number"
                    step="0.1"
                    className="form-input mono fin-input-lg"
                    value={p.lpTeaCot}
                    onChange={(e) => patch({ lpTeaCot: parseFloat(e.target.value) || 0 })}
                  />
                </FinParam>
                <FinParam label="Gtos. op. % anual" hint={HINT.lpOp}>
                  <input
                    type="number"
                    step="0.5"
                    className="form-input mono fin-input-lg"
                    value={p.lpOp}
                    onChange={(e) => patch({ lpOp: parseFloat(e.target.value) || 0 })}
                  />
                </FinParam>
                <FinParam label="Gastos formalización USD" hint={HINT.lpForm}>
                  <input
                    type="number"
                    step="1"
                    className="form-input mono fin-input-lg"
                    value={p.lpForm}
                    onChange={(e) => patch({ lpForm: parseFloat(e.target.value) || 0 })}
                  />
                </FinParam>
                <FinParam label="Renta post-préstamo % F1" hint={HINT.lpPostPct}>
                  <input
                    type="number"
                    step="1"
                    className="form-input mono fin-input-lg"
                    value={p.lpPostPct}
                    onChange={(e) => patch({ lpPostPct: parseFloat(e.target.value) || 0 })}
                  />
                </FinParam>
                <FinParam label="Fondo reposición % anual" hint={HINT.lpFondoRep}>
                  <input
                    type="number"
                    step="0.5"
                    className="form-input mono fin-input-lg"
                    value={p.lpFondoRep}
                    onChange={(e) => patch({ lpFondoRep: parseFloat(e.target.value) || 0 })}
                  />
                </FinParam>
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
              <div className="fin-table mono fin-table--xl">
                <div className="fin-table__row">
                  <span>Cuota banco</span>
                  <span>{fmt(m3.cuotaBanco)}</span>
                </div>
                <div className="fin-table__row">
                  <span>Cuota cliente (mismo N)</span>
                  <span>{fmt(m3.cuotaCliente)}</span>
                </div>
                <div className="fin-table__row">
                  <span>Spread / mes</span>
                  <span>{fmt(m3.lpSpread)}</span>
                </div>
                <div className="fin-table__row fin-table__row--hi">
                  <span>Renta F1 (cliente)</span>
                  <span>{fmt(m3.lpRentaF1)}/mes</span>
                </div>
                <div className="fin-table__row">
                  <span>Renta F2</span>
                  <span>{fmt(m3.lpRentaF2)}/mes</span>
                </div>
                <div className="fin-table__row">
                  <span>Util. F1 / mes</span>
                  <span>{fmt(m3.lpGanF1)}</span>
                </div>
                <div className="fin-table__row">
                  <span>Util. F2 / mes</span>
                  <span>{fmt(m3.lpGanF2)}</span>
                </div>
                <div className="fin-table__row">
                  <span>Total ciclo utilidad</span>
                  <span>{fmt(m3.lpTotalCiclo)}</span>
                </div>
                <div className="fin-table__row">
                  <span>PE formalización</span>
                  <span>{m3.lpPEDisplay}</span>
                </div>
              </div>
            )}
            {m3.activarFondoReposicion && !hideSensitive && (
              <div className="banner banner--warn mono" style={{ marginTop: 8 }}>
                Contrato &gt; 80% vida útil: fondo reposición {fmt(m3.lpFondoMensual)}/mes.
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
                        <td className="num mono">{fmt(r.saldoInicial)}</td>
                        <td className="num mono">{fmt(r.interes)}</td>
                        <td className="num mono">{fmt(r.amortizacion)}</td>
                        <td className="num mono">{fmt(r.cuota)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </ModSection>

      <ModSection
        modId="m4"
        badgeNum="4"
        tone="violet"
        title="ESTACIONALIDAD"
        titleExtra="AGRO / STANDBY"
        headerRight={p.enableEst === false ? '—' : `${fmt(m4.estIngTotalYear)}/año`}
        open={open.m4}
        onToggle={toggle}
        disabled={p.enableEst === false}
      >
        {p.enableEst !== false && (
          <>
            {hideSensitive && (
              <p className="mono" style={{ marginBottom: 8 }}>
                Ingreso anual estimado:{' '}
                <span style={{ color: 'var(--cyan)' }}>{fmt(m4.estIngTotalYear)}/año</span>
              </p>
            )}
            {!hideSensitive && (
              <div className="fin-grid fin-grid--3">
                <FinParam label="Meses operativos" hint={HINT.estOp}>
                  <input
                    type="number"
                    min={1}
                    className="form-input mono fin-input-lg"
                    value={p.estOp}
                    onChange={(e) => patch({ estOp: parseInt(e.target.value, 10) || 1 })}
                  />
                </FinParam>
                <FinParam label="Meses standby" hint={HINT.estSb}>
                  <input
                    type="number"
                    min={1}
                    className="form-input mono fin-input-lg"
                    value={p.estSb}
                    onChange={(e) => patch({ estSb: parseInt(e.target.value, 10) || 1 })}
                  />
                </FinParam>
                <FinParam label="Seguro % anual" hint={HINT.estSeguro}>
                  <input
                    type="number"
                    step="0.1"
                    className="form-input mono fin-input-lg"
                    value={p.estSeguro}
                    onChange={(e) => patch({ estSeguro: parseFloat(e.target.value) || 0 })}
                  />
                </FinParam>
                <FinParam label="% ajuste standby" hint={HINT.estSbPct}>
                  <input
                    type="number"
                    step="1"
                    className="form-input mono fin-input-lg"
                    value={p.estSbPct}
                    onChange={(e) => patch({ estSbPct: parseFloat(e.target.value) || 0 })}
                  />
                </FinParam>
              </div>
            )}
            {m4.standbyBelowMin && !hideSensitive && (
              <div className="banner banner--err mono">
                Standby {fmt(m4.estRentaSb)}/mes &lt; costo mínimo {fmt(m4.estCostoMin)}
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
                  {fmt(m4.reglaDeOro.actual)} vs {fmt(m4.reglaDeOro.expected)}
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
                        <td className="num mono">{fmt(row.ingBruto)}</td>
                        <td className="num mono">{fmt(row.pagoBanco)}</td>
                        <td className="num mono">{fmt(row.gopYear)}</td>
                        <td className="num mono">{fmt(row.utilNeta)}</td>
                        <td className="num mono">{fmt(row.cumAcum)}</td>
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
                    <td className="num">{fmt(m4.totals5y.totIng)}</td>
                    <td className="num">{fmt(m4.totals5y.totBanco)}</td>
                    <td className="num">{fmt(m4.totals5y.totGop)}</td>
                    <td className="num">{fmt(m4.totals5y.totUtil)}</td>
                    <td className="num">{fmt(m4.totals5y.cumAcum)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </ModSection>

      <ModSection
        modId="m5"
        badgeNum="5"
        tone="panel"
        title="PANEL GERENCIAL"
        titleExtra="CP vs LP"
        headerRight={m5.lpMasBaratoCliente ? 'LP ref. favorable' : 'Comparar'}
        open={open.m5}
        onToggle={toggle}
      >
        {!hideSensitive && (
          <div className="fin-grid fin-grid--3" style={{ marginBottom: 12 }}>
            <FinParam label="Horizonte comparativo (meses)" hint={HINT.cmpPeriod}>
              <input
                type="number"
                min={1}
                max={120}
                className="form-input mono fin-input-lg"
                value={p.cmpPeriod ?? 24}
                onChange={(e) =>
                  patch({ cmpPeriod: Math.min(120, Math.max(1, parseInt(e.target.value, 10) || 24)) })
                }
              />
            </FinParam>
          </div>
        )}
        <div className="fin-table mono fin-table--xl" style={{ marginBottom: 12 }}>
          <div className="fin-table__row">
            <span>Horizonte</span>
            <span>
              {m5.cmpPeriod} meses
            </span>
          </div>
          <div className="fin-table__row">
            <span>Renta al cliente (ref.) · CP</span>
            <span>{fmt(m5.cpRenta)}/mes</span>
          </div>
          <div className="fin-table__row">
            <span>Renta Fase 1 · LP</span>
            <span>{fmt(m5.lpRentaF1)}/mes</span>
          </div>
          {!hideSensitive && (
            <>
              <div className="fin-table__row fin-table__row--hi">
                <span>Utilidad acum. en periodo · CP</span>
                <span>{fmt(m5.cpTotPeriodo)}</span>
              </div>
              <div className="fin-table__row fin-table__row--hi">
                <span>Utilidad acum. en periodo · LP</span>
                <span>{fmt(m5.lpTotPeriodo)}</span>
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
            Opciones referenciales: CP {fmt(m5.cpRenta)}/mes · LP F1 {fmt(m5.lpRentaF1)}/mes.
            Detalle gerencial reservado al equipo comercial.
          </p>
        )}
        {!hideSensitive && (
          <p className="muted mono" style={{ fontSize: 10, marginTop: 8 }}>
            Esta vista coincide con la sección «Panel gerencial (M5)» del PDF Gerencia al exportar.
          </p>
        )}
      </ModSection>
    </div>
  );
}
