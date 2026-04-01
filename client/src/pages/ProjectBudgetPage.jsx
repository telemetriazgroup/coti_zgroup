import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, getText, getToken, resolveAppUrl } from '../lib/api';
import { fetchCatalog } from '../lib/catalogApi';
import { useAuth } from '../context/AuthContext';
import { Modal } from '../components/Modal';
import { FinanceModules } from '../components/finance/FinanceModules';
import { ProjectWorkNav } from '../components/ProjectWorkNav';
import { mergeFinanceParams } from '@shared/finance-engine.js';
import { STATUS_LABEL } from '../lib/quotationStatus';
import { QuotationStatusFlow } from '../components/QuotationStatusFlow';

function formatUsd(n) {
  if (n == null || Number.isNaN(n)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

export function ProjectBudgetPage() {
  const { projectId } = useParams();
  const { hasRole, user } = useAuth();
  const canWrite = hasRole('ADMIN', 'COMERCIAL');
  const isAdmin = hasRole('ADMIN');
  const viewerMode = user?.role === 'VIEWER';

  const [project, setProject] = useState(null);
  const [projectStatus, setProjectStatus] = useState(null);
  const [items, setItems] = useState([]);
  const [totals, setTotals] = useState({ activos: 0, consumibles: 0, lista: 0 });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const [categories, setCategories] = useState([]);
  const [catItems, setCatItems] = useState([]);
  const [filterCat, setFilterCat] = useState('');
  const [qInput, setQInput] = useState('');
  const [qDebounced, setQDebounced] = useState('');
  const [filterTipo, setFilterTipo] = useState('');
  const [addQty, setAddQty] = useState('1');
  const [addPriceOverride, setAddPriceOverride] = useState('');

  const [modal, setModal] = useState(null);
  const [customForm, setCustomForm] = useState({
    codigo: '',
    descripcion: '',
    categoryId: '',
    unidad: 'UND',
    tipo: 'ACTIVO',
    unitPrice: '',
    qty: '1',
  });

  const [deletingId, setDeletingId] = useState(null);
  const draftsRef = useRef({});
  const itemsRef = useRef([]);
  const flushTimers = useRef({});
  const [financeParams, setFinanceParams] = useState(() => mergeFinanceParams({}));
  const financeTcPersistRef = useRef('');
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfMsg, setPdfMsg] = useState(null);
  const pdfPollRef = useRef(null);
  const [pdfPreviewKind, setPdfPreviewKind] = useState(null);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState(null);
  const [pdfPreviewLoading, setPdfPreviewLoading] = useState(false);
  const [pdfPreviewErr, setPdfPreviewErr] = useState(null);

  /** Alta rápida de catálogo (solo ADMIN; API /api/catalog/*) */
  const [catalogModal, setCatalogModal] = useState(null);
  const [catForm, setCatForm] = useState({ nombre: '', sortOrder: '', active: true });
  const [itemForm, setItemForm] = useState({
    categoryId: '',
    codigo: '',
    descripcion: '',
    unidad: 'UND',
    tipo: 'ACTIVO',
    unitPrice: '',
    sortOrder: '',
    active: true,
  });

  const refreshCatalog = useCallback(async () => {
    setErr(null);
    try {
      const { data } = await fetchCatalog(false);
      setCategories(data.categories || []);
      setCatItems(data.items || []);
    } catch (e) {
      setErr(e.message);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (pdfPollRef.current) clearInterval(pdfPollRef.current);
    };
  }, []);

  useEffect(() => {
    if (!pdfPreviewKind || !projectId) {
      setPdfPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setPdfPreviewLoading(false);
      setPdfPreviewErr(null);
      return undefined;
    }
    let cancelled = false;
    setPdfPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setPdfPreviewLoading(true);
    setPdfPreviewErr(null);
    (async () => {
      try {
        const html = await getText(
          `/api/export/pdf/preview-html?projectId=${encodeURIComponent(projectId)}&kind=${encodeURIComponent(
            pdfPreviewKind
          )}`
        );
        if (cancelled) return;
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        setPdfPreviewUrl(url);
      } catch (e) {
        if (!cancelled) setPdfPreviewErr(e.message || 'Error de vista previa');
      } finally {
        if (!cancelled) setPdfPreviewLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdfPreviewKind, projectId]);

  useEffect(() => {
    const t = setTimeout(() => setQDebounced(qInput), 200);
    return () => clearTimeout(t);
  }, [qInput]);

  const loadAll = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setErr(null);
    try {
      const [proj, budget, catData] = await Promise.all([
        api.get(`/api/projects/${projectId}`),
        api.get(`/api/projects/${projectId}/items`),
        fetchCatalog(false).then((r) => r.data),
      ]);
      setProject(proj);
      const mergedFp = mergeFinanceParams(proj.financeParams);
      setFinanceParams(mergedFp);
      financeTcPersistRef.current = `${JSON.stringify(mergedFp)}|${Number(proj.tc ?? 3.75)}`;
      setProjectStatus(budget.projectStatus);
      setItems(budget.items || []);
      setTotals(budget.totals || { activos: 0, consumibles: 0, lista: 0 });
      setCategories(catData.categories || []);
      setCatItems(catData.items || []);
      const dm = {};
      for (const it of budget.items || []) {
        dm[it.id] = { qty: String(it.qty), unitPrice: String(it.unitPrice) };
      }
      draftsRef.current = dm;
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const handleTcChange = useCallback((v) => {
    const n = Number(v) > 0 ? Number(v) : 3.75;
    setProject((prev) => (prev ? { ...prev, tc: n } : prev));
  }, []);

  useEffect(() => {
    if (!projectId || !canWrite || !project) return;
    const fpJson = JSON.stringify(financeParams);
    const tcVal = project.tc != null ? Number(project.tc) : 3.75;
    const sig = `${fpJson}|${tcVal}`;
    if (sig === financeTcPersistRef.current) return;
    const t = setTimeout(async () => {
      try {
        const data = await api.put(`/api/projects/${projectId}`, {
          financeParams: mergeFinanceParams(financeParams),
          tc: tcVal,
        });
        const next = mergeFinanceParams(data.financeParams);
        const nextTc = data.tc != null ? Number(data.tc) : tcVal;
        financeTcPersistRef.current = `${JSON.stringify(next)}|${nextTc}`;
        setProject((prev) =>
          prev ? { ...prev, financeParams: data.financeParams, tc: nextTc } : prev
        );
        setFinanceParams(next);
      } catch (e) {
        setErr(e.message);
      }
    }, 500);
    return () => clearTimeout(t);
  }, [financeParams, project, projectId, canWrite]);

  const syncDraftFromItems = useCallback((list) => {
    const dm = { ...draftsRef.current };
    for (const it of list) {
      dm[it.id] = { qty: String(it.qty), unitPrice: String(it.unitPrice) };
    }
    for (const id of Object.keys(dm)) {
      if (!list.some((x) => x.id === id)) delete dm[id];
    }
    draftsRef.current = dm;
  }, []);

  const filteredCatalog = useMemo(() => {
    let list = catItems.filter((it) => it.active !== false);
    if (filterCat) list = list.filter((it) => it.categoryId === filterCat);
    if (filterTipo) list = list.filter((it) => it.tipo === filterTipo);
    const qq = qDebounced.trim().toLowerCase();
    if (qq) {
      list = list.filter(
        (it) =>
          (it.codigo && it.codigo.toLowerCase().includes(qq)) ||
          (it.descripcion && it.descripcion.toLowerCase().includes(qq))
      );
    }
    return list;
  }, [catItems, filterCat, qDebounced, filterTipo]);

  const [, bump] = useState(0);
  const force = useCallback(() => bump((n) => n + 1), []);

  function getDraft(id) {
    return draftsRef.current[id] || { qty: '1', unitPrice: '0' };
  }

  function setDraft(id, field, value) {
    draftsRef.current[id] = { ...getDraft(id), [field]: value };
    force();
    if (!canWrite) return;
    if (flushTimers.current[id]) clearTimeout(flushTimers.current[id]);
    flushTimers.current[id] = setTimeout(() => flushRow(id), 300);
  }

  async function flushRow(id) {
    const d = draftsRef.current[id];
    const cur = itemsRef.current.find((x) => x.id === id);
    if (!d || !cur) return;
    const qty = parseFloat(String(d.qty).replace(',', '.'));
    const unitPrice = parseFloat(String(d.unitPrice).replace(',', '.'));
    if (Number.isNaN(qty) || qty < 0.001 || Number.isNaN(unitPrice) || unitPrice < 0) return;
    if (qty === Number(cur.qty) && unitPrice === Number(cur.unitPrice)) return;

    setErr(null);
    try {
      const data = await api.put(`/api/projects/${projectId}/items/${id}`, { qty, unitPrice });
      setItems(data.items);
      setTotals(data.totals);
      if (data.projectStatus) setProjectStatus(data.projectStatus);
      syncDraftFromItems(data.items);
    } catch (e) {
      setErr(e.message);
      syncDraftFromItems(itemsRef.current);
    }
  }

  async function addFromCatalog(catalogItem) {
    if (!canWrite) return;
    setErr(null);
    const qty = parseFloat(String(addQty).replace(',', '.')) || 1;
    const body = { catalogItemId: catalogItem.id, qty };
    const o = addPriceOverride.trim();
    if (o !== '') {
      const p = parseFloat(o.replace(',', '.'));
      if (!Number.isNaN(p) && p >= 0) body.unitPrice = p;
    }
    try {
      const data = await api.post(`/api/projects/${projectId}/items`, body);
      setItems(data.items);
      setTotals(data.totals);
      if (data.projectStatus != null) setProjectStatus(data.projectStatus);
      syncDraftFromItems(data.items);
    } catch (e) {
      setErr(e.message);
    }
  }

  async function addCustom(e) {
    e.preventDefault();
    if (!canWrite) return;
    setErr(null);
    const unitPrice = parseFloat(String(customForm.unitPrice).replace(',', '.'));
    const qty = parseFloat(String(customForm.qty).replace(',', '.'));
    if (Number.isNaN(unitPrice) || unitPrice < 0 || Number.isNaN(qty) || qty < 0.001) {
      setErr('Precio y cantidad inválidos');
      return;
    }
    try {
      const data = await api.post(`/api/projects/${projectId}/items`, {
        custom: {
          codigo: customForm.codigo.trim(),
          descripcion: customForm.descripcion.trim(),
          ...(customForm.categoryId ? { categoryId: customForm.categoryId } : {}),
          unidad: customForm.unidad.trim() || 'UND',
          tipo: customForm.tipo,
          unitPrice,
          qty,
        },
      });
      setItems(data.items);
      setTotals(data.totals);
      if (data.projectStatus != null) setProjectStatus(data.projectStatus);
      syncDraftFromItems(data.items);
      setModal(null);
      setCustomForm({
        codigo: '',
        descripcion: '',
        categoryId: '',
        unidad: 'UND',
        tipo: 'ACTIVO',
        unitPrice: '',
        qty: '1',
      });
    } catch (e2) {
      setErr(e2.message);
    }
  }

  async function clearBudget() {
    if (!canWrite) return;
    setErr(null);
    try {
      const data = await api.del(`/api/projects/${projectId}/items`);
      setItems(data.items || []);
      setTotals(data.totals || { activos: 0, consumibles: 0, lista: 0 });
      draftsRef.current = {};
      setModal(null);
    } catch (e) {
      setErr(e.message);
    }
  }

  async function startPdf(kind) {
    if (!projectId || pdfBusy) return;
    if (pdfPollRef.current) {
      clearInterval(pdfPollRef.current);
      pdfPollRef.current = null;
    }
    setPdfBusy(true);
    setPdfMsg(null);
    setErr(null);
    try {
      const data = await api.post('/api/export/pdf', { projectId, kind });
      const jobId = data.jobId;
      const poll = async () => {
        try {
          const st = await api.get(`/api/export/pdf/status/${jobId}`);
          if (st.state === 'failed') {
            if (pdfPollRef.current) clearInterval(pdfPollRef.current);
            pdfPollRef.current = null;
            setPdfBusy(false);
            setPdfMsg(st.error || 'Error PDF');
            return;
          }
          if (st.ready) {
            if (pdfPollRef.current) clearInterval(pdfPollRef.current);
            pdfPollRef.current = null;
            setPdfBusy(false);
            setPdfMsg('Descargando…');
            const res = await fetch(resolveAppUrl(`/api/export/pdf/download/${jobId}`), {
              credentials: 'include',
              headers: { Authorization: `Bearer ${getToken()}` },
            });
            if (!res.ok) {
              const j = await res.json().catch(() => ({}));
              throw new Error(j?.error?.message || res.statusText);
            }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `zgroup-${kind}.pdf`;
            a.click();
            URL.revokeObjectURL(url);
            setPdfMsg('PDF descargado.');
            setTimeout(() => setPdfMsg(null), 4000);
          }
        } catch (e) {
          if (pdfPollRef.current) clearInterval(pdfPollRef.current);
          pdfPollRef.current = null;
          setPdfBusy(false);
          setPdfMsg(e.message);
        }
      };
      await poll();
      pdfPollRef.current = setInterval(poll, 2000);
    } catch (e) {
      setPdfBusy(false);
      setErr(e.message);
    }
  }

  async function removeItem(id) {
    if (!canWrite) return;
    setErr(null);
    setDeletingId(id);
    try {
      const data = await api.del(`/api/projects/${projectId}/items/${id}`);
      setItems(data.items);
      setTotals(data.totals);
      syncDraftFromItems(data.items);
    } catch (e) {
      setErr(e.message);
    } finally {
      setDeletingId(null);
    }
  }

  const sortedCats = useMemo(
    () => [...categories].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
    [categories]
  );

  const catById = useMemo(() => {
    const m = new Map();
    for (const c of categories) m.set(c.id, c);
    return m;
  }, [categories]);

  function openBudgetCatalogCategory() {
    setCatForm({ nombre: '', sortOrder: '', active: true });
    setCatalogModal('category');
  }

  function openBudgetCatalogItem() {
    const firstCat = sortedCats[0]?.id || '';
    setItemForm({
      categoryId: filterCat || firstCat,
      codigo: '',
      descripcion: '',
      unidad: 'UND',
      tipo: 'ACTIVO',
      unitPrice: '',
      sortOrder: '',
      active: true,
    });
    setCatalogModal('item');
  }

  async function saveBudgetCatalogCategory(e) {
    e.preventDefault();
    if (!isAdmin) return;
    setErr(null);
    try {
      const body = {
        nombre: catForm.nombre.trim(),
        sortOrder: catForm.sortOrder === '' ? undefined : parseInt(catForm.sortOrder, 10),
        active: catForm.active,
      };
      const created = await api.post('/api/catalog/categories', body);
      setCatalogModal(null);
      await refreshCatalog();
      if (created?.id) setFilterCat(created.id);
    } catch (e2) {
      setErr(e2.message);
    }
  }

  async function saveBudgetCatalogItem(e) {
    e.preventDefault();
    if (!isAdmin) return;
    setErr(null);
    const unitPrice = parseFloat(String(itemForm.unitPrice).replace(',', '.'));
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      setErr('Precio inválido');
      return;
    }
    if (!itemForm.categoryId) {
      setErr('Seleccione una categoría');
      return;
    }
    const body = {
      categoryId: itemForm.categoryId,
      codigo: itemForm.codigo.trim(),
      descripcion: itemForm.descripcion.trim(),
      unidad: itemForm.unidad || 'UND',
      tipo: itemForm.tipo,
      unitPrice,
      sortOrder: itemForm.sortOrder === '' ? undefined : parseInt(itemForm.sortOrder, 10),
      active: itemForm.active,
    };
    try {
      await api.post('/api/catalog/items', body);
      setCatalogModal(null);
      await refreshCatalog();
      setQInput(body.codigo);
    } catch (e2) {
      setErr(e2.message);
    }
  }

  if (loading && !project) {
    return (
      <section className="view-active">
        <p className="muted mono">Cargando presupuesto…</p>
      </section>
    );
  }

  if (err && !project) {
    return (
      <section className="view-active">
        <div className="banner banner--err mono">{err}</div>
        <Link to="/projects" className="btn btn-ghost">
          Volver a proyectos
        </Link>
      </section>
    );
  }

  return (
    <section className="view-active budget-view">
      <div className="page-header page-header--row">
        <div>
          <p className="mono muted" style={{ marginBottom: 4, fontSize: 11 }}>
            <Link to="/projects" className="budget-back-link">
              ← Proyectos
            </Link>
          </p>
          <h1 className="page-title">{project?.nombre || 'Presupuesto'}</h1>
          <p className="page-sub muted mono">
            {STATUS_LABEL[project?.status || projectStatus] || projectStatus} · {items.length} ítems · Lista{' '}
            {formatUsd(totals.lista)}
          </p>
        </div>
        <div className="page-header-actions">
          {canWrite && (
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setModal('custom')}>
                Pieza personalizada
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ color: 'var(--red)' }}
                onClick={() => setModal('clear')}
              >
                Limpiar
              </button>
            </>
          )}
        </div>
      </div>

      <QuotationStatusFlow
        projectId={projectId}
        status={project?.status ?? projectStatus}
        canWrite={canWrite}
        viewerMode={viewerMode}
        onStatusChange={(data) => {
          setProject(data);
          setProjectStatus(data.status);
        }}
      />

      <ProjectWorkNav />

      {err && (
        <div className="banner banner--err mono" style={{ marginBottom: 12 }}>
          {err}
        </div>
      )}

      <div className="budget-infobar mono">
        <span>Total lista: {formatUsd(totals.lista)}</span>
        <span className="budget-infobar-sep">|</span>
        <span>Activos: {formatUsd(totals.activos)}</span>
        <span className="budget-infobar-sep">|</span>
        <span>Consumibles: {formatUsd(totals.consumibles)}</span>
        <span className="budget-infobar-sep">|</span>
        <span>Ítems: {items.length}</span>
      </div>

      <div className="budget-workspace">
        <div className="budget-main">
      <div className="budget-grid">
        <aside className="budget-panel budget-panel--catalog">
          <h2 className="budget-panel-title">Catálogo</h2>
          <div className="budget-toolbar">
            <input
              type="search"
              className="form-input mono"
              placeholder="Buscar (debounce 200ms)…"
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
            />
            <select className="form-input" value={filterCat} onChange={(e) => setFilterCat(e.target.value)}>
              <option value="">Todas las categorías</option>
              {sortedCats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
            <select className="form-input" value={filterTipo} onChange={(e) => setFilterTipo(e.target.value)}>
              <option value="">Todos los tipos</option>
              <option value="ACTIVO">ACTIVO</option>
              <option value="CONSUMIBLE">CONSUMIBLE</option>
            </select>
            <div className="budget-add-opts mono">
              <label>
                Cant.
                <input
                  className="form-input"
                  style={{ maxWidth: 72 }}
                  value={addQty}
                  onChange={(e) => setAddQty(e.target.value)}
                />
              </label>
              <label title="Opcional">
                Precio USD
                <input
                  className="form-input"
                  style={{ maxWidth: 88 }}
                  placeholder="auto"
                  value={addPriceOverride}
                  onChange={(e) => setAddPriceOverride(e.target.value)}
                />
              </label>
            </div>
            {isAdmin && (
              <div className="budget-catalog-actions">
                <button type="button" className="btn btn-ghost" onClick={openBudgetCatalogCategory}>
                  + Categoría
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={openBudgetCatalogItem}
                  disabled={sortedCats.length === 0}
                  title={sortedCats.length === 0 ? 'Cree primero una categoría' : undefined}
                >
                  + Ítem catálogo
                </button>
                <span className="budget-catalog-actions__hint muted mono">Admin · mismo catálogo global</span>
              </div>
            )}
          </div>
          <div className="budget-catalog-list zgroup-scroll">
            {filteredCatalog.length === 0 ? (
              <p className="muted mono" style={{ padding: 12 }}>
                Sin resultados
              </p>
            ) : (
              filteredCatalog.map((it) => {
                const catNombre = it.categoryNombre || catById.get(it.categoryId)?.nombre || '—';
                const tipoClass =
                  it.tipo === 'CONSUMIBLE' ? 'budget-badge--consumible' : 'budget-badge--activo';
                return (
                  <button
                    key={it.id}
                    type="button"
                    className="budget-cat-item"
                    disabled={!canWrite}
                    onClick={() => addFromCatalog(it)}
                  >
                    <div className="budget-cat-tags">
                      <span className={`budget-badge budget-badge--tipo ${tipoClass}`}>{it.tipo}</span>
                      <span className="budget-badge budget-badge--cat mono" title={catNombre}>
                        {catNombre}
                      </span>
                    </div>
                    <span className="budget-cat-code mono">{it.codigo}</span>
                    <span className="budget-cat-desc">{it.descripcion}</span>
                    <span className="budget-cat-meta mono">
                      {formatUsd(it.unitPrice)} / {it.unidad}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <div className="budget-panel budget-panel--table">
          <h2 className="budget-panel-title">Líneas del presupuesto</h2>
          <div className="table-wrap budget-table-wrap zgroup-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Descripción</th>
                  <th>Categoría</th>
                  <th>Tipo</th>
                  <th>Unidad</th>
                  <th className="num">P. unit.</th>
                  <th className="num">Cant.</th>
                  <th className="num">Subtotal</th>
                  {canWrite && (
                    <th className="actions-col budget-actions-th" scope="col" title="Quitar línea" aria-label="Quitar">
                      <span className="budget-actions-th-icon" aria-hidden="true">
                        ×
                      </span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={canWrite ? 9 : 8} className="muted">
                      Agregue ítems desde el catálogo o una pieza personalizada.
                    </td>
                  </tr>
                ) : (
                  items.map((row) => {
                    const dr = getDraft(row.id);
                    const catLabel = row.categoryNombre || '—';
                    return (
                      <tr
                        key={row.id}
                        className={deletingId === row.id ? 'budget-row-deleting' : ''}
                      >
                        <td className="mono">{row.codigo}</td>
                        <td>{row.descripcion}</td>
                        <td>
                          <span className="budget-badge budget-badge--cat mono" title={catLabel}>
                            {catLabel}
                          </span>
                        </td>
                        <td className="mono">{row.tipo}</td>
                        <td className="mono">{row.unidad}</td>
                        <td className="num">
                          {canWrite ? (
                            <input
                              className="form-input table-input mono"
                              value={dr.unitPrice}
                              onChange={(e) => setDraft(row.id, 'unitPrice', e.target.value)}
                            />
                          ) : (
                            formatUsd(row.unitPrice)
                          )}
                        </td>
                        <td className="num">
                          {canWrite ? (
                            <input
                              className="form-input table-input mono"
                              value={dr.qty}
                              onChange={(e) => setDraft(row.id, 'qty', e.target.value)}
                            />
                          ) : (
                            row.qty
                          )}
                        </td>
                        <td className="num mono">{formatUsd(row.subtotal)}</td>
                        {canWrite && (
                          <td className="actions-cell budget-actions-cell">
                            <button
                              type="button"
                              className="budget-row-remove"
                              title="Quitar esta línea del presupuesto"
                              aria-label={`Quitar línea ${row.codigo}`}
                              disabled={deletingId === row.id}
                              onClick={() => removeItem(row.id)}
                            >
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                <path
                                  d="M18 6L6 18M6 6l12 12"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                />
                              </svg>
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <footer className="budget-footer mono">
            <span>ACTIVOS: {formatUsd(totals.activos)}</span>
            <span>CONSUMIBLES: {formatUsd(totals.consumibles)}</span>
            <span className="budget-footer-total">TOTAL LISTA: {formatUsd(totals.lista)}</span>
          </footer>
        </div>
      </div>
        </div>

        <aside className="budget-fin-sidebar" aria-label="Módulos financieros">
      <FinanceModules
        baseLista={totals.lista}
        baseActivos={totals.activos}
        baseConsumibles={totals.consumibles}
        financeParams={financeParams}
        onFinanceParamsChange={setFinanceParams}
        viewerMode={viewerMode}
        tc={project?.tc != null ? Number(project.tc) : 3.75}
        onTcChange={canWrite ? handleTcChange : undefined}
        finPanelClassName="zgroup-scroll"
      />
        </aside>
      </div>

      {canWrite && (
        <div className="panel budget-export-panel">
          <div className="panel-hdr">
            <span className="panel-title">Exportar PDF</span>
          </div>
          <p className="muted mono" style={{ fontSize: 12, lineHeight: 1.5 }}>
            <strong>Gerencia PDF</strong>: presupuesto, M1–M4 + panel M5 (CP vs LP).{' '}
            <strong>Cliente PDF</strong>: portada y totales por modalidad sin datos internos (ROA, spreads).
            <br />
            El bloque <strong>M5 · Panel gerencial</strong> en la sección de arriba muestra los mismos datos
            que irán al PDF Gerencia (ajusta el horizonte en meses antes de exportar).
          </p>
          <div
            className="panel panel--flush"
            style={{ marginTop: 14, padding: 12, border: '1px solid var(--border-dim)', borderRadius: 8 }}
          >
            <p className="fin-param__label" style={{ marginBottom: 10 }}>
              Configuración del reporte PDF
            </p>
            <div className="stack-form" style={{ gap: 12 }}>
              <label className="chk mono" style={{ fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={financeParams.pdfShowRentalMonths !== false}
                  onChange={(e) =>
                    setFinanceParams((f) => ({ ...f, pdfShowRentalMonths: e.target.checked }))
                  }
                />
                Incluir tabla de meses de alquiler / cuotas (CP y LP F1/F2)
              </label>
              <label className="chk mono" style={{ fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={financeParams.pdfIncludeIgv === true}
                  onChange={(e) =>
                    setFinanceParams((f) => ({ ...f, pdfIncludeIgv: e.target.checked }))
                  }
                />
                Mostrar IGV Perú 18% sobre total venta (referencia)
              </label>
              <label>
                <span className="fg-lbl">Logo en PDF (URL https o imagen data URL)</span>
                <input
                  className="form-input mono"
                  style={{ fontSize: 12 }}
                  placeholder="Vacío = texto ZGROUP · ej. https://…/logo.png"
                  value={financeParams.pdfLogoUrl ?? ''}
                  onChange={(e) => setFinanceParams((f) => ({ ...f, pdfLogoUrl: e.target.value }))}
                />
                <span className="fin-param__hint" style={{ display: 'block', marginTop: 6 }}>
                  Debe ser accesible desde el servidor que genera el PDF (o pegue una data URL base64).
                </span>
              </label>
              <label>
                <span className="fg-lbl">Pie de página del PDF</span>
                <textarea
                  className="form-input form-textarea mono"
                  style={{ fontSize: 12, minHeight: 64 }}
                  placeholder="Texto legal, contacto, vigencia de la cotización…"
                  rows={3}
                  value={financeParams.pdfFooter ?? ''}
                  onChange={(e) => setFinanceParams((f) => ({ ...f, pdfFooter: e.target.value }))}
                />
              </label>
            </div>
          </div>
          <div className="pdf-export-actions">
            <div className="pdf-export-actions__row">
              <span className="fg-lbl" style={{ width: '100%', marginBottom: 4 }}>
                Vista previa (mismo HTML que el PDF)
              </span>
              <button
                type="button"
                className="btn btn-primary mono"
                disabled={!!pdfPreviewLoading}
                onClick={() => setPdfPreviewKind('GERENCIA')}
              >
                Ver Gerencia
              </button>
              <button
                type="button"
                className="btn btn-primary mono"
                disabled={!!pdfPreviewLoading}
                onClick={() => setPdfPreviewKind('CLIENTE')}
              >
                Ver Cliente
              </button>
            </div>
            <div className="pdf-export-actions__row" style={{ marginTop: 10 }}>
              <button
                type="button"
                className="btn btn-ghost mono"
                disabled={pdfBusy}
                onClick={() => startPdf('GERENCIA')}
              >
                Descargar PDF Gerencia
              </button>
              <button
                type="button"
                className="btn btn-ghost mono"
                disabled={pdfBusy}
                onClick={() => startPdf('CLIENTE')}
              >
                Descargar PDF Cliente
              </button>
            </div>
          </div>
          {pdfBusy && <p className="muted mono" style={{ marginTop: 8 }}>Generando… (polling cada 2s)</p>}
          {pdfMsg && (
            <div className="banner banner--warn mono" style={{ marginTop: 10 }}>
              {pdfMsg}
            </div>
          )}
        </div>
      )}

      {pdfPreviewKind && (
        <Modal
          title="Vista previa del reporte PDF"
          panelClassName="modal-panel--pdf-preview"
          onClose={() => setPdfPreviewKind(null)}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setPdfPreviewKind(null)}>
                Cerrar
              </button>
              <button
                type="button"
                className="btn btn-primary mono"
                disabled={pdfBusy}
                onClick={() => {
                  const k = pdfPreviewKind;
                  setPdfPreviewKind(null);
                  startPdf(k);
                }}
              >
                Descargar {pdfPreviewKind === 'GERENCIA' ? 'Gerencia' : 'Cliente'}
              </button>
            </>
          }
        >
          <p className="pdf-preview-hint">
            Misma composición que el PDF generado (tipografía y márgenes del servidor pueden variar ligeramente al
            imprimir). Use las pestañas para comparar informes.
          </p>
          <div className="pdf-preview-toolbar">
            <div className="pdf-preview-tabs" role="tablist" aria-label="Tipo de reporte">
              <button
                type="button"
                role="tab"
                aria-selected={pdfPreviewKind === 'GERENCIA'}
                className={`pdf-preview-tab${pdfPreviewKind === 'GERENCIA' ? ' pdf-preview-tab--on' : ''}`}
                onClick={() => setPdfPreviewKind('GERENCIA')}
              >
                Gerencia
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={pdfPreviewKind === 'CLIENTE'}
                className={`pdf-preview-tab${pdfPreviewKind === 'CLIENTE' ? ' pdf-preview-tab--on' : ''}`}
                onClick={() => setPdfPreviewKind('CLIENTE')}
              >
                Cliente
              </button>
            </div>
            {pdfPreviewLoading && <span className="muted mono">Cargando…</span>}
            {pdfPreviewErr && <span className="muted mono" style={{ color: 'var(--red)' }}>{pdfPreviewErr}</span>}
          </div>
          {pdfPreviewLoading && (
            <div className="pdf-preview-frame pdf-preview-frame--loading muted mono">Generando vista previa…</div>
          )}
          {!pdfPreviewLoading && pdfPreviewUrl && (
            <iframe title="Vista previa PDF" className="pdf-preview-frame" src={pdfPreviewUrl} />
          )}
        </Modal>
      )}

      {catalogModal === 'category' && isAdmin && (
        <Modal
          title="Nueva categoría"
          onClose={() => setCatalogModal(null)}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setCatalogModal(null)}>
                Cancelar
              </button>
              <button type="submit" form="budget-cat-form" className="btn btn-primary">
                Guardar
              </button>
            </>
          }
        >
          <form id="budget-cat-form" className="stack-form" onSubmit={saveBudgetCatalogCategory}>
            <label>
              <span className="fg-lbl">Nombre *</span>
              <input
                className="form-input"
                required
                value={catForm.nombre}
                onChange={(e) => setCatForm((f) => ({ ...f, nombre: e.target.value }))}
              />
            </label>
            <label>
              <span className="fg-lbl">Orden (opcional)</span>
              <input
                type="number"
                className="form-input mono"
                value={catForm.sortOrder}
                onChange={(e) => setCatForm((f) => ({ ...f, sortOrder: e.target.value }))}
              />
            </label>
            <label className="chk-row">
              <input
                type="checkbox"
                checked={catForm.active}
                onChange={(e) => setCatForm((f) => ({ ...f, active: e.target.checked }))}
              />
              <span>Activa</span>
            </label>
          </form>
        </Modal>
      )}

      {catalogModal === 'item' && isAdmin && (
        <Modal
          title="Nuevo ítem en catálogo"
          wide
          onClose={() => setCatalogModal(null)}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setCatalogModal(null)}>
                Cancelar
              </button>
              <button type="submit" form="budget-item-form" className="btn btn-primary">
                Guardar
              </button>
            </>
          }
        >
          <form id="budget-item-form" className="stack-form" onSubmit={saveBudgetCatalogItem}>
            <label>
              <span className="fg-lbl">Categoría *</span>
              <select
                className="form-input"
                required
                value={itemForm.categoryId}
                onChange={(e) => setItemForm((f) => ({ ...f, categoryId: e.target.value }))}
              >
                <option value="">—</option>
                {sortedCats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="fg-lbl">Código *</span>
              <input
                className="form-input mono"
                required
                value={itemForm.codigo}
                onChange={(e) => setItemForm((f) => ({ ...f, codigo: e.target.value }))}
              />
            </label>
            <label>
              <span className="fg-lbl">Descripción *</span>
              <input
                className="form-input"
                required
                value={itemForm.descripcion}
                onChange={(e) => setItemForm((f) => ({ ...f, descripcion: e.target.value }))}
              />
            </label>
            <label>
              <span className="fg-lbl">Unidad</span>
              <input
                className="form-input mono"
                value={itemForm.unidad}
                onChange={(e) => setItemForm((f) => ({ ...f, unidad: e.target.value }))}
              />
            </label>
            <label>
              <span className="fg-lbl">Tipo *</span>
              <select
                className="form-input"
                value={itemForm.tipo}
                onChange={(e) => setItemForm((f) => ({ ...f, tipo: e.target.value }))}
              >
                <option value="ACTIVO">ACTIVO</option>
                <option value="CONSUMIBLE">CONSUMIBLE</option>
              </select>
            </label>
            <label>
              <span className="fg-lbl">Precio unitario (USD) *</span>
              <input
                type="number"
                step="0.01"
                min="0"
                className="form-input mono"
                required
                value={itemForm.unitPrice}
                onChange={(e) => setItemForm((f) => ({ ...f, unitPrice: e.target.value }))}
              />
            </label>
            <label>
              <span className="fg-lbl">Orden (opcional)</span>
              <input
                type="number"
                className="form-input mono"
                value={itemForm.sortOrder}
                onChange={(e) => setItemForm((f) => ({ ...f, sortOrder: e.target.value }))}
              />
            </label>
            <label className="chk-row">
              <input
                type="checkbox"
                checked={itemForm.active}
                onChange={(e) => setItemForm((f) => ({ ...f, active: e.target.checked }))}
              />
              <span>Activo</span>
            </label>
          </form>
        </Modal>
      )}

      {modal === 'clear' && (
        <Modal
          title="Limpiar presupuesto"
          onClose={() => setModal(null)}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setModal(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                style={{ borderColor: 'var(--red)', color: 'var(--red)' }}
                onClick={clearBudget}
              >
                Limpiar todo
              </button>
            </>
          }
        >
          <p className="muted">Se eliminarán todas las líneas del presupuesto. Esta acción queda registrada en auditoría.</p>
        </Modal>
      )}

      {modal === 'custom' && (
        <Modal
          title="Pieza personalizada"
          onClose={() => setModal(null)}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setModal(null)}>
                Cancelar
              </button>
              <button type="submit" form="budget-custom-form" className="btn btn-primary">
                Agregar
              </button>
            </>
          }
        >
          <form id="budget-custom-form" className="stack-form" onSubmit={addCustom}>
            <label>
              <span className="fg-lbl">Código *</span>
              <input
                className="form-input mono"
                required
                value={customForm.codigo}
                onChange={(e) => setCustomForm((f) => ({ ...f, codigo: e.target.value }))}
              />
            </label>
            <label>
              <span className="fg-lbl">Descripción *</span>
              <input
                className="form-input"
                required
                value={customForm.descripcion}
                onChange={(e) => setCustomForm((f) => ({ ...f, descripcion: e.target.value }))}
              />
            </label>
            <label>
              <span className="fg-lbl">Categoría (opcional)</span>
              <select
                className="form-input"
                value={customForm.categoryId}
                onChange={(e) => setCustomForm((f) => ({ ...f, categoryId: e.target.value }))}
              >
                <option value="">— Sin categoría —</option>
                {sortedCats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="fg-lbl">Unidad</span>
              <input
                className="form-input mono"
                value={customForm.unidad}
                onChange={(e) => setCustomForm((f) => ({ ...f, unidad: e.target.value }))}
              />
            </label>
            <label>
              <span className="fg-lbl">Tipo</span>
              <select
                className="form-input"
                value={customForm.tipo}
                onChange={(e) => setCustomForm((f) => ({ ...f, tipo: e.target.value }))}
              >
                <option value="ACTIVO">ACTIVO</option>
                <option value="CONSUMIBLE">CONSUMIBLE</option>
              </select>
            </label>
            <label>
              <span className="fg-lbl">Precio unitario (USD)</span>
              <input
                className="form-input mono"
                required
                value={customForm.unitPrice}
                onChange={(e) => setCustomForm((f) => ({ ...f, unitPrice: e.target.value }))}
              />
            </label>
            <label>
              <span className="fg-lbl">Cantidad</span>
              <input
                className="form-input mono"
                required
                value={customForm.qty}
                onChange={(e) => setCustomForm((f) => ({ ...f, qty: e.target.value }))}
              />
            </label>
          </form>
        </Modal>
      )}
    </section>
  );
}
