import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, getText, getToken, resolveAppUrl, postFormData, downloadGet } from '../lib/api';
import { fetchCatalog } from '../lib/catalogApi';
import { useAuth } from '../context/AuthContext';
import { Modal } from '../components/Modal';
import { FinanceModules } from '../components/finance/FinanceModules';
import { ProjectWorkNav } from '../components/ProjectWorkNav';
import { mergeFinanceParams } from '@shared/finance-engine.js';
import { resolveCommercialModules } from '../lib/commercialFinanceAccess';
import { STATUS_LABEL } from '../lib/quotationStatus';
import { QuotationStatusFlow } from '../components/QuotationStatusFlow';
import { ProjectShareModal } from '../components/ProjectShareModal';
import { SearchableSelect } from '../components/SearchableSelect';
import { ClientPicker } from '../components/ClientPicker';
import { CatalogDependencyAddModal } from '../components/CatalogDependencyAddModal';
import { KitInstanceModal } from '../components/KitInstanceModal';
import { ProjectBudgetHistory } from '../components/ProjectBudgetHistory';
import { formatItemTraceUser } from '../lib/projectAuditLabels';
import { fetchCategoryNextCodigo } from '../lib/catalogCodigoApi';
import { MeasureUnitSelect } from '../components/MeasureUnitSelect';

function formatUsd(n) {
  if (n == null || Number.isNaN(n)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

function parsePriceDraft(s) {
  const p = parseFloat(String(s ?? '').replace(',', '.'));
  return Number.isNaN(p) ? null : p;
}

/** Agrupa componentes KIT por catalogItemId sumando cantidades (vista consolidada). */
function buildConsolidatedKitBudgetRows(sorted) {
  const result = [];
  let i = 0;
  while (i < sorted.length) {
    const row = sorted[i];
    if (!row.isBundleHeader) {
      result.push(row);
      i += 1;
      continue;
    }
    result.push(row);
    i += 1;
    const comps = [];
    while (i < sorted.length && sorted[i].isBundleComponent && sorted[i].bundleId === row.bundleId) {
      comps.push(sorted[i]);
      i += 1;
    }
    const merged = new Map();
    for (const c of comps) {
      const k = c.catalogItemId || c.id;
      if (!merged.has(k)) {
        merged.set(k, {
          ...c,
          qty: Number(c.qty),
          subtotal: Number(c.subtotal),
          kitConsolidated: true,
        });
      } else {
        const ex = merged.get(k);
        ex.qty = Math.round((Number(ex.qty) + Number(c.qty)) * 1000) / 1000;
        ex.subtotal = Math.round((Number(ex.subtotal) + Number(c.subtotal)) * 100) / 100;
      }
    }
    result.push(
      ...[...merged.values()].sort((a, b) => String(a.codigo || '').localeCompare(String(b.codigo || '')))
    );
  }
  return result;
}

/** Precio de lista (ref.) vs asumido en cotización. */
function unitPricesDiffer(official, current) {
  if (official == null || current == null) return false;
  return Math.abs(Number(official) - Number(current)) > 0.005;
}

export function ProjectBudgetPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const { hasRole, user, canManageCatalog, canShareProjects, isSuperuser } = useAuth();
  const viewerMode = user?.role === 'VIEWER';
  const hideItemPrices = user?.role === 'COMERCIAL';
  const canWrite = hasRole('ADMIN', 'SEMIADMIN', 'COMERCIAL', 'SUPERUSER');
  const isAdmin = canManageCatalog();
  const isCommercial = user?.role === 'COMERCIAL';
  /** Editar celdas, quitar línea y limpiar presupuesto: comercial en propios/compartidos; catálogo solo admin. */
  const canEditBudgetLines = canWrite && !viewerMode;
  const canEditUnitPrices = canEditBudgetLines && !hideItemPrices;
  const showAdjustmentCol = !hideItemPrices;
  const budgetTableColSpan = useMemo(() => {
    let n = 6;
    if (!hideItemPrices) n += 2;
    if (showAdjustmentCol) n += 1;
    if (canEditBudgetLines) n += 1;
    return n;
  }, [hideItemPrices, showAdjustmentCol, canEditBudgetLines]);

  const [project, setProject] = useState(null);
  const [projectStatus, setProjectStatus] = useState(null);
  const [items, setItems] = useState([]);
  const [totals, setTotals] = useState({
    activos: 0,
    consumibles: 0,
    lista: 0,
    activosAdj: 0,
    consumiblesAdj: 0,
    activosExempt: 0,
    consumiblesExempt: 0,
    listaAdj: 0,
    listaExempt: 0,
  });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const [categories, setCategories] = useState([]);
  const [catItems, setCatItems] = useState([]);
  const [filterCat, setFilterCat] = useState('');
  const [qInput, setQInput] = useState('');
  const [qDebounced, setQDebounced] = useState('');
  const [filterTipo, setFilterTipo] = useState('');
  const [addQty, setAddQty] = useState('1');
  const [depAddModal, setDepAddModal] = useState(null);
  const [depAddBusy, setDepAddBusy] = useState(false);
  const [kitModal, setKitModal] = useState(null);
  const [kitAddBusy, setKitAddBusy] = useState(false);
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
  const commercialModules = useMemo(
    () => (hideItemPrices ? resolveCommercialModules(user, financeParams) : null),
    [hideItemPrices, user, financeParams]
  );
  const showFinanceCommercial =
    commercialModules && Object.values(commercialModules).some(Boolean);
  const showFinancePanel = !viewerMode && (!hideItemPrices || showFinanceCommercial);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfMsg, setPdfMsg] = useState(null);
  const pdfPollRef = useRef(null);
  const [pdfPreviewKind, setPdfPreviewKind] = useState(null);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState(null);
  const [pdfPreviewLoading, setPdfPreviewLoading] = useState(false);
  const [pdfPreviewErr, setPdfPreviewErr] = useState(null);
  const [budgetImportModal, setBudgetImportModal] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareCount, setShareCount] = useState(0);
  const [budgetImportPreview, setBudgetImportPreview] = useState(null);
  const [budgetImportBusy, setBudgetImportBusy] = useState(false);
  const budgetImportInputRef = useRef(null);
  const [budgetLineMetaId, setBudgetLineMetaId] = useState(null);
  const [budgetLineQ, setBudgetLineQ] = useState('');

  /** Alta rápida de catálogo (solo ADMIN; API /api/catalog/*) */
  const [catalogModal, setCatalogModal] = useState(null);
  const [catForm, setCatForm] = useState({ nombre: '', sortOrder: '', codigoPrefix: '', active: true });
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
  const [itemCodigoHint, setItemCodigoHint] = useState(null);

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

  const [accessibleProjects, setAccessibleProjects] = useState([]);
  const [clientsList, setClientsList] = useState([]);
  const [newProjectBusy, setNewProjectBusy] = useState(false);
  const [dupBusy, setDupBusy] = useState(false);
  const [newProjectForm, setNewProjectForm] = useState({
    nombre: '',
    odooRef: '',
    clientId: '',
  });
  const [editProjectForm, setEditProjectForm] = useState({ nombre: '', odooRef: '', clientId: '' });
  const [editProjectBusy, setEditProjectBusy] = useState(false);
  const [budgetHistoryOpen, setBudgetHistoryOpen] = useState(false);
  const [dupNombre, setDupNombre] = useState('');
  const [dupClientId, setDupClientId] = useState('');
  const [dupAllItems, setDupAllItems] = useState(true);
  const [dupItemIds, setDupItemIds] = useState(() => new Set());

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

  useEffect(() => {
    if (budgetLineMetaId == null) {
      return undefined;
    }
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => {
      if (e.key === 'Escape') setBudgetLineMetaId(null);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [budgetLineMetaId]);

  const loadAll = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setErr(null);
    try {
      const [proj, budget, catData, projs, clData] = await Promise.all([
        api.get(`/api/projects/${projectId}`),
        api.get(`/api/projects/${projectId}/items`),
        fetchCatalog(false).then((r) => r.data),
        api.get('/api/projects'),
        canWrite ? api.get('/api/clients').catch(() => []) : Promise.resolve([]),
      ]);
      setAccessibleProjects(Array.isArray(projs) ? projs : []);
      if (canWrite && Array.isArray(clData)) setClientsList(clData);
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
  }, [projectId, canWrite]);

  const canManageShare =
    canShareProjects() && (isSuperuser() || project?.createdBy === user?.id);

  const loadShareCount = useCallback(async () => {
    if (!projectId || !canManageShare) return;
    try {
      const shares = await api.get(`/api/projects/${projectId}/shares`);
      setShareCount(Array.isArray(shares) ? shares.length : 0);
    } catch {
      setShareCount(0);
    }
  }, [projectId, canManageShare]);

  useEffect(() => {
    loadShareCount();
  }, [loadShareCount, project?.createdBy]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  async function changeQuotationMarket(nextMarket) {
    if (!isSuperuser() || !projectId) return;
    setErr(null);
    try {
      const data = await api.put(`/api/projects/${projectId}`, { quotationMarket: nextMarket });
      setProject(data);
      await loadAll();
    } catch (e2) {
      setErr(e2.message);
    }
  }

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const handleTcChange = useCallback((v) => {
    const n = Number(v) > 0 ? Number(v) : 3.75;
    setProject((prev) => (prev ? { ...prev, tc: n } : prev));
  }, []);

  useEffect(() => {
    if (!projectId || !canWrite || !project || hideItemPrices) return;
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
  }, [financeParams, project, projectId, canWrite, hideItemPrices]);

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
    return [...list].sort((a, b) => Number(b.unitPrice || 0) - Number(a.unitPrice || 0));
  }, [catItems, filterCat, qDebounced, filterTipo]);

  const displayBudgetItems = useMemo(() => {
    let list = [...items].sort((a, b) => {
      const sa = Number(a.sortOrder ?? 0);
      const sb = Number(b.sortOrder ?? 0);
      if (sa !== sb) return sa - sb;
      return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
    });
    const qq = budgetLineQ.trim().toLowerCase();
    if (qq) {
      list = list.filter(
        (row) =>
          (row.codigo && row.codigo.toLowerCase().includes(qq)) ||
          (row.descripcion && row.descripcion.toLowerCase().includes(qq)) ||
          (row.bundleDisplayName && row.bundleDisplayName.toLowerCase().includes(qq))
      );
    }
    return list;
  }, [items, budgetLineQ]);

  const budgetTableItems = useMemo(
    () => buildConsolidatedKitBudgetRows(displayBudgetItems),
    [displayBudgetItems]
  );

  /** Índice de color 1–6 por conjunto KIT (mismo color cabecera + componentes). */
  const bundleGroupById = useMemo(() => {
    const map = new Map();
    let n = 0;
    const sorted = [...items].sort((a, b) => {
      const sa = Number(a.sortOrder ?? 0);
      const sb = Number(b.sortOrder ?? 0);
      if (sa !== sb) return sa - sb;
      return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
    });
    for (const row of sorted) {
      if (row.bundleId && !map.has(row.bundleId)) {
        n += 1;
        map.set(row.bundleId, ((n - 1) % 6) + 1);
      }
    }
    return map;
  }, [items]);

  const projectSelectOptions = useMemo(
    () =>
      accessibleProjects.map((p) => ({
        value: p.id,
        label: `${p.nombre}${p.clientRazonSocial ? ` — ${p.clientRazonSocial}` : ''}`,
        searchText: [p.nombre, p.clientRazonSocial, p.odooRef].filter(Boolean).join(' '),
      })),
    [accessibleProjects]
  );

  const [, bump] = useState(0);
  const force = useCallback(() => bump((n) => n + 1), []);

  function getDraft(id) {
    return draftsRef.current[id] || { qty: '1', unitPrice: '0' };
  }

  function setDraft(id, field, value) {
    draftsRef.current[id] = { ...getDraft(id), [field]: value };
    force();
    if (!canEditBudgetLines) return;
    if (flushTimers.current[id]) clearTimeout(flushTimers.current[id]);
    flushTimers.current[id] = setTimeout(() => flushRow(id), 300);
  }

  async function toggleApplyAdjustment(id, applyAdjustment) {
    if (!canEditBudgetLines) return;
    setErr(null);
    try {
      const data = await api.put(`/api/projects/${projectId}/items/${id}`, { applyAdjustment });
      setItems(data.items);
      setTotals(data.totals);
      if (data.projectStatus) setProjectStatus(data.projectStatus);
      syncDraftFromItems(data.items);
    } catch (e) {
      setErr(e.message);
    }
  }

  async function flushRow(id) {
    if (!canEditBudgetLines) return;
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

  async function commitBudgetLines(lines, opts = {}) {
    const body = { lines };
    if (opts.source) body.source = opts.source;
    const data = await api.post(`/api/projects/${projectId}/items/batch`, body);
    setItems(data.items);
    setTotals(data.totals);
    if (data.projectStatus != null) setProjectStatus(data.projectStatus);
    syncDraftFromItems(data.items);
  }

  async function addFromCatalog(catalogItem) {
    if (!canWrite) return;
    setErr(null);
    const qty = parseFloat(String(addQty).replace(',', '.')) || 1;
    const o = addPriceOverride.trim();
    let unitPrice;
    if (o !== '') {
      const p = parseFloat(o.replace(',', '.'));
      if (!Number.isNaN(p) && p >= 0) unitPrice = p;
    }
    const cat = catById.get(catalogItem.categoryId);
    const isKitProduct = catalogItem.isKit === true || cat?.isKitCategory === true;
    const depCount = Number(catalogItem.dependencyCount) || 0;
    const hasDeps = depCount > 0 || catalogItem.hasDependencies === true;

    try {
      if (isKitProduct) {
        const [template, labelData] = await Promise.all([
          api.get(`/api/catalog/items/${catalogItem.id}/kit-template?qty=${qty}`),
          api.get(`/api/projects/${projectId}/bundles/next-label?catalogItemId=${catalogItem.id}`),
        ]);
        if (!template?.catalogItemId) {
          setErr('No se pudo cargar la plantilla del producto final.');
          return;
        }
        setKitModal({ template, suggestedLabel: labelData.label });
        return;
      }
      if (hasDeps) {
        const bundle = await api.get(`/api/catalog/items/${catalogItem.id}/dependency-bundle?qty=${qty}`);
        if (!bundle?.lines?.length) {
          setErr('No se pudieron cargar las dependencias de este ítem.');
          return;
        }
        setDepAddModal({ bundle, mainUnitPrice: unitPrice });
        return;
      }
      const line = { catalogItemId: catalogItem.id, qty };
      if (unitPrice != null) line.unitPrice = unitPrice;
      await commitBudgetLines([line]);
    } catch (e) {
      setErr(e.message);
    }
  }

  async function confirmKitAdd(payload) {
    if (!canWrite || !kitModal) return;
    setKitAddBusy(true);
    setErr(null);
    try {
      let data;
      if (kitModal.bundleId) {
        data = await api.put(`/api/projects/${projectId}/bundles/${kitModal.bundleId}`, {
          instanceLabel: payload.instanceLabel,
          displayName: payload.displayName,
          qty: payload.qty,
          lines: payload.lines,
        });
      } else {
        data = await api.post(`/api/projects/${projectId}/bundles`, {
          catalogItemId: kitModal.template.catalogItemId,
          instanceLabel: payload.instanceLabel,
          displayName: payload.displayName,
          qty: payload.qty,
          lines: payload.lines,
        });
      }
      setItems(data.items);
      setTotals(data.totals);
      if (data.projectStatus != null) setProjectStatus(data.projectStatus);
      syncDraftFromItems(data.items);
      setKitModal(null);
    } catch (e) {
      setErr(e.message);
    } finally {
      setKitAddBusy(false);
    }
  }

  async function openEditKitBundle(row) {
    if (!canWrite || !row.bundleId) return;
    setErr(null);
    try {
      const data = await api.get(`/api/projects/${projectId}/bundles/${row.bundleId}`);
      setKitModal({
        template: data,
        bundleId: data.bundleId,
        suggestedLabel: data.instanceLabel,
        editMode: true,
      });
    } catch (e) {
      setErr(e.message);
    }
  }

  async function confirmDependencyAdd(selectedLines) {
    if (!canWrite || !depAddModal) return;
    setDepAddBusy(true);
    setErr(null);
    try {
      const lines = selectedLines.map((l) => {
        const row = { catalogItemId: l.catalogItemId, qty: Number(l.qty) };
        if (l.isMain && depAddModal.mainUnitPrice != null) row.unitPrice = depAddModal.mainUnitPrice;
        return row;
      });
      await commitBudgetLines(lines, { source: 'dependencies' });
      setDepAddModal(null);
    } catch (e) {
      setErr(e.message);
    } finally {
      setDepAddBusy(false);
    }
  }

  async function addCustom(e) {
    e.preventDefault();
    if (!canWrite) return;
    setErr(null);
    const qty = parseFloat(String(customForm.qty).replace(',', '.'));
    if (Number.isNaN(qty) || qty < 0.001) {
      setErr('Cantidad inválida');
      return;
    }
    const body = {
      codigo: customForm.codigo.trim(),
      descripcion: customForm.descripcion.trim(),
      ...(customForm.categoryId ? { categoryId: customForm.categoryId } : {}),
      unidad: customForm.unidad.trim() || 'UND',
      tipo: customForm.tipo,
      qty,
    };
    if (!hideItemPrices) {
      const unitPrice = parseFloat(String(customForm.unitPrice).replace(',', '.'));
      if (Number.isNaN(unitPrice) || unitPrice < 0) {
        setErr('Precio y cantidad inválidos');
        return;
      }
      body.unitPrice = unitPrice;
    }
    try {
      const data = await api.post(`/api/projects/${projectId}/items`, {
        custom: body,
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
    if (!canEditBudgetLines) return;
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
    const pdfKind = hideItemPrices ? 'CLIENTE' : kind;
    if (hideItemPrices && kind === 'GERENCIA') return;
    if (pdfPollRef.current) {
      clearInterval(pdfPollRef.current);
      pdfPollRef.current = null;
    }
    setPdfBusy(true);
    setPdfMsg(null);
    setErr(null);
    try {
      const data = await api.post('/api/export/pdf', { projectId, kind: pdfKind });
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
    if (!canEditBudgetLines) return;
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

  const downloadBudgetLines = useCallback(
    async (format) => {
      if (!projectId) return;
      setErr(null);
      try {
        const blob = await downloadGet(
          `/api/projects/${projectId}/items/export?format=${encodeURIComponent(format)}`
        );
        const ext = format === 'csv' ? 'csv' : 'xlsx';
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `presupuesto-lineas-${projectId}.${ext}`;
        a.click();
        URL.revokeObjectURL(a.href);
      } catch (e) {
        setErr(e.message);
      }
    },
    [projectId]
  );

  async function onBudgetImportFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !projectId) return;
    setBudgetImportBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const data = await postFormData(`/api/projects/${projectId}/items/import/preview`, fd);
      setBudgetImportPreview(data);
      setBudgetImportModal(true);
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBudgetImportBusy(false);
    }
  }

  async function applyBudgetImport() {
    if (!budgetImportPreview?.results?.length || !projectId) return;
    const toApply = budgetImportPreview.results
      .filter((r) => (r.matchType === 'codigo' || r.matchType === 'descripcion') && r.catalogItem?.id)
      .map((r) => {
        const o = { catalogItemId: r.catalogItem.id, qty: Number(r.qty) };
        if (r.unitPrice != null && Number.isFinite(Number(r.unitPrice)))
          o.unitPrice = Number(r.unitPrice);
        return o;
      });
    if (!toApply.length) {
      setErr('No hay filas para importar: se requiere coincidencia exacta con el catálogo (código o descripción).');
      return;
    }
    setBudgetImportBusy(true);
    setErr(null);
    try {
      const data = await api.post(`/api/projects/${projectId}/items/import/apply`, { items: toApply });
      setItems(data.items);
      setTotals(data.totals);
      if (data.projectStatus != null) setProjectStatus(data.projectStatus);
      syncDraftFromItems(data.items);
      setBudgetImportModal(false);
      setBudgetImportPreview(null);
    } catch (e3) {
      setErr(e3.message);
    } finally {
      setBudgetImportBusy(false);
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
    setCatForm({ nombre: '', sortOrder: '', codigoPrefix: '', active: true });
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
    setItemCodigoHint(null);
    setCatalogModal('item');
    if (filterCat || firstCat) {
      fetchCategoryNextCodigo(filterCat || firstCat)
        .then((data) => {
          if (data?.suggestedCodigo) {
            setItemForm((f) => ({ ...f, codigo: data.suggestedCodigo }));
            setItemCodigoHint({ minCodigo: data.suggestedCodigo, prefix: data.prefix });
          }
        })
        .catch(() => {});
    }
  }

  async function onBudgetItemCategoryChange(categoryId) {
    setItemForm((f) => ({ ...f, categoryId }));
    try {
      const data = await fetchCategoryNextCodigo(categoryId);
      if (data?.suggestedCodigo) {
        setItemForm((f) => ({ ...f, categoryId, codigo: data.suggestedCodigo }));
        setItemCodigoHint({ minCodigo: data.suggestedCodigo, prefix: data.prefix });
      } else {
        setItemCodigoHint(null);
      }
    } catch {
      setItemCodigoHint(null);
    }
  }

  async function saveBudgetCatalogCategory(e) {
    e.preventDefault();
    if (!isAdmin) return;
    setErr(null);
    try {
      const body = {
        nombre: catForm.nombre.trim(),
        sortOrder: catForm.sortOrder === '' ? undefined : parseInt(catForm.sortOrder, 10),
        codigoPrefix: catForm.codigoPrefix.trim() || null,
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

  function openDuplicateModal() {
    if (!project) return;
    setDupNombre(`Copia de ${project.nombre}`);
    setDupClientId(project.clientId || '');
    setDupAllItems(true);
    setDupItemIds(new Set(items.map((i) => i.id)));
    setModal('duplicateProject');
  }

  function toggleDupItem(id) {
    setDupItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submitNewProject(e) {
    e.preventDefault();
    if (!canWrite) return;
    setNewProjectBusy(true);
    setErr(null);
    try {
      const createdProj = await api.post('/api/projects', {
        nombre: newProjectForm.nombre.trim(),
        odooRef: newProjectForm.odooRef.trim() || undefined,
        clientId: newProjectForm.clientId || undefined,
      });
      setModal(null);
      setNewProjectForm({
        nombre: '',
        odooRef: '',
        clientId: '',
      });
      navigate(`/projects/${createdProj.id}/presupuesto`);
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setNewProjectBusy(false);
    }
  }

  function openEditProjectModal() {
    if (!project?.canEditMetadata) return;
    setEditProjectForm({
      nombre: project.nombre || '',
      odooRef: project.odooRef || '',
      clientId: project.clientId || '',
    });
    setModal('editProject');
  }

  async function submitEditProject(e) {
    e.preventDefault();
    if (!projectId || !project?.canEditMetadata) return;
    setEditProjectBusy(true);
    setErr(null);
    try {
      const data = await api.put(`/api/projects/${projectId}`, {
        nombre: editProjectForm.nombre.trim(),
        odooRef: editProjectForm.odooRef.trim() || null,
        clientId: editProjectForm.clientId || null,
      });
      setProject(data);
      setAccessibleProjects((prev) =>
        prev.map((p) => (p.id === data.id ? { ...p, ...data, clientRazonSocial: data.clientRazonSocial } : p))
      );
      setModal(null);
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setEditProjectBusy(false);
    }
  }

  async function submitDuplicateProject(e) {
    e.preventDefault();
    if (!canWrite || !projectId) return;
    if (!dupAllItems && dupItemIds.size === 0) {
      setErr('Seleccione al menos una partida o elija “Todas las partidas”.');
      return;
    }
    setDupBusy(true);
    setErr(null);
    try {
      const body = {
        nombre: dupNombre.trim() || undefined,
        clientId: dupClientId || null,
      };
      if (!dupAllItems) {
        body.itemIds = Array.from(dupItemIds);
      }
      const createdProj = await api.post(`/api/projects/${projectId}/clone`, body);
      setModal(null);
      navigate(`/projects/${createdProj.id}/presupuesto`);
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setDupBusy(false);
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
            <button type="button" className="btn btn-ghost" onClick={() => setModal('custom')}>
              Pieza personalizada
            </button>
          )}
          {canEditBudgetLines && (
            <button
              type="button"
              className="btn btn-ghost"
              style={{ color: 'var(--red)' }}
              onClick={() => setModal('clear')}
            >
              Limpiar
            </button>
          )}
        </div>
      </div>

      <div className="budget-project-bar">
        <label className="budget-project-bar__lbl mono muted" htmlFor="budget-project-sel">
          Proyecto
        </label>
        <SearchableSelect
          id="budget-project-sel"
          className="form-input budget-project-sel mono"
          value={projectId}
          onChange={(id) => navigate(`/projects/${id}/presupuesto`)}
          options={projectSelectOptions}
          placeholder="Buscar proyecto…"
          emptyLabel="Sin proyectos coincidentes"
        />
        {isSuperuser() && project && (
          <label className="budget-project-bar__market mono">
            <span className="muted">Mercado cotización</span>
            <select
              className="form-input"
              value={project.quotationMarket || 'NACIONAL'}
              onChange={(e) => changeQuotationMarket(e.target.value)}
            >
              <option value="NACIONAL">Nacional</option>
              <option value="INTERNACIONAL">Internacional</option>
            </select>
          </label>
        )}
        {canWrite && (
          <div className="budget-project-bar__actions">
            {project?.canEditMetadata && (
              <button type="button" className="btn btn-ghost" onClick={openEditProjectModal}>
                Editar proyecto
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setNewProjectForm({
                  nombre: '',
                  odooRef: '',
                  clientId: project?.clientId || '',
                });
                setModal('newProject');
              }}
            >
              Nuevo proyecto
            </button>
            <button type="button" className="btn btn-ghost" onClick={openDuplicateModal}>
              Duplicar / variante
            </button>
          </div>
        )}
      </div>

      <QuotationStatusFlow
        projectId={projectId}
        status={project?.status ?? projectStatus}
        canWrite={canWrite}
        viewerMode={viewerMode}
        canShareProject={canManageShare}
        shareCount={shareCount}
        onShareClick={() => setShareOpen(true)}
        onStatusChange={(data) => {
          setProject(data);
          setProjectStatus(data.status);
        }}
      />

      <ProjectShareModal
        projectId={projectId}
        projectName={project?.nombre}
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        onSaved={loadShareCount}
      />

      {project?.canViewAudit && (
        <ProjectBudgetHistory
          projectId={projectId}
          open={budgetHistoryOpen}
          onToggle={() => setBudgetHistoryOpen((v) => !v)}
        />
      )}

      <div className="panel budget-io-panel">
        <div className="panel-hdr">
          <span className="panel-title">Exportar / importar líneas</span>
        </div>
        <p className="muted mono budget-io-panel__help">
          <span className="mono" style={{ color: 'var(--cyan)' }}>Exportar:</span> solo identificación y cantidades (sin
          precios ni subtotales), para compartir con proyectos. <span className="mono" style={{ color: 'var(--amber)' }}>Importar:</span> fila
          1 = encabezados; hace falta cantidad y código o descripción. Opcional: precio unitario en el archivo para alinear
          con el presupuesto. Match exacto con el catálogo (código o descripción); la vista previa detalla el resultado.
        </p>
        <div className="budget-io-actions">
          <button type="button" className="btn btn-ghost mono" onClick={() => downloadBudgetLines('xlsx')}>
            Descargar Excel
          </button>
          <button type="button" className="btn btn-ghost mono" onClick={() => downloadBudgetLines('csv')}>
            Descargar CSV
          </button>
          {canWrite && (
            <>
              <input
                ref={budgetImportInputRef}
                type="file"
                className="budget-io-file"
                accept=".xlsx,.xls,.csv"
                onChange={onBudgetImportFile}
                title="Elegir archivo Excel o CSV"
                aria-label="Elegir archivo Excel o CSV para importar"
              />
              <button
                type="button"
                className="btn btn-primary mono"
                disabled={budgetImportBusy}
                onClick={() => budgetImportInputRef.current?.click()}
              >
                {budgetImportBusy && !budgetImportModal ? 'Analizando…' : 'Importar lista…'}
              </button>
            </>
          )}
        </div>
      </div>

      <ProjectWorkNav />

      {err && (
        <div className="banner banner--err mono" style={{ marginBottom: 12 }}>
          {err}
        </div>
      )}

      <div className="budget-infobar mono">
        <span>Total lista: {formatUsd(totals.lista)}</span>
        {!hideItemPrices && (
          <>
            <span className="budget-infobar-sep">|</span>
            <span>Activos: {formatUsd(totals.activos)}</span>
            <span className="budget-infobar-sep">|</span>
            <span>Consumibles: {formatUsd(totals.consumibles)}</span>
          </>
        )}
        <span className="budget-infobar-sep">|</span>
        <span>Ítems: {items.length}</span>
        {project?.quotationMarket && (
          <>
            <span className="budget-infobar-sep">|</span>
            <span>Mercado: {project.quotationMarket === 'INTERNACIONAL' ? 'Internacional' : 'Nacional'}</span>
          </>
        )}
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
              {!hideItemPrices && (
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
              )}
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
            {isCommercial && (
              <div className="budget-catalog-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => navigate('/catalog', { state: { openRequests: 'create' } })}
                >
                  Solicitar ítem
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => navigate('/catalog', { state: { openRequests: 'update' } })}
                >
                  Cambio precio/nombre
                </button>
                <span className="budget-catalog-actions__hint muted mono">Requiere aprobación del admin</span>
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
                      {(it.dependencyCount ?? 0) > 0 && (
                        <span
                          className="budget-badge mono"
                          style={{ borderColor: 'var(--violet)', color: 'var(--violet)' }}
                          title={`${it.dependencyCount} dependencia(s)`}
                        >
                          BOM {it.dependencyCount}
                        </span>
                      )}
                      {it.isKit && (
                        <span
                          className="budget-badge mono"
                          style={{ borderColor: 'var(--green)', color: 'var(--green)' }}
                          title="Producto final (KIT)"
                        >
                          KIT
                        </span>
                      )}
                    </div>
                    <span className="budget-cat-code mono">{it.codigo}</span>
                    <span className="budget-cat-desc">{it.descripcion}</span>
                    <span className="budget-cat-meta mono">
                      {hideItemPrices ? it.unidad : `${formatUsd(it.unitPrice)} / ${it.unidad}`}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <div className="budget-panel budget-panel--table">
          <div className="budget-panel-title-row">
            <h2 className="budget-panel-title">Líneas del presupuesto</h2>
            {items.length > 0 && (
              <input
                type="search"
                className="form-input mono budget-line-search"
                placeholder="Buscar en líneas agregadas…"
                value={budgetLineQ}
                onChange={(e) => setBudgetLineQ(e.target.value)}
                aria-label="Buscar líneas del presupuesto"
              />
            )}
          </div>
          <p className="budget-table-hint mono muted" role="note">
            Filas agrupadas por color según conjunto KIT; componentes con cantidades consolidadas por código. Para
            ver o editar el desglose por sub-grupos, use «Editar conjunto» en la cabecera KIT. Columna Unidad: cyan
            = ACTIVO, ámbar = CONSUMIBLE.
          </p>
          <div className="table-wrap budget-table-wrap zgroup-scroll">
            <table className="data-table data-table--budget">
              <thead>
                <tr>
                  <th className="num budget-col-idx" scope="col" title="N.º de partida">
                    #
                  </th>
                  <th className="budget-th-codigo">Código</th>
                  <th className="budget-th-desc">Descripción</th>
                  <th
                    className="budget-col-meta"
                    scope="col"
                    title="Categoría, tipo y trazabilidad (toca o pasa el cursor)"
                    aria-label="Información de la partida"
                  >
                    <span className="budget-col-meta__hdr mono" aria-hidden="true">
                      i
                    </span>
                  </th>
                  <th>Unidad</th>
                  {!hideItemPrices && (
                    <th className="num" title="Asumido en totales. Si se corrige el precio de lista, arriba queda el ref. tachado.">
                      P. unit.
                    </th>
                  )}
                  <th className="num">Cant.</th>
                  {!hideItemPrices && <th className="num">Subtotal</th>}
                  {showAdjustmentCol && (
                  <th
                    className="budget-col-adj num"
                    scope="col"
                    title="Si está marcado, la línea entra en margen/descuento M1"
                  >
                    Ajuste
                  </th>
                  )}
                  {canEditBudgetLines && (
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
                    <td colSpan={budgetTableColSpan} className="muted">
                      Agregue ítems desde el catálogo o una pieza personalizada.
                    </td>
                  </tr>
                ) : budgetTableItems.length === 0 ? (
                  <tr>
                    <td colSpan={budgetTableColSpan} className="muted">
                      Ninguna línea coincide con la búsqueda.
                    </td>
                  </tr>
                ) : (
                  budgetTableItems.map((row, idx) => {
                    const dr = getDraft(row.id);
                    const catLabel = row.categoryNombre || '—';
                    const nPart = idx + 1;
                    const metaOpen = budgetLineMetaId === row.id;
                    const tip = row.tipo || '—';
                    const metaTitle = `Categoría: ${catLabel} · Tipo: ${tip} · Agregó: ${formatItemTraceUser(row.createdByName, row.createdByEmail)} · Editó: ${formatItemTraceUser(row.updatedByName, row.updatedByEmail)}`;
                    const isComponent = row.isBundleComponent;
                    const isHeader = row.isBundleHeader;
                    const rowQtyEditable = canEditBudgetLines && !isComponent;
                    const rowPriceEditable = canEditUnitPrices && !isComponent && !isHeader;
                    const kitGroup = row.bundleId ? bundleGroupById.get(row.bundleId) : null;
                    const rowGroupClass = kitGroup
                      ? ` budget-row--kit-g${kitGroup}${isHeader ? ' budget-row--kit-header' : isComponent ? ' budget-row--kit-component' : ''}`
                      : ' budget-row--standalone';
                    const unidadTipoClass =
                      row.tipo === 'CONSUMIBLE'
                        ? ' budget-td-unidad--consumible'
                        : ' budget-td-unidad--activo';
                    return (
                      <tr
                        key={row.kitConsolidated ? `c-${row.bundleId}-${row.catalogItemId}` : row.id}
                        className={(deletingId === row.id ? 'budget-row-deleting' : '') + rowGroupClass}
                      >
                        <td className="num mono budget-col-idx" title={`Partida ${nPart}`}>
                          {isComponent ? '↳' : nPart}
                        </td>
                        <td className="mono budget-td-codigo">{row.codigo}</td>
                        <td className={`budget-td-desc${isHeader ? ' budget-td-desc--kit-header' : ''}`}>
                          {isHeader && (
                            <span className="tag tag--ok" style={{ marginRight: 6, fontSize: 9 }}>
                              KIT
                            </span>
                          )}
                          {isHeader && canEditBudgetLines ? (
                            <button
                              type="button"
                              className="budget-kit-name-btn"
                              disabled={kitAddBusy}
                              title="Editar conjunto"
                              aria-label={`Editar conjunto ${row.descripcion}`}
                              onClick={() => openEditKitBundle(row)}
                            >
                              {row.descripcion}
                            </button>
                          ) : (
                            row.descripcion
                          )}
                        </td>
                        <td className="budget-col-meta">
                          <div className="budget-line-meta">
                            <button
                              type="button"
                              className="budget-line-meta__btn"
                              title={metaTitle}
                              aria-label={metaTitle}
                              aria-haspopup="dialog"
                              aria-expanded={metaOpen}
                              onClick={() =>
                                setBudgetLineMetaId((id) => (id === row.id ? null : row.id))
                              }
                            >
                              <svg
                                className="budget-line-meta__icon"
                                width="18"
                                height="18"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-hidden="true"
                              >
                                <circle cx="12" cy="12" r="9" opacity="0.35" />
                                <path d="M12 10v4M12 8h.01" />
                              </svg>
                            </button>
                            {metaOpen &&
                              createPortal(
                                <div
                                  className="budget-line-meta__backdrop"
                                  role="presentation"
                                  onClick={() => setBudgetLineMetaId(null)}
                                >
                                  <div
                                    className="budget-line-meta__modal"
                                    role="dialog"
                                    aria-label="Información de la partida"
                                    tabIndex={-1}
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <p className="budget-line-meta__line">
                                      <span className="budget-line-meta__k">Categoría</span>
                                      <span className="mono budget-line-meta__v">{catLabel}</span>
                                    </p>
                                    <p className="budget-line-meta__line">
                                      <span className="budget-line-meta__k">Tipo</span>
                                      <span className="mono budget-line-meta__v">{tip}</span>
                                    </p>
                                    <p className="budget-line-meta__line">
                                      <span className="budget-line-meta__k">Agregó</span>
                                      <span className="mono budget-line-meta__v">
                                        {formatItemTraceUser(row.createdByName, row.createdByEmail)}
                                      </span>
                                    </p>
                                    <p className="budget-line-meta__line">
                                      <span className="budget-line-meta__k">Últ. edición</span>
                                      <span className="mono budget-line-meta__v">
                                        {formatItemTraceUser(row.updatedByName, row.updatedByEmail)}
                                      </span>
                                    </p>
                                    {row.updatedAt && (
                                      <p className="budget-line-meta__line">
                                        <span className="budget-line-meta__k">Fecha edición</span>
                                        <span className="mono budget-line-meta__v">
                                          {new Date(row.updatedAt).toLocaleString('es-PE')}
                                        </span>
                                      </p>
                                    )}
                                    <button
                                      type="button"
                                      className="btn btn-primary budget-line-meta__dismiss"
                                      onClick={() => setBudgetLineMetaId(null)}
                                    >
                                      Cerrar
                                    </button>
                                  </div>
                                </div>,
                                document.body
                              )}
                          </div>
                        </td>
                        <td className={`mono budget-td-unidad${unidadTipoClass}`}>{row.unidad}</td>
                        {!hideItemPrices && (
                          <td className="num budget-td-punit">
                            {(() => {
                              const cur = rowPriceEditable
                                ? parsePriceDraft(dr.unitPrice) ?? Number(row.unitPrice)
                                : Number(row.unitPrice);
                              const showListRef =
                                row.officialUnitPrice != null && unitPricesDiffer(row.officialUnitPrice, cur);
                              return (
                                <>
                                  {showListRef && (
                                    <div
                                      className="budget-punit-official mono"
                                      title="Precio de lista / referencia (catálogo o valor inicial al crear la línea)"
                                    >
                                      {formatUsd(row.officialUnitPrice)}
                                    </div>
                                  )}
                                  {rowPriceEditable ? (
                                    <input
                                      className="form-input table-input mono"
                                      value={dr.unitPrice}
                                      aria-label={showListRef ? 'Precio unitario asumido' : 'Precio unitario'}
                                      onChange={(e) => setDraft(row.id, 'unitPrice', e.target.value)}
                                    />
                                  ) : (
                                    <span
                                      className="budget-punit-shown mono"
                                      title={isHeader ? 'Precio del conjunto (clic en el nombre o icono de edición)' : undefined}
                                    >
                                      {formatUsd(row.unitPrice)}
                                    </span>
                                  )}
                                </>
                              );
                            })()}
                          </td>
                        )}
                        <td className="num">
                          {rowQtyEditable ? (
                            <input
                              className="form-input table-input mono"
                              value={dr.qty}
                              onChange={(e) => setDraft(row.id, 'qty', e.target.value)}
                            />
                          ) : (
                            row.qty
                          )}
                        </td>
                        {!hideItemPrices && (
                          <td className="num mono">
                            {isComponent ? (
                              <span className="muted" title="Incluido en el total del conjunto">
                                {formatUsd(Number(row.qty) * Number(row.unitPrice))}
                              </span>
                            ) : (
                              formatUsd(row.subtotal)
                            )}
                          </td>
                        )}
                        {showAdjustmentCol && (
                        <td className="num budget-col-adj">
                          {isComponent ? (
                            <span className="muted">—</span>
                          ) : (
                          <label
                            className="budget-adj-chk mono"
                            title={
                              row.applyAdjustment !== false
                                ? 'Incluida en margen/descuento M1'
                                : 'Exenta de margen/descuento M1'
                            }
                          >
                            <input
                              type="checkbox"
                              checked={row.applyAdjustment !== false}
                              disabled={!canEditBudgetLines}
                              onChange={(e) => toggleApplyAdjustment(row.id, e.target.checked)}
                              aria-label={`Ajuste partida ${row.codigo || nPart}`}
                            />
                          </label>
                          )}
                        </td>
                        )}
                        {canEditBudgetLines && (
                          <td className="actions-cell budget-actions-cell">
                            {isHeader && (
                              <button
                                type="button"
                                className="budget-row-edit-kit"
                                title="Editar componentes del conjunto"
                                aria-label={`Editar conjunto ${row.descripcion}`}
                                disabled={kitAddBusy}
                                onClick={() => openEditKitBundle(row)}
                              >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                  <path
                                    d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                  />
                                  <path
                                    d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4 9.5-9.5z"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </svg>
                              </button>
                            )}
                            {!isComponent && (
                            <button
                              type="button"
                              className="budget-row-remove"
                              title={isHeader ? 'Quitar conjunto completo' : 'Quitar esta línea del presupuesto'}
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
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <footer className="budget-footer budget-footer--stacked mono">
            <div className="budget-footer__line">
              <span className="budget-footer__partidas">
                Partidas:{' '}
                <span className="mono budget-footer__partidas-num">
                  {budgetLineQ.trim()
                    ? `${budgetTableItems.length} / ${items.length}`
                    : budgetTableItems.length}
                </span>
              </span>
            </div>
            {items.length > 0 && (
              <div className="budget-footer__line budget-footer__codes muted" aria-label="Listado de ítems">
                {budgetTableItems
                  .slice(0, 30)
                  .map((row, i) => `#${i + 1} ${(row.codigo || '—').trim() || '—'}`)
                  .join(' · ')}
                {budgetTableItems.length > 30
                  ? ` · … (+${budgetTableItems.length - 30} más)`
                  : ''}
              </div>
            )}
            <div className="budget-footer__line budget-footer__totals">
              {!hideItemPrices && (
                <>
                  <span>ACTIVOS: {formatUsd(totals.activos)}</span>
                  <span>CONSUMIBLES: {formatUsd(totals.consumibles)}</span>
                  {totals.listaExempt > 0 && (
                    <span className="muted">
                      Sin ajuste M1: {formatUsd(totals.listaExempt)}
                    </span>
                  )}
                </>
              )}
              <span className="budget-footer-total">TOTAL LISTA: {formatUsd(totals.lista)}</span>
            </div>
          </footer>
        </div>
      </div>
        </div>

        <aside className="budget-fin-sidebar" aria-label="Módulos financieros">
      {showFinancePanel && (
      <FinanceModules
        baseLista={totals.lista}
        baseActivos={totals.activos}
        baseConsumibles={totals.consumibles}
        baseListaAdj={totals.listaAdj}
        baseListaExempt={totals.listaExempt}
        baseActivosAdj={totals.activosAdj}
        baseActivosExempt={totals.activosExempt}
        baseConsumiblesAdj={totals.consumiblesAdj}
        baseConsumiblesExempt={totals.consumiblesExempt}
        financeParams={financeParams}
        onFinanceParamsChange={setFinanceParams}
        viewerMode={viewerMode}
        commercialModules={commercialModules}
        tc={project?.tc != null ? Number(project.tc) : 3.75}
        onTcChange={canWrite && !hideItemPrices ? handleTcChange : undefined}
        finPanelClassName="zgroup-scroll"
      />
      )}
        </aside>
      </div>

      {canWrite && (
        <div className="panel budget-export-panel">
          <div className="panel-hdr">
            <span className="panel-title">{hideItemPrices ? 'Reporte para cliente (PDF)' : 'Exportar PDF'}</span>
          </div>
          <p className="muted mono" style={{ fontSize: 12, lineHeight: 1.5 }}>
            {hideItemPrices ? (
              <>
                PDF para el cliente: partidas sin precios unitarios y resumen financiero solo de los módulos con
                «Vista comercial» activa (montos y plazos, sin fórmulas ni datos internos).
              </>
            ) : (
              <>
                <strong>Gerencia PDF</strong>: presupuesto, M1–M4 + panel M5 (CP vs LP).{' '}
                <strong>Cliente PDF</strong>: portada y totales por modalidad sin datos internos (ROA, spreads).
                <br />
                El bloque <strong>M5 · Panel gerencial</strong> en la sección de arriba muestra los mismos datos
                que irán al PDF Gerencia (ajusta el horizonte en meses antes de exportar).
              </>
            )}
          </p>
          {!hideItemPrices && (
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
          )}
          <div className="pdf-export-actions">
            <div className="pdf-export-actions__row">
              <span className="fg-lbl" style={{ width: '100%', marginBottom: 4 }}>
                {hideItemPrices ? 'Vista previa del reporte cliente' : 'Vista previa (mismo HTML que el PDF)'}
              </span>
              {!hideItemPrices && (
                <button
                  type="button"
                  className="btn btn-primary mono"
                  disabled={!!pdfPreviewLoading}
                  onClick={() => setPdfPreviewKind('GERENCIA')}
                >
                  Ver Gerencia
                </button>
              )}
              <button
                type="button"
                className="btn btn-primary mono"
                disabled={!!pdfPreviewLoading}
                onClick={() => setPdfPreviewKind('CLIENTE')}
              >
                {hideItemPrices ? 'Vista previa' : 'Ver Cliente'}
              </button>
            </div>
            <div className="pdf-export-actions__row" style={{ marginTop: 10 }}>
              {!hideItemPrices && (
                <button
                  type="button"
                  className="btn btn-ghost mono"
                  disabled={pdfBusy}
                  onClick={() => startPdf('GERENCIA')}
                >
                  Descargar PDF Gerencia
                </button>
              )}
              <button
                type="button"
                className={`btn mono${hideItemPrices ? ' btn-primary' : ' btn-ghost'}`}
                disabled={pdfBusy}
                onClick={() => startPdf('CLIENTE')}
              >
                {hideItemPrices ? 'Descargar PDF Cliente' : 'Descargar PDF Cliente'}
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
          title={hideItemPrices ? 'Vista previa — reporte cliente' : 'Vista previa del reporte PDF'}
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
                  const k = hideItemPrices ? 'CLIENTE' : pdfPreviewKind;
                  setPdfPreviewKind(null);
                  startPdf(k);
                }}
              >
                Descargar {hideItemPrices || pdfPreviewKind === 'CLIENTE' ? 'Cliente' : 'Gerencia'}
              </button>
            </>
          }
        >
          <p className="pdf-preview-hint">
            {hideItemPrices ? (
              <>Resumen para el cliente: partidas sin precios unitarios y modalidades financieras habilitadas (solo montos).</>
            ) : (
              <>
                Misma composición que el PDF generado (tipografía y márgenes del servidor pueden variar ligeramente al
                imprimir). Use las pestañas para comparar informes.
              </>
            )}
          </p>
          <div className="pdf-preview-toolbar">
            {!hideItemPrices && (
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
            )}
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

      {modal === 'newProject' && canWrite && (
        <Modal
          title="Nuevo proyecto"
          wide
          onClose={() => !newProjectBusy && setModal(null)}
          footer={
            <>
              <button type="button" className="btn btn-ghost" disabled={newProjectBusy} onClick={() => setModal(null)}>
                Cancelar
              </button>
              <button type="submit" form="budget-new-project-form" className="btn btn-primary" disabled={newProjectBusy}>
                {newProjectBusy ? 'Creando…' : 'Crear y abrir presupuesto'}
              </button>
            </>
          }
        >
          <form id="budget-new-project-form" className="stack-form" onSubmit={submitNewProject}>
            <label>
              <span className="fg-lbl">Nombre del proyecto *</span>
              <input
                className="form-input"
                required
                value={newProjectForm.nombre}
                onChange={(e) => setNewProjectForm((f) => ({ ...f, nombre: e.target.value }))}
              />
            </label>
            <label>
              <span className="fg-lbl">Referencia Odoo (opcional)</span>
              <input
                className="form-input mono"
                value={newProjectForm.odooRef}
                onChange={(e) => setNewProjectForm((f) => ({ ...f, odooRef: e.target.value }))}
              />
            </label>
            <label>
              <span className="fg-lbl">Cliente (opcional)</span>
              <ClientPicker
                clients={clientsList}
                value={newProjectForm.clientId}
                onChange={(clientId) => setNewProjectForm((f) => ({ ...f, clientId }))}
                onClientsChange={setClientsList}
                canCreate={canWrite}
                optional
              />
            </label>
          </form>
        </Modal>
      )}

      {modal === 'editProject' && project?.canEditMetadata && (
        <Modal
          title="Editar proyecto"
          wide
          onClose={() => !editProjectBusy && setModal(null)}
          footer={
            <>
              <button type="button" className="btn btn-ghost" disabled={editProjectBusy} onClick={() => setModal(null)}>
                Cancelar
              </button>
              <button type="submit" form="budget-edit-project-form" className="btn btn-primary" disabled={editProjectBusy}>
                {editProjectBusy ? 'Guardando…' : 'Guardar cambios'}
              </button>
            </>
          }
        >
          <form id="budget-edit-project-form" className="stack-form" onSubmit={submitEditProject}>
            <label>
              <span className="fg-lbl">Nombre del proyecto *</span>
              <input
                className="form-input"
                required
                value={editProjectForm.nombre}
                onChange={(e) => setEditProjectForm((f) => ({ ...f, nombre: e.target.value }))}
              />
            </label>
            <label>
              <span className="fg-lbl">Referencia Odoo (opcional)</span>
              <input
                className="form-input mono"
                value={editProjectForm.odooRef}
                onChange={(e) => setEditProjectForm((f) => ({ ...f, odooRef: e.target.value }))}
              />
            </label>
            <label>
              <span className="fg-lbl">Cliente (opcional)</span>
              <ClientPicker
                clients={clientsList}
                value={editProjectForm.clientId}
                onChange={(clientId) => setEditProjectForm((f) => ({ ...f, clientId }))}
                onClientsChange={setClientsList}
                canCreate={isAdmin}
                optional
              />
            </label>
          </form>
        </Modal>
      )}

      {modal === 'duplicateProject' && canWrite && (
        <Modal
          title="Duplicar proyecto (variante)"
          wide
          onClose={() => !dupBusy && setModal(null)}
          footer={
            <>
              <button type="button" className="btn btn-ghost" disabled={dupBusy} onClick={() => setModal(null)}>
                Cancelar
              </button>
              <button type="submit" form="budget-dup-project-form" className="btn btn-primary" disabled={dupBusy}>
                {dupBusy ? 'Duplicando…' : 'Crear copia'}
              </button>
            </>
          }
        >
          <p className="muted mono" style={{ fontSize: 12, marginBottom: 12 }}>
            Se crea un proyecto en <strong>BORRADOR</strong> con los mismos parámetros financieros. Elija el cliente
            destino (puede ser otro) y qué partidas copiar.
          </p>
          <form id="budget-dup-project-form" className="stack-form" onSubmit={submitDuplicateProject}>
            <label>
              <span className="fg-lbl">Nombre del nuevo proyecto *</span>
              <input
                className="form-input"
                required
                value={dupNombre}
                onChange={(e) => setDupNombre(e.target.value)}
              />
            </label>
            <label>
              <span className="fg-lbl">Cliente del nuevo proyecto</span>
              <ClientPicker
                clients={clientsList}
                value={dupClientId}
                onChange={setDupClientId}
                onClientsChange={setClientsList}
                canCreate={canWrite}
                optional
              />
            </label>
            <div className="chk-row" style={{ marginBottom: 8 }}>
              <label className="chk mono" style={{ fontSize: 12 }}>
                <input
                  type="radio"
                  name="dup-items"
                  checked={dupAllItems}
                  onChange={() => setDupAllItems(true)}
                />
                Todas las partidas ({items.length})
              </label>
              <label className="chk mono" style={{ fontSize: 12 }}>
                <input
                  type="radio"
                  name="dup-items"
                  checked={!dupAllItems}
                  onChange={() => setDupAllItems(false)}
                />
                Solo algunas
              </label>
            </div>
            {!dupAllItems && (
              <div className="budget-dup-items zgroup-scroll">
                {items.length === 0 ? (
                  <p className="muted mono">No hay partidas en este proyecto.</p>
                ) : (
                  items.map((row) => (
                    <label key={row.id} className="budget-dup-item chk-row">
                      <input
                        type="checkbox"
                        checked={dupItemIds.has(row.id)}
                        onChange={() => toggleDupItem(row.id)}
                      />
                      <span className="mono" style={{ fontSize: 12 }}>
                        {row.codigo} — {row.descripcion}
                      </span>
                    </label>
                  ))
                )}
              </div>
            )}
          </form>
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
              <span className="fg-lbl">Prefijo código (ej. SF)</span>
              <input
                className="form-input mono"
                placeholder="SF"
                maxLength={12}
                value={catForm.codigoPrefix}
                onChange={(e) =>
                  setCatForm((f) => ({ ...f, codigoPrefix: e.target.value.toUpperCase().replace(/\s/g, '') }))
                }
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
                onChange={(e) => onBudgetItemCategoryChange(e.target.value)}
              >
                <option value="">—</option>
                {sortedCats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                    {c.codigoPrefix ? ` (${c.codigoPrefix}-)` : ''}
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
                onChange={(e) => setItemForm((f) => ({ ...f, codigo: e.target.value.toUpperCase() }))}
              />
              {itemCodigoHint?.prefix && (
                <span className="muted mono" style={{ fontSize: 11 }}>
                  Formato {itemCodigoHint.prefix}-####. Mínimo sugerido: {itemCodigoHint.minCodigo}.
                </span>
              )}
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
              <MeasureUnitSelect
                value={itemForm.unidad}
                onChange={(v) => setItemForm((f) => ({ ...f, unidad: v }))}
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

      {budgetImportModal && budgetImportPreview && (
        <Modal
          title="Vista previa de importación"
          onClose={() => {
            setBudgetImportModal(false);
            setBudgetImportPreview(null);
          }}
          footer={
            <>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setBudgetImportModal(false);
                  setBudgetImportPreview(null);
                }}
              >
                Cerrar
              </button>
              <button
                type="button"
                className="btn btn-primary mono"
                disabled={budgetImportBusy || (budgetImportPreview.summary?.aplicables ?? 0) < 1}
                onClick={applyBudgetImport}
              >
                {budgetImportBusy ? 'Aplicando…' : 'Añadir al presupuesto'}
              </button>
            </>
          }
        >
          {budgetImportPreview.summary && (
            <p className="mono muted" style={{ marginBottom: 12, fontSize: 12, lineHeight: 1.5 }}>
              Total filas: {budgetImportPreview.summary.total} · match por código:{' '}
              {budgetImportPreview.summary.byCodigo} · por descripción: {budgetImportPreview.summary.byDescripcion} ·
              sin coincidencia: {budgetImportPreview.summary.noMatch} · ambiguas: {budgetImportPreview.summary.ambiguous} ·
              error formato: {budgetImportPreview.summary.parse} · listas para agregar: {budgetImportPreview.summary.aplicables}
            </p>
          )}
          {budgetImportPreview.hint && (
            <p className="mono" style={{ fontSize: 11, color: 'var(--amber)', marginBottom: 10 }}>
              {budgetImportPreview.hint}
            </p>
          )}
          <div className="zgroup-scroll" style={{ maxHeight: 380 }}>
            <table className="data-table data-table--compact">
              <thead>
                <tr>
                  <th className="num">#</th>
                  <th>Cód. archivo</th>
                  <th>Descripción archivo</th>
                  <th className="num">Cant.</th>
                  <th>Resultado</th>
                  <th>Catálogo (si aplica)</th>
                </tr>
              </thead>
              <tbody>
                {budgetImportPreview.results.map((r, idx) => {
                  const tag =
                    r.matchType === 'codigo'
                      ? { cls: 'budget-import-tag--ok', t: 'Código' }
                      : r.matchType === 'descripcion'
                        ? { cls: 'budget-import-tag--d', t: 'Descripción' }
                        : r.matchType === 'ambiguous'
                          ? { cls: 'budget-import-tag--wa', t: 'Ambiguo' }
                          : r.matchType === 'parse'
                            ? { cls: 'budget-import-tag--err', t: 'Error fila' }
                            : { cls: 'budget-import-tag--err', t: 'Sin match' };
                  return (
                    <tr key={`${r.rowIndex}-${idx}`}>
                      <td className="num mono">{r.rowIndex}</td>
                      <td className="mono">{r.inputCodigo || '—'}</td>
                      <td>{r.inputDescripcion || '—'}</td>
                      <td className="num mono">{r.qty != null ? r.qty : '—'}</td>
                      <td>
                        <span className={`budget-import-tag ${tag.cls}`}>{tag.t}</span>
                        <span className="muted mono" style={{ fontSize: 11, display: 'block', marginTop: 2 }}>
                          {r.message}
                        </span>
                      </td>
                      <td className="mono" style={{ fontSize: 11 }}>
                        {r.catalogItem
                          ? `${r.catalogItem.codigo} — ${(r.catalogItem.descripcion || '').slice(0, 60)}${
                              (r.catalogItem.descripcion || '').length > 60 ? '…' : ''
                            }`
                          : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Modal>
      )}

      <CatalogDependencyAddModal
        open={!!depAddModal}
        bundle={depAddModal?.bundle}
        busy={depAddBusy}
        hidePrices={hideItemPrices}
        onClose={() => !depAddBusy && setDepAddModal(null)}
        onConfirm={confirmDependencyAdd}
      />

      <KitInstanceModal
        open={!!kitModal}
        template={kitModal?.template}
        suggestedLabel={kitModal?.suggestedLabel}
        editMode={!!kitModal?.editMode}
        catalogItems={catItems}
        busy={kitAddBusy}
        hidePrices={hideItemPrices}
        fetchDependencyBundle={(id, qty) =>
          api.get(`/api/catalog/items/${id}/dependency-bundle?qty=${qty}`)
        }
        onClose={() => !kitAddBusy && setKitModal(null)}
        onConfirm={confirmKitAdd}
      />

      {modal === 'clear' && canEditBudgetLines && (
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
              <MeasureUnitSelect
                value={customForm.unidad}
                onChange={(v) => setCustomForm((f) => ({ ...f, unidad: v }))}
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
            {!hideItemPrices && (
              <label>
                <span className="fg-lbl">Precio unitario (USD)</span>
                <input
                  className="form-input mono"
                  required
                  value={customForm.unitPrice}
                  onChange={(e) => setCustomForm((f) => ({ ...f, unitPrice: e.target.value }))}
                />
              </label>
            )}
            {hideItemPrices && (
              <p className="muted mono" style={{ fontSize: 12 }}>
                El precio lo define el administrador; usted solo indica cantidades.
              </p>
            )}
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
