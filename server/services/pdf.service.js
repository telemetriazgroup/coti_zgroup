/**
 * Generación de PDF desde HTML (Puppeteer) + datos proyecto/presupuesto/finanzas.
 */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const puppeteer = require('puppeteer-core');
const { pool } = require('../config/db');

/** Alpine instala Chromium en /usr/lib/chromium/chromium; /usr/bin/chromium puede no existir. */
function resolveChromiumExecutable() {
  const fromEnv = process.env.PUPPETEER_EXECUTABLE_PATH;
  const candidates = [
    fromEnv,
    '/usr/lib/chromium/chromium',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  const seen = new Set();
  for (const p of candidates) {
    if (seen.has(p)) continue;
    seen.add(p);
    try {
      if (fs.existsSync(p) && !fs.statSync(p).isDirectory()) return p;
    } catch {
      /* siguiente */
    }
  }
  return fromEnv;
}

let engineModPromise;
async function loadFinanceEngine() {
  if (!engineModPromise) {
    const p = path.join(__dirname, '../../shared/finance-engine.js');
    engineModPromise = import(pathToFileURL(p).href);
  }
  return engineModPromise;
}

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtUsd(n) {
  if (n == null || Number.isNaN(n)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

async function loadExportPayload(projectId) {
  const { rows: pr } = await pool.query(
    `SELECT p.*, c.razon_social AS client_razon_social
     FROM projects p
     LEFT JOIN clients c ON c.id = p.client_id
     WHERE p.id = $1`,
    [projectId]
  );
  if (!pr[0]) throw new Error('Proyecto no encontrado');

  const { rows: items } = await pool.query(
    `SELECT pi.*, cc.nombre AS category_nombre
     FROM project_items pi
     LEFT JOIN catalog_categories cc ON cc.id = pi.category_id
     WHERE pi.project_id = $1 ORDER BY pi.sort_order ASC, pi.created_at ASC`,
    [projectId]
  );

  let activos = 0;
  let consumibles = 0;
  for (const r of items) {
    const st = r.subtotal != null ? Number(r.subtotal) : 0;
    if (r.tipo === 'ACTIVO') activos += st;
    else if (r.tipo === 'CONSUMIBLE') consumibles += st;
  }
  const lista = Math.round((activos + consumibles) * 100) / 100;

  const { mergeFinanceParams, computeFinance } = await loadFinanceEngine();
  const params = mergeFinanceParams(pr[0].finance_params || {});
  const fin = computeFinance({
    baseLista: lista,
    baseActivos: activos,
    baseConsumibles: consumibles,
    params,
  });

  return {
    project: pr[0],
    items,
    totals: { activos, consumibles, lista },
    fin,
    mergedParams: params,
  };
}

function baseStyles() {
  return `
    * { box-sizing: border-box; }
    body { font-family: system-ui, Segoe UI, sans-serif; color: #111; font-size: 11px; margin: 0; padding: 24px; padding-bottom: 48px; }
    h1 { font-size: 22px; margin: 0 0 4px; color: #0a6b7a; font-weight: 700; }
    h2 { font-size: 14px; margin: 18px 0 8px; border-bottom: 2px solid #00E5FF; padding-bottom: 4px; font-weight: 700; }
    .hdr { border-bottom: 3px solid #00E5FF; padding-bottom: 12px; margin-bottom: 16px; }
    .logo { font-weight: 700; letter-spacing: 0.15em; color: #00E5FF; font-size: 14px; }
    .pdf-logo { max-height: 48px; max-width: 220px; object-fit: contain; display: block; margin-bottom: 8px; }
    table { width: 100%; border-collapse: collapse; margin: 8px 0; }
    th, td { border: 1px solid #ccc; padding: 4px 6px; text-align: left; }
    th { background: #f0f0f0; font-size: 10px; text-transform: uppercase; }
    td.num { text-align: right; font-family: 'JetBrains Mono', monospace; }
    .muted { color: #666; font-size: 10px; }
    .box { background: #f8f8f8; padding: 10px; border-radius: 6px; margin: 8px 0; }
    .veredicto { white-space: pre-wrap; line-height: 1.5; }
    .pdf-foot { margin-top: 24px; padding-top: 10px; border-top: 1px solid #ccc; font-size: 9px; color: #555; white-space: pre-wrap; }
    .pdf-opt-table { font-size: 10px; }
    .pdf-opt-table th:last-child, .pdf-opt-table td:last-child { text-align: left; min-width: 120px; }
    .opt-note { font-size: 9px; color: #444; line-height: 1.35; }
    .opt-sub { font-size: 9px; color: #666; font-style: italic; padding: 6px 8px !important; background: #fafafa; }
    .pdf-v12-hdr { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 10pt; border-bottom: 2.5pt solid #1a365d; margin-bottom: 12pt; gap: 12px; flex-wrap: wrap; }
    .pdf-v12-hdr__left { min-width: 0; }
    .pdf-v12-hdr__tag { font-size: 7pt; font-weight: 700; letter-spacing: 2pt; color: #4a5568; text-transform: uppercase; margin-top: 3pt; }
    .pdf-v12-hdr__meta { text-align: right; background: #f8fafc; border: 1pt solid #e2e8f0; border-radius: 5pt; padding: 8pt 14pt; font-size: 8.5pt; }
    .pdf-v12-hdr__meta td { border: none; padding: 1.5pt 8pt 1.5pt 0; }
    .pdf-lp-sec { margin: 16px 0 8px; border-bottom: 2pt solid #1a365d; padding-bottom: 4pt; display: flex; align-items: center; gap: 8pt; }
    .pdf-lp-sec__n { background: #1a365d; color: #fff; font-weight: 700; font-size: 10pt; padding: 2pt 8pt; border-radius: 3pt; }
    .pdf-lp-sec__t { font-weight: 700; font-size: 12pt; color: #1a365d; }
    /* Secciones informe gerencia: cada bloque en página nueva; filas de tabla no partidas a mitad de página (Chromium) */
    .pdf-ger-sec { break-inside: auto; }
    .pdf-ger-sec--break { page-break-before: always; break-before: page; }
    .pdf-ger-sec table { width: 100%; border-collapse: collapse; }
    .pdf-ger-sec tr { break-inside: avoid; page-break-inside: avoid; }
    .pdf-ger-sec .pdf-lp-sec { break-after: avoid; page-break-after: avoid; }
    /* Resumen ejecutivo (gerencia): cifras y etiquetas no desbordan el marco (A4, 5 cajas) */
    .pdf-exec-hdr { font-weight: 700; font-size: 10pt; color: #1a365d; text-transform: uppercase; letter-spacing: 1pt; margin-bottom: 6pt; }
    .pdf-exec-kpis { display: flex; flex-wrap: wrap; gap: 8pt; margin-bottom: 14pt; width: 100%; align-items: stretch; box-sizing: border-box; }
    .pdf-exec-kpi {
      border: 1pt solid #e2e8f0; border-left: 4pt solid #2b6cb0; border-radius: 3pt; padding: 5pt 7pt; flex: 1 1 120px; min-width: 0; max-width: 100%;
      box-sizing: border-box; overflow: hidden;
    }
    .pdf-exec-kpi__label {
      font-size: 6.5pt; color: #718096; text-transform: uppercase; letter-spacing: 0.45pt; font-weight: 600; line-height: 1.2;
      word-wrap: break-word; overflow-wrap: break-word;
    }
    .pdf-exec-kpi__value {
      font-size: 9.5pt; font-weight: 700; color: #1a365d; font-family: ui-monospace, 'Cascadia Mono', 'JetBrains Mono', 'Segoe UI Mono', monospace;
      line-height: 1.2; margin-top: 2pt; max-width: 100%; word-break: break-all; overflow-wrap: anywhere; hyphens: none;
    }
    .pdf-exec-kpi__sub { font-size: 7pt; color: #4a5568; line-height: 1.25; margin-top: 2pt; word-wrap: break-word; overflow-wrap: break-word; }
  `;
}

const IGV_RATE = 0.18;

function igvBlock(ventaTotal, includeIgv) {
  if (ventaTotal == null || Number.isNaN(ventaTotal)) return '';
  const base = Number(ventaTotal);
  if (!includeIgv) {
    return `<p class="muted">Montos en USD <strong>sin IGV</strong> (referencia comercial).</p>`;
  }
  const igv = Math.round(base * IGV_RATE * 100) / 100;
  const total = Math.round((base + igv) * 100) / 100;
  return `<div class="box">
    <strong>IGV Perú 18%</strong> (referencia sobre total venta)<br/>
    Subtotal USD: ${fmtUsd(base)}<br/>
    IGV 18%: ${fmtUsd(igv)}<br/>
    <strong>Total con IGV: ${fmtUsd(total)}</strong>
  </div>`;
}

function buildRentalMonthsSection(mergedParams, fin) {
  if (mergedParams.pdfShowRentalMonths === false) return '';
  const { m2, m3 } = fin;
  const p = mergedParams;
  const rows = [];
  if (p.enableCp !== false && m2.enabled !== false) {
    const totalCp = m2.cpPlazo * m2.rentaCliente;
    rows.push(
      `<tr><td>Corto plazo (CP)</td><td class="num">${m2.cpPlazo}</td><td class="num">${fmtUsd(m2.rentaCliente)}</td><td class="num">${fmtUsd(totalCp)}</td></tr>`
    );
  }
  if (p.enableLp !== false && m3.enabled !== false) {
    const totalF1 = m3.lpNPrestamo * m3.lpRentaF1;
    const totalF2 = m3.lpNF2 * m3.lpRentaF2;
    rows.push(
      `<tr><td>LP · Fase 1 (cuota cliente + GOP, con banco)</td><td class="num">${m3.lpNPrestamo}</td><td class="num">${fmtUsd(m3.lpRentaF1)}</td><td class="num">${fmtUsd(totalF1)}</td></tr>`
    );
    rows.push(
      `<tr><td>LP · Fase 2 (post-préstamo)</td><td class="num">${m3.lpNF2}</td><td class="num">${fmtUsd(m3.lpRentaF2)}</td><td class="num">${fmtUsd(totalF2)}</td></tr>`
    );
  }
  if (!rows.length) return '';
  return `<h2>Desglose meses de alquiler / cuotas</h2>
  <p class="muted">Meses = duración del tramo; total = meses × cuota mensual referencial.</p>
  <table><thead><tr><th>Modalidad</th><th class="num">Meses</th><th class="num">Cuota / mes</th><th class="num">Total período</th></tr></thead>
  <tbody>${rows.join('')}</tbody></table>`;
}

function logoHtml(mergedParams) {
  const url = (mergedParams.pdfLogoUrl || '').trim();
  if (url && /^https?:\/\//i.test(url)) return `<img class="pdf-logo" src="${esc(url)}" alt="" />`;
  if (url && url.startsWith('data:image')) return `<img class="pdf-logo" src="${esc(url)}" alt="" />`;
  return `<div class="logo">ZGROUP</div>`;
}

function headerBlock(project, mergedParams) {
  const p = project;
  return `<div class="hdr">
    ${logoHtml(mergedParams)}
    <h1>${esc(p.nombre)}</h1>
    <div class="muted">Cliente: ${esc(p.client_razon_social || '—')} · Odoo: ${esc(p.odoo_ref || '—')}</div>
  </div>`;
}

/**
 * Cabecera al estilo `imprimirPDF` (v12) — informe gerencia (uso interno).
 */
function headerBlockGerenciaV12(project, mergedParams) {
  const p = project;
  const moneda = (p.currency || 'USD').toUpperCase() === 'PEN' ? 'PEN (S/)' : 'USD ($)';
  const fecha = new Date().toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  return `<div class="pdf-v12-hdr">
    <div class="pdf-v12-hdr__left">
      ${logoHtml(mergedParams)}
      <div class="pdf-v12-hdr__tag">COTIZACIÓN TÉCNICA PROFESIONAL</div>
      <div style="font-size:7.5pt;color:#718096;margin-top:2pt">Informe gerencial (uso interno)</div>
    </div>
    <div class="pdf-v12-hdr__meta">
      <table style="border-collapse:collapse">
        <tr><td style="color:#718096;font-weight:600;text-transform:uppercase;font-size:7pt;letter-spacing:0.5pt">Proyecto</td>
            <td style="font-weight:700;color:#1a365d">${esc(p.nombre)}</td></tr>
        <tr><td style="color:#718096;font-weight:600;text-transform:uppercase;font-size:7pt;letter-spacing:0.5pt">N° Odoo</td>
            <td style="font-weight:600">${esc(p.odoo_ref || '—')}</td></tr>
        <tr><td style="color:#718096;font-weight:600;text-transform:uppercase;font-size:7pt;letter-spacing:0.5pt">Cliente</td>
            <td>${esc(p.client_razon_social || '—')}</td></tr>
        <tr><td style="color:#718096;font-weight:600;text-transform:uppercase;font-size:7pt;letter-spacing:0.5pt">Fecha</td>
            <td>${esc(fecha)}</td></tr>
        <tr><td style="color:#718096;font-weight:600;text-transform:uppercase;font-size:7pt;letter-spacing:0.5pt">Moneda</td>
            <td>${esc(moneda)}</td></tr>
      </table>
    </div>
  </div>`;
}

function pdfClienteRow(label, valueHtml) {
  return `<tr><td style="padding:3.5pt 8pt;color:#4a5568;font-size:8.5pt;border-bottom:0.4pt solid #e2e8f0">${esc(
    label
  )}</td><td style="padding:3.5pt 8pt;text-align:right;font-family:monospace;font-size:8.5pt;border-bottom:0.4pt solid #e2e8f0">${valueHtml}</td></tr>`;
}

function pdfClienteParamTableBody(rows) {
  return `<table style="width:100%;border-collapse:collapse;margin:0;background:transparent"><tbody>${rows.join('')}</tbody></table>`;
}

function pdfLargoPlazoSecTitle(numCircled, title) {
  return `<div class="pdf-lp-sec"><span class="pdf-lp-sec__n">${esc(numCircled)}</span><span class="pdf-lp-sec__t">${esc(title)}</span></div>`;
}

/**
 * Largo plazo (v12): barra de plazos, parámetros, FASE 1 / FASE 2 y resumen. Motor `m3` (mismo criterio que `FinanceModules`).
 */
function buildGerenciaLargoPlazoV12(fin, mergedParams) {
  const rp = mergedParams || {};
  if (rp.enableLp === false) return '';
  const { m1, m3 } = fin;
  if (!m3 || m3.enabled === false) return '';

  const nP = m3.lpNPrestamo;
  const nC = m3.lpNContrato;
  const nF2 = m3.lpNF2;
  const f2Start = nP + 1;
  const postPct = Number(m3.lpPostPct) || 80;
  const totFact = m3.lpNPrestamo * m3.lpRentaF1 + m3.lpNF2 * m3.lpRentaF2;
  const teaB = m3.lpTeaBancoPct;
  const margenP = m3.lpMargenPct != null ? m3.lpMargenPct : 30;

  const filasF1 = [
    pdfClienteRow('Cuota banco (ZGROUP paga al banco)', fmtUsd(m3.cuotaBanco) + '/mes'),
    pdfClienteRow('Gtos. operativos (sobre base venta, /mes)', fmtUsd(m3.lpGop) + '/mes'),
    pdfClienteRow('Costo base (Banco + GtosOp)', fmtUsd(m3.costoBase) + '/mes'),
    pdfClienteRow(`Margen ZGROUP ${margenP}% (Cost-Plus sobre costo base)`, fmtUsd(m3.lpSpread) + '/mes'),
    `<tr style="background:#c53030"><td style="padding:5pt 8pt;color:#fff;font-weight:700">RENTA MENSUAL F1 AL CLIENTE</td><td style="padding:5pt 8pt;text-align:right;font-family:monospace;font-weight:700;color:#fff;font-size:11pt">${fmtUsd(
      m3.lpRentaF1
    )}/mes</td></tr>`,
    pdfClienteRow(`Total facturado F1 (${nP} meses)`, fmtUsd(m3.lpNPrestamo * m3.lpRentaF1)),
    pdfClienteRow(
      `Ganancia F1 acum. (${nP} m)`,
      `${fmtUsd(m3.lpGanF1)}/m × ${nP} m = ${fmtUsd(m3.lpTotalGanF1)}`
    ),
    pdfClienteRow('Capital en riesgo ZGROUP (referencia)', fmtUsd(0)),
    pdfClienteRow('Punto equilibrio formalización', `${m3.lpPE} meses`),
  ];

  const filasF2 =
    nF2 > 0
      ? [
          pdfClienteRow('Cuota banco (post F1)', `${fmtUsd(0)} — préstamo liquidado`),
          pdfClienteRow(`Renta = F1 × ${postPct}% (fidelización)`, fmtUsd(m3.lpRentaF2) + '/mes'),
          pdfClienteRow('Gastos operativos', fmtUsd(m3.lpGop) + '/mes'),
          ...(m3.activarFondoReposicion && m3.lpFondoMensual > 0
            ? [pdfClienteRow('Fondo reposición (contrato > umbral vida útil)', fmtUsd(m3.lpFondoMensual) + '/mes')]
            : []),
          `<tr style="background:#276749"><td style="padding:5pt 8pt;color:#fff;font-weight:700">RENTA MENSUAL F2 AL CLIENTE</td><td style="padding:5pt 8pt;text-align:right;font-family:monospace;font-weight:700;color:#fff;font-size:11pt">${fmtUsd(
            m3.lpRentaF2
          )}/mes</td></tr>`,
          pdfClienteRow(`Total facturado F2 (${nF2} meses)`, fmtUsd(m3.lpNF2 * m3.lpRentaF2)),
          pdfClienteRow(
            `Utilidad neta F2 (/${nF2} m)`,
            `${fmtUsd(m3.lpGanF2)}/m × ${nF2} m = ${fmtUsd(m3.lpTotalGanF2)}`
          ),
        ]
      : [];

  const f2Column =
    nF2 > 0
      ? `<div style="flex:1;min-width:200px;border:1.5pt solid #276749;border-radius:4pt;padding:8pt">
    <div style="font-weight:700;color:#276749;font-size:8.5pt;margin-bottom:6pt">● FASE 2 — ACTIVO LIBRE (meses ${f2Start} a ${nC})</div>
    ${pdfClienteParamTableBody(filasF2)}
  </div>`
      : '';

  return `${pdfLargoPlazoSecTitle('②', 'LARGO PLAZO — Cost-Plus (v12) + banco')}
<div style="background:#edf2f7;border:1pt solid #2b6cb0;border-radius:3pt;padding:6pt 10pt;margin-bottom:8pt">
  <div style="font-weight:700;font-size:9pt;color:#1a365d">
    Plazo préstamo banco: <span style="color:#c53030">${nP} meses</span> &nbsp;|&nbsp; Plazo contrato cliente: <span style="color:#2b6cb0">${nC} meses</span> &nbsp;|&nbsp; Fase 2 (activo libre): <span style="color:#276749">${nF2} meses</span>
  </div>
  <p style="margin:6pt 0 0;font-size:7.5pt;color:#4a5568">Modelo v12: renta = (cuota banco + GOP) × (1 + margen%). Fase 1: meses 1–${nP}. Fase 2: ${
    nF2 > 0 ? `meses ${f2Start}–${nC}` : '—'
  }.</p>
</div>
<table style="width:100%;border-collapse:collapse;border:1pt solid #e2e8f0;margin-bottom:8pt">
  <tbody>${[
    pdfClienteRow('Vida útil LP (referencia)', String(m3.lpVida) + ' meses'),
    pdfClienteRow(
      'Total financiado banco (venta + formalización)',
      `${fmtUsd(m1.ventaTotal)} + ${fmtUsd(m3.lpForm)} = ${fmtUsd(m3.totalFinanciado)}`
    ),
    pdfClienteRow(`Margen Cost-Plus ZGROUP`, String(margenP) + ' %'),
    pdfClienteRow(`TEA banco ${teaB}% → cuota banco (sistema francés)`, fmtUsd(m3.cuotaBanco) + '/mes'),
  ].join('')}</tbody>
</table>
<div style="display:flex;gap:10pt;margin-bottom:8pt;flex-wrap:wrap">
  <div style="flex:1;min-width:200px;border:1.5pt solid #c53030;border-radius:4pt;padding:8pt">
    <div style="font-weight:700;color:#c53030;font-size:8.5pt;margin-bottom:6pt">● FASE 1 — CON DEUDA BANCARIA (meses 1 a ${nP})</div>
    ${pdfClienteParamTableBody(filasF1)}
  </div>
  ${f2Column}
</div>
<div style="background:#1a365d;border-radius:4pt;padding:10pt 14pt;margin-bottom:6pt">
  <div style="color:#90cdf4;font-weight:700;font-size:9pt;margin-bottom:5pt">★ RESUMEN CICLO LP (${nC} meses)</div>
  <div style="display:flex;gap:20pt;flex-wrap:wrap">
    <div><div style="color:#a0aec0;font-size:7.5pt">Total facturado al cliente (F1 + F2)</div>
      <div style="color:#fff;font-family:monospace;font-weight:600">${fmtUsd(totFact)}</div></div>
    <div><div style="color:#a0aec0;font-size:7.5pt">Utilidad acum. ciclo (ZGROUP, ref.)</div>
      <div style="color:#68d391;font-family:monospace;font-weight:700;font-size:12pt">${fmtUsd(m3.lpTotalCiclo)}</div></div>
    <div><div style="color:#a0aec0;font-size:7.5pt">Punto equilibrio formaliz.</div>
      <div style="color:#fff;font-family:monospace;font-weight:600">${esc(m3.lpPEDisplay || String(m3.lpPE))}</div></div>
  </div>
</div>`;
}

function footerBlock(mergedParams) {
  const t = (mergedParams.pdfFooter || '').trim();
  if (!t) return '';
  return `<footer class="pdf-foot">${esc(t)}</footer>`;
}

/**
 * PDF Cliente: modalidades activas con cuota mensual y total por período tentativo (referencial).
 */
function buildClienteModalidadesSection(fin, mergedParams) {
  const rp = mergedParams || {};
  const { m1, m2, m3, m4 } = fin;
  const rows = [];

  rows.push(`<tr>
    <td><strong>Venta directa</strong> — adquisición</td>
    <td class="num">—</td>
    <td class="num">—</td>
    <td class="num"><strong>${fmtUsd(m1.ventaTotal)}</strong></td>
    <td class="opt-note">Inversión única referencial (M1). No aplica cuota mensual.</td>
  </tr>`);

  if (rp.enableCp !== false && m2.enabled !== false) {
    const totalP = m2.cpPlazo * m2.rentaCliente;
    rows.push(`<tr>
      <td><strong>Arriendo corto plazo</strong></td>
      <td class="num">${m2.cpPlazo}</td>
      <td class="num">${fmtUsd(m2.rentaCliente)}</td>
      <td class="num">${fmtUsd(totalP)}</td>
      <td class="opt-note">Plazo contrato referencial: ${m2.cpPlazo} meses · capital propio</td>
    </tr>`);
  }

  if (rp.enableLp !== false && m3.enabled !== false) {
    const t1 = m3.lpNPrestamo * m3.lpRentaF1;
    rows.push(`<tr>
      <td><strong>Leasing largo plazo — Fase 1</strong> (con cuota bancaria)</td>
      <td class="num">${m3.lpNPrestamo}</td>
      <td class="num">${fmtUsd(m3.lpRentaF1)}</td>
      <td class="num">${fmtUsd(t1)}</td>
      <td class="opt-note">Meses 1–${m3.lpNPrestamo} · cuota mensual referencial</td>
    </tr>`);
    if (m3.lpNF2 > 0) {
      const t2 = m3.lpNF2 * m3.lpRentaF2;
      rows.push(`<tr>
        <td><strong>Leasing largo plazo — Fase 2</strong> (post-préstamo)</td>
        <td class="num">${m3.lpNF2}</td>
        <td class="num">${fmtUsd(m3.lpRentaF2)}</td>
        <td class="num">${fmtUsd(t2)}</td>
        <td class="opt-note">Meses ${m3.lpNPrestamo + 1}–${m3.lpNContrato} · contrato total ${m3.lpNContrato} meses</td>
      </tr>`);
    }
  }

  if (rp.enableEst !== false && m4.enabled !== false) {
    const promMes = m4.estIngTotalYear > 0 ? m4.estIngTotalYear / 12 : 0;
    rows.push(`<tr>
      <td><strong>Arriendo con estacionalidad</strong> (promedio mensual año 1)</td>
      <td class="num">12</td>
      <td class="num">${fmtUsd(promMes)}</td>
      <td class="num">${fmtUsd(m4.estIngTotalYear)}</td>
      <td class="opt-note">${m4.estOp} meses a renta plena + ${m4.estSb} meses standby (referencial)</td>
    </tr>`);
    rows.push(`<tr>
      <td colspan="5" class="opt-sub">Desglose operativo: ${m4.estOp} meses a plena operación y ${m4.estSb} meses en standby; importes mensuales consolidados en la fila anterior (referencia año 1).</td>
    </tr>`);
  }

  return `<h2>Opciones de contratación (referencial)</h2>
  <p class="muted">Compare las modalidades <strong>activas</strong> en esta cotización. La cuota mensual y el total por período son referenciales para el plazo tentativo indicado; el contrato definitivo puede variar.</p>
  <table class="pdf-opt-table"><thead><tr>
    <th>Modalidad</th>
    <th class="num">Meses (período)</th>
    <th class="num">Cuota / mes (USD)</th>
    <th class="num">Total período (USD)</th>
    <th>Notas</th>
  </tr></thead><tbody>${rows.join('')}</tbody></table>
  <p class="muted" style="margin-top:10px"><strong>Venta directa</strong> es compra; el resto son esquemas de alquiler con cuotas mensuales estimadas. Elija una línea de negociación según su preferencia.</p>`;
}

function fmtPct1(n) {
  return `${Number(n || 0).toFixed(1)}%`;
}

function pdfV12Kpi(label, valueHtml, sub) {
  return `<div class="pdf-exec-kpi">
    <div class="pdf-exec-kpi__label">${esc(label)}</div>
    <div class="pdf-exec-kpi__value">${valueHtml}</div>
    ${sub ? `<div class="pdf-exec-kpi__sub">${esc(sub)}</div>` : ''}
  </div>`;
}

function pdfV12NumSec(n, t) {
  if (!n) {
    return `<div style="margin:14pt 0 6pt;border-bottom:2pt solid #1a365d;padding-bottom:4pt">
      <span style="font-weight:700;font-size:12pt;color:#1a365d">${esc(t)}</span>
    </div>`;
  }
  return pdfLargoPlazoSecTitle(n, t);
}

function buildGerenciaResumenKpis(fin, totals, items) {
  const { m1, m2, m3 } = fin;
  const nAct = (items || []).filter((i) => i.tipo !== 'CONSUMIBLE').length;
  const labAdj = m1.adjType === 'margin' ? `+ Margen` : '− Descuento';
  const subCp = m2.enabled ? `Contrato: ${m2.cpPlazo}m · capital propio` : '—';
  const subLp =
    m3.enabled && m3
      ? `Banco: ${m3.lpNPrestamo}m · contrato: ${m3.lpNContrato}m total`
      : '—';
  return `<div class="pdf-exec-hdr">Resumen ejecutivo</div>
  <div class="pdf-exec-kpis">
    ${pdfV12Kpi('Base de activos', fmtUsd(totals.activos), nAct + ' ítem(s) activos')}
    ${pdfV12Kpi('Total lista (base)', fmtUsd(totals.lista), '')}
    ${pdfV12Kpi(`${labAdj} ${fmtPct1(m1.adjPct)}`, fmtUsd(m1.ventaTotal), '')}
    ${pdfV12Kpi('Renta corto plazo', m2.enabled ? fmtUsd(m2.rentaCliente) + '/mes' : '—', subCp)}
    ${pdfV12Kpi('Renta largo plazo F1', m3.enabled ? fmtUsd(m3.lpRentaF1) + '/mes' : '—', subLp)}
  </div>`;
}

function buildGerenciaPartidasBloque(items, m1) {
  const actItems = (items || []).filter((i) => i.tipo !== 'CONSUMIBLE');
  const consItems = (items || []).filter((i) => i.tipo === 'CONSUMIBLE');
  const base = Number(m1.base) || 0;
  const adjMag = Math.abs(Number(m1.ventaTotal) - base);
  const lab = m1.adjType === 'margin' ? `+ Margen de seguridad (${fmtPct1(m1.adjPct)})` : `− Descuento (${fmtPct1(m1.adjPct)})`;
  const rowsHdr = `<tr style="background:#edf2f7">
    <th style="padding:5pt 6pt;text-align:left;font-size:7.5pt;color:#1a365d;font-weight:700;border-bottom:1.5pt solid #2b6cb0">Código</th>
    <th style="padding:5pt 6pt;text-align:left;font-size:7.5pt;color:#1a365d;font-weight:700;border-bottom:1.5pt solid #2b6cb0">Descripción</th>
    <th style="padding:5pt 6pt;text-align:center">Und</th>
    <th style="padding:5pt 6pt;text-align:right;font-size:7pt">P. lista (ref.)</th>
    <th style="padding:5pt 6pt;text-align:right;font-size:7.5pt">P. asumido</th>
    <th style="padding:5pt 6pt;text-align:center">Cant.</th>
    <th style="padding:5pt 6pt;text-align:right">Subtotal</th>
  </tr>`;
  const fmtRefPrices = (it) => {
    const asum = Number(it.unit_price);
    const off = it.official_unit_price != null ? Number(it.official_unit_price) : asum;
    const diff = Math.abs(off - asum) > 0.005;
    const listCell = diff
      ? `<span style="text-decoration:line-through;color:#a0aec0;font-size:7.5pt">${fmtUsd(off)}</span>`
      : fmtUsd(off);
    const asumCell = diff
      ? `<span style="font-weight:700;color:#1a365d">${fmtUsd(asum)}</span>`
      : fmtUsd(asum);
    return { listCell, asumCell };
  };
  const oneRow = (it) => {
    const { listCell, asumCell } = fmtRefPrices(it);
    return `<tr>
    <td style="padding:3pt 6pt;font-family:monospace;font-size:8pt;border-bottom:0.4pt solid #e2e8f0;color:#2b6cb0">${esc(it.codigo || '—')}</td>
    <td style="padding:3pt 6pt;font-size:8.5pt;border-bottom:0.4pt solid #e2e8f0"><div style="font-weight:600">${esc(it.descripcion)}</div><div style="font-size:7.5pt;color:#718096">${esc(
      it.category_nombre || ''
    )}</div></td>
    <td style="padding:3pt 6pt;text-align:center;font-size:8pt;border-bottom:0.4pt solid #e2e8f0">${esc(it.unidad || 'und')}</td>
    <td style="padding:3pt 6pt;text-align:right;font-family:monospace;font-size:8.5pt;border-bottom:0.4pt solid #e2e8f0;vertical-align:top">${listCell}</td>
    <td style="padding:3pt 6pt;text-align:right;font-family:monospace;font-size:8.5pt;border-bottom:0.4pt solid #e2e8f0;vertical-align:top">${asumCell}</td>
    <td style="padding:3pt 6pt;text-align:center;font-family:monospace;font-size:8.5pt;border-bottom:0.4pt solid #e2e8f0">${esc(String(it.qty))}</td>
    <td style="padding:3pt 6pt;text-align:right;font-family:monospace;font-size:8.5pt;border-bottom:0.4pt solid #e2e8f0">${fmtUsd(Number(it.subtotal))}</td>
  </tr>`;
  };
  const subtot = (label, val) => `<tr style="background:#edf2f7"><td colspan="6" style="padding:4pt 6pt;text-align:right;font-size:8.5pt;font-weight:600;color:#4a5568">${esc(
    label
  )}</td><td style="padding:4pt 6pt;text-align:right;font-family:monospace;font-size:9pt;font-weight:700;color:#1a365d">${fmtUsd(val)}</td></tr>`;
  const aBlock =
    actItems.length > 0
      ? `<div style="font-weight:700;font-size:9pt;color:#2b6cb0;margin:6pt 0 3pt">ACTIVOS (${actItems.length} ítems)</div>
  <table style="width:100%;border-collapse:collapse;border:1pt solid #e2e8f0">${rowsHdr}${actItems.map(oneRow).join('')}${subtot(
    'Subtotal activos',
    actItems.reduce((s, it) => s + (Number(it.subtotal) || 0), 0)
  )}</table>`
      : '';
  const cBlock =
    consItems.length > 0
      ? `<div style="font-weight:700;font-size:9pt;color:#c27803;margin:8pt 0 3pt">CONSUMIBLES (${consItems.length} ítems)</div>
  <table style="width:100%;border-collapse:collapse;border:1pt solid #e2e8f0">${rowsHdr}${consItems.map(oneRow).join('')}${subtot(
    'Subtotal consumibles',
    consItems.reduce((s, it) => s + (Number(it.subtotal) || 0), 0)
  )}</table>`
      : '';
  const refNote =
    '<p style="font-size:7.5pt;color:#718096;margin:0 0 5pt 0;max-width:100%"><strong>Referencias de precio:</strong> <em>P. lista (ref.)</em> = precio de catálogo al incorporar la partida; <em>P. asumido</em> = precio unitario usado en el presupuesto y en subtotales (el motor y la lista comercial se calculan con el asumido). Si se corrigió el precio oficial, el ref. queda tachado y el asumido refleja la trazabilidad.</p>';
  return `${pdfV12NumSec('', 'PARTIDAS DEL PRESUPUESTO (detalle)')}
  ${refNote}
  ${aBlock}
  ${cBlock}
  <table style="width:100%;border-collapse:collapse;margin-top:6pt;border:1pt solid #e2e8f0">
    ${pdfClienteRow('TOTAL LISTA BASE', fmtUsd(base))}
    ${pdfClienteRow(lab, fmtUsd(adjMag))}
    <tr style="background:#1a365d"><td colspan="2" style="padding:5pt 8pt;font-weight:700;color:#fff;font-size:9.5pt">TOTAL VENTA (BASE UNIFICADA M1)</td></tr>
    <tr><td style="padding:5pt 8pt;font-size:9pt;color:#4a5568"></td>
    <td style="padding:5pt 8pt;text-align:right;font-family:monospace;font-size:11pt;font-weight:700;color:#1a365d">${fmtUsd(m1.ventaTotal)}</td></tr>
  </table>`;
}

function buildGerenciaCortoPlazoBloque(fin, mergedParams) {
  const { m1, m2 } = fin;
  if (mergedParams.enableCp === false || !m2.enabled) {
    return `${pdfV12NumSec('①', 'CORTO PLAZO — Capital propio ZGROUP')}
    <p class="muted" style="margin:8px 0">Módulo desactivado o no aplicable en parámetros.</p>`;
  }
  const vt = m1.ventaTotal;
  const merma = m2.mermaMonthly;
  const gop = m2.gopMonthly;
  const roaM = m2.roaMonthly;
  return `${pdfV12NumSec('①', 'CORTO PLAZO — Capital propio ZGROUP')}
  <div style="display:flex;gap:10pt;flex-wrap:wrap">
  <div style="flex:1;min-width:200px">
    <div style="font-size:8pt;font-weight:700;color:#fff;background:#2b6cb0;padding:4pt 8pt;border-radius:3pt 3pt 0 0;letter-spacing:0.5pt">PARÁMETROS DEL CONTRATO</div>
    <table style="width:100%;border-collapse:collapse;border:1pt solid #e2e8f0"><tbody>
      ${pdfClienteRow('Plazo del contrato', m2.cpPlazo + ' MESES')}
      ${pdfClienteRow('Vida útil del activo', m2.cpVida + ' meses')}
      ${pdfClienteRow('ROA (costo cap. propio)', fmtPct1(m2.cpRoa) + ' anual')}
      ${pdfClienteRow('Gastos operativos', fmtPct1(m2.cpOp) + ' anual')}
      ${pdfClienteRow('Factor merma montaje', fmtPct1(m2.cpMerma))}
    </tbody></table>
  </div>
  <div style="flex:1;min-width:200px">
    <div style="font-size:8pt;font-weight:700;color:#fff;background:#2b6cb0;padding:4pt 8pt;border-radius:3pt 3pt 0 0;letter-spacing:0.5pt">DESGLOSE RENTA MENSUAL</div>
    <table style="width:100%;border-collapse:collapse;border:1pt solid #e2e8f0"><tbody>
      ${pdfClienteRow('Depreciación (÷' + m2.cpVida + 'm)', fmtUsd(m2.depreciationMonthly))}
      ${pdfClienteRow('Merma montaje (÷' + m2.cpPlazo + 'm)', fmtUsd(merma))}
      ${pdfClienteRow('Gastos operativos', fmtUsd(gop))}
      ${m2.consumiblesMonthly > 0 ? pdfClienteRow('Consumibles (÷' + m2.cpPlazo + 'm)', fmtUsd(m2.consumiblesMonthly)) : ''}
      <tr style="border-top:1.5pt solid #2b6cb0">
        <td style="padding:4pt 8pt;color:#c27803;font-weight:700;font-size:9pt">ROA ${fmtPct1(m2.cpRoa)} ← ganancia</td>
        <td style="padding:4pt 8pt;text-align:right;font-weight:700;color:#c27803;font-size:9pt;font-family:monospace">${fmtUsd(roaM)}</td>
      </tr>
      <tr style="background:#1a365d">
        <td style="padding:5pt 8pt;color:#fff;font-weight:700">RENTA MENSUAL AL CLIENTE</td>
        <td style="padding:5pt 8pt;text-align:right;font-family:monospace;font-weight:700;color:#fff;font-size:10pt">${fmtUsd(m2.rentaCliente)}</td>
      </tr>
    </tbody></table>
  </div>
  </div>
  <table style="width:100%;border-collapse:collapse;margin-top:8pt;border:1pt solid #e2e8f0">
    <tr style="background:#edf2f7">
      <th style="padding:5pt 8pt;text-align:left;font-size:7.5pt">Indicador CP</th>
      <th style="padding:5pt 8pt;text-align:right">Por mes</th>
      <th style="padding:5pt 8pt;text-align:right">Total ${m2.cpPlazo} meses</th>
    </tr>
    <tr>
      <td style="padding:4pt 8pt;border-bottom:0.4pt solid #e2e8f0">Renta al cliente</td>
      <td style="padding:4pt 8pt;text-align:right;font-family:monospace;border-bottom:0.4pt solid #e2e8f0">${fmtUsd(m2.rentaCliente)}</td>
      <td style="padding:4pt 8pt;text-align:right;font-family:monospace;border-bottom:0.4pt solid #e2e8f0">${fmtUsd(
        m2.rentaCliente * m2.cpPlazo
      )}</td>
    </tr>
    <tr><td style="padding:4pt 8pt;font-weight:700;color:#c27803;border-bottom:0.4pt solid #e2e8f0">Ganancia ZGROUP (ROA)</td>
      <td style="text-align:right;font-weight:700;color:#c27803;font-family:monospace;padding:4pt 8pt;border-bottom:0.4pt solid #e2e8f0">${fmtUsd(
        m2.gananciaMensual
      )}</td>
      <td style="text-align:right;font-weight:700;color:#c27803;font-family:monospace;padding:4pt 8pt;border-bottom:0.4pt solid #e2e8f0">${fmtUsd(
        m2.gananciaMensual * m2.cpPlazo
      )}</td></tr>
    <tr>
      <td style="color:#c53030">Capital en riesgo ZGROUP</td>
      <td colspan="2" style="text-align:right;font-family:monospace;color:#c53030;padding:4pt 8pt">${fmtUsd(vt)} (inmovilizado)</td>
    </tr>
    <tr>
      <td style="color:#4a5568">Punto de equilibrio</td>
      <td colspan="2" style="text-align:right;font-family:monospace;padding:4pt 8pt">${esc(m2.peDisplay)} aprox. para inversión</td>
    </tr>
  </table>`;
}

function buildGerenciaEst5yBloque(fin) {
  const { m4 } = fin;
  if (!m4.fiveYearRows || !m4.fiveYearRows.length) return '';
  const rows = m4.fiveYearRows
    .map((r) => {
      const pl = r.phaseLabel || 'F1';
      const col = pl === 'F2' ? '#276749' : pl === 'F1→F2' || pl === 'F1' ? (pl === 'F1→F2' ? '#2b6cb0' : '#c53030') : '#4a5568';
      const faseTxt = pl === 'F1' ? 'F1 — con deuda' : pl === 'F2' ? 'F2 — activo libre' : 'F1→F2 (transición)';
      let extra = '';
      if (r.showF2FullYearBanner) {
        extra = `<tr><td colspan="6" style="padding:3pt 6pt;font-size:7.5pt;color:#276749;background:rgba(39,103,73,.06);border-bottom:0.4pt solid #e2e8f0">★ Pago banco nulo: activo libre. Utilidad neta ref.</td></tr>`;
      } else if (r.showTransitionBanner) {
        extra = `<tr><td colspan="6" style="padding:3pt 6pt;font-size:7.5pt;color:#2b6cb0;background:#ebf8ff;border-bottom:0.4pt solid #e2e8f0">Transición de fase en el año</td></tr>`;
      }
      return `<tr>
      <td style="padding:4pt 6pt;font-size:8pt;border-bottom:0.4pt solid #e2e8f0">
        <div style="font-weight:600">AÑO ${r.year}</div>
        <div style="font-size:7pt;color:#718096">m${r.monthStart}–${r.monthEnd}</div>
        <div style="font-size:7.5pt;color:${col}">${esc(faseTxt)}</div>
      </td>
      <td style="padding:4pt 6pt;text-align:right;font-family:monospace;font-size:8.5pt;border-bottom:0.4pt solid #e2e8f0">${fmtUsd(r.ingBruto)}</td>
      <td style="padding:4pt 6pt;text-align:right;font-family:monospace;font-size:8.5pt;border-bottom:0.4pt solid #e2e8f0;color:#c53030">${fmtUsd(
        r.pagoBanco
      )}</td>
      <td style="padding:4pt 6pt;text-align:right;font-family:monospace;font-size:8.5pt;border-bottom:0.4pt solid #e2e8f0">${fmtUsd(
        r.gopYear
      )}</td>
      <td style="padding:4pt 6pt;text-align:right;font-family:monospace;font-size:8.5pt;border-bottom:0.4pt solid #e2e8f0;font-weight:600;color:${
        r.utilNeta >= 0 ? '#276749' : '#c53030'
      }">${fmtUsd(r.utilNeta)}</td>
      <td style="padding:4pt 6pt;text-align:right;font-family:monospace;font-size:8.5pt;border-bottom:0.4pt solid #e2e8f0;font-weight:700">${fmtUsd(
        r.cumAcum
      )}</td>
    </tr>${extra}`;
    })
    .join('');
  const t = m4.totals5y;
  return `${pdfV12NumSec('④', 'CUADRO ANALÍTICO DE RENTABILIDAD — proyección 5 años (motor M4)')}
  <p class="muted" style="font-size:9px;margin:0 0 6px 0">Ingreso bruto con estacionalidad; costos: cuota banco (solo F1) y GOP (incl. fondo F2 según reglas motor).</p>
  <table style="width:100%;border-collapse:collapse;border:1pt solid #e2e8f0">
  <tr style="background:#edf2f7">
    <th style="padding:5pt 6pt;text-align:left">Año / fase</th>
    <th style="padding:5pt 6pt;text-align:right">Ing. bruto</th>
    <th style="padding:5pt 6pt;text-align:right">Pago banco</th>
    <th style="padding:5pt 6pt;text-align:right">Gtos. op.</th>
    <th style="padding:5pt 6pt;text-align:right">Util. neta</th>
    <th style="padding:5pt 6pt;text-align:right">Acumulado</th>
  </tr>
  ${rows}
  <tr style="background:#1a365d">
    <td style="padding:5pt 6pt;font-weight:700;color:#fff">TOTAL 5 AÑOS</td>
    <td style="padding:5pt 6pt;text-align:right;font-weight:700;color:#fff;font-family:monospace">${fmtUsd(t.totIng)}</td>
    <td style="padding:5pt 6pt;text-align:right;font-weight:700;color:#fff;font-family:monospace">${fmtUsd(t.totBanco)}</td>
    <td style="padding:5pt 6pt;text-align:right;font-weight:700;color:#fff;font-family:monospace">${fmtUsd(t.totGop)}</td>
    <td style="padding:5pt 6pt;text-align:right;font-weight:700;color:#fff;font-family:monospace">${fmtUsd(t.totUtil)}</td>
    <td style="padding:5pt 6pt;text-align:right;font-weight:700;color:#fff;font-family:monospace">${fmtUsd(t.cumAcum)}</td>
  </tr>
  </table>
  <p style="font-size:7.5pt;color:#4a5568;margin:4pt 0 0">Regla de oro (LP × estac.): esperado ≈ ${fmtUsd(
    m4.lpTotalCicloSeasonal
  )} · en tabla ${fmtUsd(t.totUtil)} — ${m4.reglaDeOro.ok ? 'coherente' : 'revisar supuestos'}</p>`;
}

function buildGerenciaEstacionalidadBloque(fin) {
  const { m3, m4 } = fin;
  if (!m4.enabled) {
    return `${pdfV12NumSec('③', 'MÓDULO ESTACIONALIDAD — agro / standby')}
    <p class="muted">Módulo desactivado en parámetros.</p>`;
  }
  const p = m4;
  return `${pdfV12NumSec('③', 'MÓDULO ESTACIONALIDAD — agro / standby')}
  <div style="display:flex;gap:10pt;flex-wrap:wrap;margin-bottom:8pt">
  <div style="flex:1;min-width:200px">
    <div style="font-size:8pt;font-weight:700;color:#fff;background:#553c9a;padding:4pt 8pt;border-radius:3pt 3pt 0 0">PARÁMETROS</div>
    <table style="width:100%;border-collapse:collapse;border:1pt solid #e2e8f0">
      <tbody>
      ${pdfClienteRow('Meses operativos (renta full)', p.estOp + ' meses/año')}
      ${pdfClienteRow('Meses standby', p.estSb + ' meses/año')}
      ${pdfClienteRow('Ajuste tarifa standby', String(p.estSbPct) + ' % de renta full')}
      ${pdfClienteRow('Seguro', String(p.estSeguroPct) + ' % anual')}</tbody>
    </table>
  </div>
  <div style="flex:1;min-width:200px">
    <div style="font-size:8pt;font-weight:700;color:#fff;background:#553c9a;padding:4pt 8pt;border-radius:3pt 3pt 0 0">TARIFAS MENSUALES</div>
    <table style="width:100%;border-collapse:collapse;border:1pt solid #e2e8f0">
      <tbody>
      ${pdfClienteRow('Renta full (LP F1)', fmtUsd(m3.lpRentaF1) + '/mes')}
      ${pdfClienteRow('Tarifa standby', fmtUsd(m4.estRentaSb) + '/mes')}
      ${pdfClienteRow('Piso mín. estimado (ref.)', fmtUsd(m4.estCostoMin) + '/mes')}
    </tbody>
    </table>
  </div>
  </div>
  <table style="width:100%;border-collapse:collapse;border:1pt solid #e2e8f0">
    <tr style="background:#edf2f7">
      <th>Concepto</th><th class="num">Mensual</th><th class="num">Total año</th>
    </tr>
    <tr>
      <td style="padding:4pt 8pt;border-bottom:0.4pt solid #e2e8f0">Renta full × ${p.estOp} meses</td>
      <td class="num" style="padding:4pt 8pt;border-bottom:0.4pt solid #e2e8f0;font-family:monospace">${fmtUsd(
        m3.lpRentaF1
      )}/mes</td>
      <td class="num" style="padding:4pt 8pt;border-bottom:0.4pt solid #e2e8f0;font-family:monospace;font-weight:600">${fmtUsd(
        m4.estIngFullYear
      )}</td>
    </tr>
    <tr>
      <td style="padding:4pt 8pt;border-bottom:0.4pt solid #e2e8f0">Renta standby × ${p.estSb} meses</td>
      <td class="num" style="padding:4pt 8pt;border-bottom:0.4pt solid #e2e8f0;font-family:monospace">${fmtUsd(
        m4.estRentaSb
      )}/mes</td>
      <td class="num" style="padding:4pt 8pt;border-bottom:0.4pt solid #e2e8f0;font-family:monospace;font-weight:600">${fmtUsd(
        m4.estIngSbYear
      )}</td>
    </tr>
    <tr>
      <td style="font-weight:600">Ingreso bruto anual</td>
      <td class="num">—</td>
      <td class="num" style="font-weight:700">${fmtUsd(m4.estIngTotalYear)}</td>
    </tr>
    <tr style="background:#fffbeb">
      <td style="font-weight:700;color:#c27803">Ganancia anual (est., ref.)</td>
      <td class="num">—</td>
      <td class="num" style="color:#c27803;font-weight:700">${fmtUsd(m4.estGanTotalYear)}</td>
    </tr>
  </table>
  <p class="muted" style="font-size:9px">Margen aprox. ${m4.estMargenPct.toFixed(1)}% sobre ingreso bruto anual.</p>`;
}

function buildGerenciaPanelM5Bloque(fin) {
  const { m1, m2, m3, m5 } = fin;
  const lpN = m3.lpNPrestamo;
  const nF2 = m3.lpNF2;
  const f2col =
    nF2 > 0
      ? `<th style="padding:6pt 8pt;text-align:right;font-size:8pt;color:#68d391;font-weight:700">LARGO F2 (${nF2}m)</th>`
      : '';
  const f2Renta = nF2 > 0 ? `<td class="num" style="font-weight:700;color:#276749">${fmtUsd(m3.lpRentaF2)}</td>` : '';
  const f2Gan = nF2 > 0
    ? `<td class="num">${fmtUsd(m3.lpGanF2)}</td>`
    : '';
  const f2Cap = nF2 > 0 ? `<td class="num" style="color:#276749;font-weight:700">${fmtUsd(0)}</td>` : '';
  const f2TotFact = nF2 > 0
    ? `<td class="num">${fmtUsd(m3.lpRentaF2 * nF2)}</td>`
    : '';
  const f1HorM = Math.min(m5.cmpPeriod, m3.lpNPrestamo);
  const f2HorM = Math.max(0, Math.min(m5.cmpPeriod - m3.lpNPrestamo, m3.lpNF2));
  const lpGanF1H = m3.lpGanF1 * f1HorM;
  const lpGanF2H = m3.lpGanF2 * f2HorM;
  const f2GanAc = nF2 > 0 ? `<td class="num" style="color:#276749;font-weight:700">${fmtUsd(lpGanF2H)}</td>` : '';
  return `${pdfV12NumSec('⑤', 'PANEL GERENCIAL — comparativa estratégica (M5)')}
  <p style="font-size:9pt;margin:0 0 8px">Horizonte <strong>${m5.cmpPeriod}</strong> meses (parámetros finance).</p>
  <table style="width:100%;border-collapse:collapse;border:1pt solid #e2e8f0">
    <tr style="background:#1a365d">
      <th style="text-align:left;color:#fff">Indicador</th>
      <th class="num" style="color:#fbd38d">CP (${m2.cpPlazo}m)</th>
      <th class="num" style="color:#90cdf4">LARGO F1 (${lpN}m)</th>
      ${f2col}
    </tr>
    <tr>
      <td style="font-weight:700">Renta al cliente (ref.)</td>
      <td class="num" style="color:#c27803">${fmtUsd(m5.cpRenta)}</td>
      <td class="num" style="font-weight:700">${fmtUsd(m5.lpRentaF1)}</td>
      ${f2Renta}
    </tr>
    <tr style="background:#fafbfc">
      <td>Utilidad neta / mes (ref.)</td>
      <td class="num">${fmtUsd(m2.gananciaMensual)}</td>
      <td class="num">${fmtUsd(m3.lpGanF1)}</td>
      ${f2Gan}
    </tr>
    <tr>
      <td>Capital en riesgo ZGROUP</td>
      <td class="num" style="color:#c53030;font-weight:700">${fmtUsd(m1.ventaTotal)}</td>
      <td class="num" style="color:#276749;font-weight:700">${fmtUsd(0)}</td>
      ${f2Cap}
    </tr>
    <tr>
      <td>Total facturado al cliente (ref.)</td>
      <td class="num">${fmtUsd(m2.rentaCliente * m2.cpPlazo)}</td>
      <td class="num">${fmtUsd(m3.lpRentaF1 * lpN)}</td>
      ${f2TotFact}
    </tr>
    <tr style="background:#fafbfc">
      <td style="font-weight:700">Ganancia acum. horiz.</td>
      <td class="num" style="color:#c27803;font-weight:700">${fmtUsd(m5.cpTotPeriodo)}</td>
      <td class="num" style="font-weight:700">${fmtUsd(lpGanF1H)}</td>
      ${f2GanAc}
    </tr>
  </table>
  <p style="margin:8px 0;padding:8px;background:#f0fff4;border:1pt solid #9ae6b4;border-radius:4pt;font-size:8.5pt;color:#276749;font-weight:600">
  ${
    m5.veredicto
      ? esc(m5.veredicto)
      : 'Defina partidas y parámetros para el veredicto automático (motor).'
  }
  </p>`;
}

function buildHtmlGerencia(payload) {
  const { project, items, totals, fin, mergedParams } = payload;
  const p = project;
  const rp = mergedParams || {};
  const { m1, m3, m4 } = fin;
  const igvHtml = igvBlock(m1.ventaTotal, rp.pdfIncludeIgv === true);
  const lpBlo = rp.enableLp !== false && m3.enabled ? buildGerenciaLargoPlazoV12(fin, rp) : '';
  const est5yHtml =
    m4.fiveYearRows && m4.fiveYearRows.length ? buildGerenciaEst5yBloque(fin) : '';
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>Informe gerencial</title><style>${baseStyles()}</style></head><body>
<div style="font-size:9.5pt;color:#1a202c;max-width:100%">
  ${headerBlockGerenciaV12(p, rp)}
  <p class="muted" style="margin:0 0 10px 0">Informe gerencial (uso interno) · ${esc(
    new Date().toLocaleString('es-PE')
  )} · motor <code>shared/finance-engine.js</code></p>
  <div class="pdf-ger-sec">
    ${buildGerenciaResumenKpis(fin, totals, items)}
    ${buildGerenciaPartidasBloque(items, m1)}
    ${igvHtml}
  </div>
  <div class="pdf-ger-sec pdf-ger-sec--break">
    ${buildGerenciaCortoPlazoBloque(fin, rp)}
  </div>
  ${
    lpBlo
      ? `<div class="pdf-ger-sec pdf-ger-sec--break">${lpBlo}</div>`
      : ''
  }
  <div class="pdf-ger-sec pdf-ger-sec--break">
    ${buildGerenciaEstacionalidadBloque(fin)}
  </div>
  ${
    est5yHtml
      ? `<div class="pdf-ger-sec pdf-ger-sec--break">${est5yHtml}</div>`
      : ''
  }
  <div class="pdf-ger-sec pdf-ger-sec--break">
    ${buildGerenciaPanelM5Bloque(fin)}
  </div>
  <p class="muted" style="margin-top:12px">Presentación alineada a <code>zgroup-cotizaciones-v12-final-12.html</code> (imprimirPDF); cifras del motor M1–M5 (LP Cost-Plus v12, TEA banco, margen %).</p>
  ${footerBlock(rp)}
</div>
</body></html>`;
}

function buildHtmlCliente(payload) {
  const { project, items, fin, mergedParams } = payload;
  const p = project;
  const rp = mergedParams || {};
  const { m1 } = fin;
  const igvHtml = igvBlock(m1.ventaTotal, rp.pdfIncludeIgv === true);
  const modalidadesHtml = buildClienteModalidadesSection(fin, rp);

  /** Sin importes por línea ni totales de lista: solo alcance comercial (PDF Cliente). */
  const rowsItems = (items || [])
    .map(
      (it) => `<tr>
      <td>${esc(it.codigo)}</td>
      <td>${esc(it.descripcion)}</td>
      <td>${esc(it.category_nombre || '—')}</td>
      <td>${esc(it.tipo)}</td>
      <td class="num">${esc(it.qty)}</td>
      <td class="num">${esc(it.unidad || 'UND')}</td>
    </tr>`
    )
    .join('');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><style>${baseStyles()}</style></head><body>
  ${headerBlock(p, rp)}
  <div class="muted" style="margin-bottom:14px">Propuesta comercial · ${esc(new Date().toLocaleDateString('es-PE'))}</div>

  <h2>Partidas incluidas en esta propuesta</h2>
  <p class="muted">Descripción del alcance (sin valores unitarios ni desglose de lista de costos).</p>
  <table><thead><tr>
    <th>Código</th><th>Descripción</th><th>Categoría</th><th>Tipo</th><th class="num">Cant.</th><th class="num">Und.</th>
  </tr></thead>
  <tbody>${rowsItems || '<tr><td colspan="6">Sin partidas</td></tr>'}</tbody></table>

  <h2>Precio de venta referencial (venta directa)</h2>
  <div class="box">
    <p><strong>Total venta</strong> (precio comercial acordado en esta cotización): ${fmtUsd(m1.ventaTotal)}</p>
    <p class="muted">Corresponde a la modalidad de compra / venta directa (M1). No se detallan precios por ítem.</p>
  </div>
  ${igvHtml}

  ${modalidadesHtml}

  <p class="muted" style="margin-top:16px">Los importes son referenciales en USD. Los valores finales quedan sujetos al contrato y a la modalidad elegida. Este documento no incluye precios unitarios por partida ni información de costos internos de ZGROUP.</p>
  ${footerBlock(rp)}
</body></html>`;
}

async function renderPdfBuffer(html) {
  const execPath = resolveChromiumExecutable();
  const launchOpts = {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--font-render-hinting=none',
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--disable-extensions',
      '--no-first-run',
    ],
  };
  if (execPath) launchOpts.executablePath = execPath;

  const browser = await puppeteer.launch(launchOpts);
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load', timeout: 120000 });
    const buf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '16mm', bottom: '16mm', left: '14mm', right: '14mm' },
    });
    return Buffer.from(buf);
  } finally {
    await browser.close();
  }
}

/**
 * @param {'GERENCIA'|'CLIENTE'} kind
 */
async function generateProjectPdf(projectId, kind) {
  const payload = await loadExportPayload(projectId);
  const html = kind === 'CLIENTE' ? buildHtmlCliente(payload) : buildHtmlGerencia(payload);
  return renderPdfBuffer(html);
}

async function saveSnapshot(projectId, kind, userId, payloadSummary) {
  const k = kind === 'CLIENTE' ? 'CLIENTE' : 'GERENCIA';
  await pool.query(
    `INSERT INTO project_budget_snapshots (project_id, kind, label, payload, created_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [projectId, k, `PDF ${kind}`, JSON.stringify(payloadSummary), userId]
  );
}

module.exports = {
  loadExportPayload,
  buildHtmlGerencia,
  buildHtmlCliente,
  generateProjectPdf,
  saveSnapshot,
};
