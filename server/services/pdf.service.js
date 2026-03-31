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
    `SELECT * FROM project_items WHERE project_id = $1 ORDER BY sort_order ASC, created_at ASC`,
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
  };
}

function baseStyles() {
  return `
    * { box-sizing: border-box; }
    body { font-family: system-ui, Segoe UI, sans-serif; color: #111; font-size: 11px; margin: 0; padding: 24px; }
    h1 { font-size: 22px; margin: 0 0 4px; color: #0a6b7a; font-weight: 700; }
    h2 { font-size: 14px; margin: 18px 0 8px; border-bottom: 2px solid #00E5FF; padding-bottom: 4px; font-weight: 700; }
    .hdr { border-bottom: 3px solid #00E5FF; padding-bottom: 12px; margin-bottom: 16px; }
    .logo { font-weight: 700; letter-spacing: 0.15em; color: #00E5FF; font-size: 14px; }
    table { width: 100%; border-collapse: collapse; margin: 8px 0; }
    th, td { border: 1px solid #ccc; padding: 4px 6px; text-align: left; }
    th { background: #f0f0f0; font-size: 10px; text-transform: uppercase; }
    td.num { text-align: right; font-family: 'JetBrains Mono', monospace; }
    .muted { color: #666; font-size: 10px; }
    .box { background: #f8f8f8; padding: 10px; border-radius: 6px; margin: 8px 0; }
    .veredicto { white-space: pre-wrap; line-height: 1.5; }
  `;
}

function buildHtmlGerencia(payload) {
  const { project, items, totals, fin } = payload;
  const p = project;
  const { m1, m2, m3, m4, m5 } = fin;

  const rows = items
    .map(
      (it) => `<tr>
      <td>${esc(it.codigo)}</td>
      <td>${esc(it.descripcion)}</td>
      <td>${esc(it.tipo)}</td>
      <td class="num">${esc(it.qty)}</td>
      <td class="num">${fmtUsd(Number(it.unit_price))}</td>
      <td class="num">${fmtUsd(Number(it.subtotal))}</td>
    </tr>`
    )
    .join('');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><style>${baseStyles()}</style></head><body>
  <div class="hdr">
    <div class="logo">ZGROUP</div>
    <h1>${esc(p.nombre)}</h1>
    <div class="muted">Cotización técnica · PDF Gerencia · ${esc(new Date().toLocaleString('es-PE'))}</div>
    <div>Cliente: ${esc(p.client_razon_social || '—')} · Odoo: ${esc(p.odoo_ref || '—')}</div>
  </div>

  <h2>Presupuesto</h2>
  <p>Activos ${fmtUsd(totals.activos)} · Consumibles ${fmtUsd(totals.consumibles)} · <strong>Lista ${fmtUsd(totals.lista)}</strong></p>
  <table><thead><tr><th>Código</th><th>Descripción</th><th>Tipo</th><th class="num">Cant.</th><th class="num">P.unit</th><th class="num">Subtotal</th></tr></thead>
  <tbody>${rows || '<tr><td colspan="6">Sin ítems</td></tr>'}</tbody></table>

  <h2>Análisis financiero (M1–M4)</h2>
  <div class="box">
    <strong>M1 Venta</strong><br/>
    Modo: ${esc(m1.adjType)} · Ajuste ${m1.adjPct}% · <strong>TOTAL VENTA ${fmtUsd(m1.ventaTotal)}</strong>
  </div>
  <div class="box">
    <strong>M2 Corto plazo</strong><br/>
    Renta cliente: ${fmtUsd(m2.rentaCliente)}/mes · ROA ${m2.cpRoa}% · Ganancia/mes ${fmtUsd(m2.gananciaMensual)} · PE ${esc(m2.peDisplay)}
  </div>
  <div class="box">
    <strong>M3 Largo plazo</strong><br/>
    Renta F1: ${fmtUsd(m3.lpRentaF1)}/mes · Spread ${fmtUsd(m3.lpSpread)}/mes · Total ciclo utilidad ${fmtUsd(m3.lpTotalCiclo)}
  </div>
  <div class="box">
    <strong>M4 Estacionalidad</strong><br/>
    Ingreso anual estimado ${fmtUsd(m4.estIngTotalYear)} · Regla de oro OK: ${m4.reglaDeOro.ok ? 'Sí' : 'Revisar'}
  </div>

  <h2>Panel gerencial (M5)</h2>
  <p>Horizonte <strong>${m5.cmpPeriod}</strong> meses</p>
  <table>
    <tr><th></th><th class="num">Corto plazo</th><th class="num">Largo plazo</th></tr>
    <tr><td>Renta al cliente (ref.)</td><td class="num">${fmtUsd(m5.cpRenta)}</td><td class="num">${fmtUsd(m5.lpRentaF1)} (F1)</td></tr>
    <tr><td>Utilidad acum. periodo</td><td class="num">${fmtUsd(m5.cpTotPeriodo)}</td><td class="num">${fmtUsd(m5.lpTotPeriodo)}</td></tr>
  </table>
  <div class="box veredicto"><strong>Veredicto</strong><br/>${esc(m5.veredicto)}</div>
</body></html>`;
}

function buildHtmlCliente(payload) {
  const { project, totals, fin } = payload;
  const p = project;
  const { m1, m2, m3 } = fin;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><style>${baseStyles()}</style></head><body>
  <div class="hdr">
    <div class="logo">ZGROUP</div>
    <h1>${esc(p.nombre)}</h1>
    <div class="muted">Propuesta comercial · ${esc(new Date().toLocaleDateString('es-PE'))}</div>
    <div>Cliente: ${esc(p.client_razon_social || '—')}</div>
  </div>

  <h2>Resumen</h2>
  <p><strong>Inversión referencial (lista)</strong>: ${fmtUsd(totals.lista)}</p>
  <p><strong>Total venta estimado</strong>: ${fmtUsd(m1.ventaTotal)}</p>

  <h2>Modalidades (referencia mensual)</h2>
  <div class="box">
    <p><strong>Opción arriendo corto plazo</strong>: cuota mensual referencial ${fmtUsd(m2.rentaCliente)}</p>
    <p><strong>Opción leasing largo plazo</strong>: cuota mensual referencial Fase 1 ${fmtUsd(m3.lpRentaF1)}</p>
  </div>
  <p class="muted">Los valores finales sujetos a contrato. No incluye detalle de márgenes internos.</p>
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
