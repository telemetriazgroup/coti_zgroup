import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api, getBlob, postFormData } from '../lib/api';
import { fetchCatalog } from '../lib/catalogApi';
import { clearLocalCatalog } from '../lib/catalogLocalCache';
import { useAuth } from '../context/AuthContext';
import { Modal } from '../components/Modal';
import { CatalogRequestsPanel } from '../components/CatalogRequestsPanel';
import { CatalogHistoryModal } from '../components/CatalogHistoryModal';
import { CatalogPrefixRegularizePanel } from '../components/CatalogPrefixRegularizePanel';
import { fetchCategoryNextCodigo, regularizeCategoryCodigos } from '../lib/catalogCodigoApi';
import { MeasureUnitSelect } from '../components/MeasureUnitSelect';
import { CatalogItemDependenciesEditor } from '../components/CatalogItemDependenciesEditor';

const ISSUE_LABELS = {
  FALTA_CATEGORIA: 'Falta categoría',
  FALTA_CODIGO: 'Falta código',
  FALTA_DESCRIPCION: 'Falta descripción',
  TIPO_INVALIDO: 'Tipo inválido (use ACTIVO o CONSUMIBLE)',
  PRECIO_INVALIDO: 'Precio inválido',
  DUP_CODIGO_LOTE: 'Código repetido en el archivo (misma categoría)',
  DUP_DESC_LOTE: 'Descripción repetida en el archivo',
  CODIGO_EN_BD: 'Código ya existe en esa categoría',
  DESC_EN_BD: 'Descripción ya existe en el catálogo',
  CATEGORIA_NO_EXISTE: 'Categoría no encontrada (créela antes o corrija el nombre)',
};

export function CatalogPage() {
  const location = useLocation();
  const { canManageCatalog, hasRole, isSuperuser, canViewInactiveCatalog } = useAuth();
  const isAdmin = canManageCatalog();
  const isCommercial = hasRole('COMERCIAL');
  const hideCatalogPrices = isCommercial;
  const superuser = isSuperuser();
  const showRequests = isAdmin || isCommercial;

  const [pageView, setPageView] = useState('catalog');
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [fromCache, setFromCache] = useState(false);
  const [categories, setCategories] = useState([]);
  const [items, setItems] = useState([]);
  const [showInactive, setShowInactive] = useState(false);

  const [filterCat, setFilterCat] = useState('');
  const [q, setQ] = useState('');
  const [filterTipo, setFilterTipo] = useState('');

  const [modalCat, setModalCat] = useState(null);
  const [modalItem, setModalItem] = useState(null);
  const [catForm, setCatForm] = useState({
    nombre: '',
    sortOrder: '',
    codigoPrefix: '',
    active: true,
    defaultApplyAdjustment: true,
    isKitCategory: false,
  });
  const [itemForm, setItemForm] = useState({
    categoryId: '',
    codigo: '',
    descripcion: '',
    unidad: 'UND',
    tipo: 'ACTIVO',
    unitPrice: '',
    unitPriceIntl: '',
    hasDualPrice: false,
    sortOrder: '',
    active: true,
    dependencies: [],
  });
  const [itemCodigoHint, setItemCodigoHint] = useState(null);
  const [regularizeBusy, setRegularizeBusy] = useState(false);
  const [pwdConfirm, setPwdConfirm] = useState(null);
  const [pwdValue, setPwdValue] = useState('');
  const [pwdBusy, setPwdBusy] = useState(false);
  const [refreshBusy, setRefreshBusy] = useState(false);

  const [dragId, setDragId] = useState(null);

  const fileInputRef = useRef(null);
  const [importModal, setImportModal] = useState(false);
  const [importPreview, setImportPreview] = useState(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importApplying, setImportApplying] = useState(false);
  const [requestAutoOpen, setRequestAutoOpen] = useState(null);
  const [historyTarget, setHistoryTarget] = useState(null);

  useEffect(() => {
    const open = location.state?.openRequests;
    if (open === 'create' || open === 'update') {
      setPageView('requests');
      setRequestAutoOpen(open);
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  const load = useCallback(async (opts = {}) => {
    setLoading(true);
    setErr(null);
    try {
      const useFresh = opts.fresh === true || (opts.fresh !== false && showInactive);
      const { data, fromCache: fc } = await fetchCatalog(canViewInactiveCatalog() && showInactive, { fresh: useFresh });
      setCategories(data.categories || []);
      setItems(data.items || []);
      setFromCache(fc);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [isAdmin, showInactive]);

  async function refreshCatalogFromDb() {
    setRefreshBusy(true);
    setErr(null);
    clearLocalCatalog();
    try {
      await api.post('/api/catalog/refresh-cache');
      await load({ fresh: true });
    } catch (e) {
      setErr(e.message);
    } finally {
      setRefreshBusy(false);
    }
  }

  async function regularizeCatalogActive() {
    if (
      !window.confirm(
        'Normaliza el campo active en categorías e ítems (true/false). ¿Continuar?'
      )
    ) {
      return;
    }
    setRefreshBusy(true);
    setErr(null);
    try {
      const data = await api.post('/api/catalog/regularize-active');
      clearLocalCatalog();
      window.alert(data?.message || 'Regularización completada.');
      await load({ fresh: true });
    } catch (e) {
      setErr(e.message);
    } finally {
      setRefreshBusy(false);
    }
  }

  useEffect(() => {
    load();
  }, [load]);

  const loadPendingCount = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const data = await api.get('/api/catalog/requests/pending-count');
      setPendingCount(data?.count ?? 0);
    } catch {
      /* ignore */
    }
  }, [isAdmin]);

  useEffect(() => {
    loadPendingCount();
  }, [loadPendingCount, pageView]);

  useEffect(() => {
    if ((modalItem !== 'new' && modalItem !== 'duplicate') || !itemForm.categoryId) {
      if (modalItem !== 'edit') setItemCodigoHint(null);
      return undefined;
    }
    let cancelled = false;
    fetchCategoryNextCodigo(itemForm.categoryId)
      .then((data) => {
        if (cancelled) return;
        if (data?.suggestedCodigo) {
          setItemForm((f) => ({ ...f, codigo: data.suggestedCodigo }));
          setItemCodigoHint({ minCodigo: data.suggestedCodigo, prefix: data.prefix });
        } else {
          setItemCodigoHint(null);
        }
      })
      .catch(() => {
        if (!cancelled) setItemCodigoHint(null);
      });
    return () => {
      cancelled = true;
    };
  }, [modalItem, itemForm.categoryId]);

  useEffect(() => {
    if (modalItem !== 'edit' || !itemForm.categoryId || !itemForm._id) return;
    let cancelled = false;
    fetchCategoryNextCodigo(itemForm.categoryId)
      .then((data) => {
        if (cancelled || !data?.prefix) return;
        setItemCodigoHint({ minCodigo: data.suggestedCodigo, prefix: data.prefix, edit: true });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [modalItem, itemForm.categoryId, itemForm._id]);

  const catalogTableColSpan = useMemo(() => {
    let n = 6;
    if (!hideCatalogPrices) n += 1;
    if (isAdmin) n += 1;
    return n;
  }, [hideCatalogPrices, isAdmin]);

  const sortedCats = useMemo(
    () => [...categories].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
    [categories]
  );

  const filteredItems = useMemo(() => {
    let list = items;
    if (filterCat) list = list.filter((it) => it.categoryId === filterCat);
    if (filterTipo) list = list.filter((it) => it.tipo === filterTipo);
    const qq = q.trim().toLowerCase();
    if (qq) {
      list = list.filter(
        (it) =>
          (it.codigo && it.codigo.toLowerCase().includes(qq)) ||
          (it.descripcion && it.descripcion.toLowerCase().includes(qq))
      );
    }
    return list;
  }, [items, filterCat, q, filterTipo]);

  function openNewCategory() {
    setCatForm({
      nombre: '',
      sortOrder: '',
      codigoPrefix: '',
      active: true,
      defaultApplyAdjustment: true,
      isKitCategory: false,
    });
    setModalCat('new');
  }

  function openEditCategory(c) {
    setCatForm({
      nombre: c.nombre,
      sortOrder: String(c.sortOrder ?? 0),
      codigoPrefix: c.codigoPrefix || '',
      active: c.active,
      defaultApplyAdjustment: c.defaultApplyAdjustment !== false,
      isKitCategory: c.isKitCategory === true,
      _id: c.id,
    });
    setModalCat('edit');
  }

  function isOtrosCategory(c) {
    return String(c?.nombre || '')
      .trim()
      .toUpperCase() === 'OTROS';
  }

  async function persistCategory(body, confirmPassword) {
    const payload = confirmPassword ? { ...body, confirmPassword } : body;
    if (modalCat === 'new') {
      await api.post('/api/catalog/categories', payload);
    } else {
      const data = await api.put(`/api/catalog/categories/${catForm._id}`, payload);
      if (data?.deactivateMessage) {
        window.alert(data.deactivateMessage);
      }
    }
    setModalCat(null);
    setPwdConfirm(null);
    setPwdValue('');
    load();
  }

  async function saveCategory(e) {
    e.preventDefault();
    setErr(null);
    const body = {
      nombre: catForm.nombre.trim(),
      sortOrder: catForm.sortOrder === '' ? undefined : parseInt(catForm.sortOrder, 10),
      codigoPrefix: catForm.codigoPrefix.trim() || null,
      active: catForm.active,
      defaultApplyAdjustment: catForm.defaultApplyAdjustment !== false,
      isKitCategory: catForm.isKitCategory === true,
    };
    const orig = categories.find((c) => c.id === catForm._id);
    const willDeactivate =
      modalCat === 'edit' && orig?.active !== false && body.active === false && !isOtrosCategory(orig);

    if (willDeactivate) {
      setPwdConfirm({
        title: 'Desactivar categoría',
        message: `Al desactivar «${orig?.nombre}», sus ítems se reasignarán a la categoría OTROS. No se eliminarán. Confirme con su contraseña.`,
        onConfirm: (password) => persistCategory(body, password),
      });
      setPwdValue('');
      return;
    }

    try {
      await persistCategory(body);
    } catch (e2) {
      setErr(e2.message);
    }
  }

  async function onRegularizeCategory() {
    if (!catForm._id || regularizeBusy) return;
    setRegularizeBusy(true);
    setErr(null);
    try {
      const data = await regularizeCategoryCodigos(catForm._id);
      window.alert(`Correlativo actualizado. Próximo código sugerido: ${data.suggestedCodigo || '—'}`);
      load();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setRegularizeBusy(false);
    }
  }

  async function onItemCategoryChange(categoryId) {
    setItemForm((f) => ({ ...f, categoryId }));
    if (modalItem !== 'new' && modalItem !== 'duplicate') return;
    try {
      const data = await fetchCategoryNextCodigo(categoryId);
      if (data?.suggestedCodigo) {
        setItemForm((f) => ({ ...f, categoryId, codigo: data.suggestedCodigo }));
        setItemCodigoHint({ minCodigo: data.suggestedCodigo, prefix: data.prefix });
      }
    } catch {
      /* ignore */
    }
  }

  async function deactivateCategory(c) {
    if (isOtrosCategory(c)) {
      setErr('La categoría OTROS no puede desactivarse.');
      return;
    }
    setPwdConfirm({
      title: `Desactivar «${c.nombre}»`,
      message:
        'Los ítems de esta categoría pasarán a OTROS (permanecen activos en el catálogo). Confirme con su contraseña.',
      onConfirm: async (password) => {
        const data = await api.post(`/api/catalog/categories/${c.id}/deactivate`, {
          confirmPassword: password,
        });
        if (data?.message) window.alert(data.message);
      },
    });
    setPwdValue('');
  }

  async function submitPwdConfirm(e) {
    e.preventDefault();
    if (!pwdConfirm?.onConfirm || !pwdValue.trim()) return;
    setPwdBusy(true);
    setErr(null);
    try {
      await pwdConfirm.onConfirm(pwdValue);
      setPwdConfirm(null);
      setPwdValue('');
      load();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setPwdBusy(false);
    }
  }

  async function onDropCategory(targetId) {
    if (!dragId || dragId === targetId || !isAdmin) return;
    const order = [...sortedCats];
    const from = order.findIndex((c) => c.id === dragId);
    const to = order.findIndex((c) => c.id === targetId);
    if (from < 0 || to < 0) return;
    const next = [...order];
    const [removed] = next.splice(from, 1);
    next.splice(to, 0, removed);
    setErr(null);
    try {
      await api.patch('/api/catalog/categories/reorder', {
        orderedIds: next.map((c) => c.id),
      });
      load();
    } catch (e2) {
      setErr(e2.message);
    }
    setDragId(null);
  }

  function openNewItem() {
    const firstCat = sortedCats[0]?.id || '';
    setItemForm({
      categoryId: filterCat || firstCat,
      codigo: '',
      descripcion: '',
      unidad: 'UND',
      tipo: 'ACTIVO',
      unitPrice: '',
      unitPriceIntl: '',
      hasDualPrice: false,
      sortOrder: '',
      active: true,
      dependencies: [],
    });
    setModalItem('new');
    setItemCodigoHint(null);
  }

  async function openDuplicateItem(row) {
    setItemForm({
      categoryId: row.categoryId,
      codigo: '',
      descripcion: `${String(row.descripcion || '').trim()} (copia)`,
      unidad: row.unidad || 'UND',
      tipo: row.tipo,
      unitPrice: String(row.unitPrice ?? 0),
      unitPriceIntl: row.unitPriceIntl != null ? String(row.unitPriceIntl) : String(row.unitPrice ?? 0),
      hasDualPrice: row.hasDualPrice === true,
      sortOrder: '',
      active: true,
      dependencies: [],
    });
    setModalItem('duplicate');
    setItemCodigoHint(null);
    try {
      const data = await api.get(`/api/catalog/items/${row.id}/dependencies`);
      setItemForm((f) => ({
        ...f,
        dependencies: (data.dependencies || []).map((d) => ({
          childItemId: d.childItemId,
          qty: String(d.qty ?? 1),
        })),
      }));
    } catch {
      /* sin deps: se crea el ítem suelto */
    }
  }

  async function openEditItem(row) {
    setItemForm({
      categoryId: row.categoryId,
      codigo: row.codigo,
      descripcion: row.descripcion,
      unidad: row.unidad || 'UND',
      tipo: row.tipo,
      unitPrice: String(row.unitPrice ?? 0),
      unitPriceIntl: row.unitPriceIntl != null ? String(row.unitPriceIntl) : String(row.unitPrice ?? 0),
      hasDualPrice: row.hasDualPrice === true,
      sortOrder: String(row.sortOrder ?? 0),
      active: row.active,
      _id: row.id,
      dependencies: [],
    });
    setModalItem('edit');
    setItemCodigoHint(null);
    try {
      const data = await api.get(`/api/catalog/items/${row.id}/dependencies`);
      setItemForm((f) => ({
        ...f,
        dependencies: (data.dependencies || []).map((d) => ({
          childItemId: d.childItemId,
          qty: String(d.qty ?? 1),
        })),
      }));
    } catch {
      /* sin deps */
    }
  }

  async function saveItem(e) {
    e.preventDefault();
    setErr(null);
    const cat = categories.find((c) => c.id === itemForm.categoryId);
    const isKit = cat?.isKitCategory === true;
    const deps = (itemForm.dependencies || [])
      .filter((d) => d.childItemId)
      .map((d) => ({
        childItemId: d.childItemId,
        qty: parseFloat(String(d.qty).replace(',', '.')) || 1,
      }));
    if (isKit && deps.length < 1) {
      setErr('Un producto final (KIT) debe tener al menos un componente.');
      return;
    }
    let unitPrice = 0;
    if (!isKit) {
      unitPrice = parseFloat(String(itemForm.unitPrice).replace(',', '.'));
      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        setErr('Precio inválido');
        return;
      }
    } else {
      unitPrice = deps.reduce((s, d) => {
        const it = items.find((x) => x.id === d.childItemId);
        return s + (Number(d.qty) || 0) * (Number(it?.unitPrice) || 0);
      }, 0);
      unitPrice = Math.round(unitPrice * 100) / 100;
    }
    const body = {
      categoryId: itemForm.categoryId,
      codigo: itemForm.codigo.trim(),
      descripcion: itemForm.descripcion.trim(),
      unidad: itemForm.unidad || 'UND',
      tipo: itemForm.tipo,
      unitPrice,
      hasDualPrice: !isKit && itemForm.hasDualPrice === true,
      unitPriceIntl:
        !isKit && itemForm.hasDualPrice
          ? parseFloat(String(itemForm.unitPriceIntl).replace(',', '.')) || unitPrice
          : undefined,
      sortOrder: itemForm.sortOrder === '' ? undefined : parseInt(itemForm.sortOrder, 10),
      active: itemForm.active,
      dependencies: deps,
    };
    try {
      if (modalItem === 'new' || modalItem === 'duplicate') {
        await api.post('/api/catalog/items', body);
      } else {
        await api.put(`/api/catalog/items/${itemForm._id}`, body);
      }
      setModalItem(null);
      load();
    } catch (e2) {
      setErr(e2.message);
    }
  }

  async function downloadExcel() {
    setErr(null);
    try {
      const qs = isAdmin && showInactive ? '?includeInactive=true' : '';
      const blob = await getBlob(`/api/catalog/export${qs}`);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'zgroup-catalogo.xlsx';
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setErr(e.message);
    }
  }

  async function onImportFile(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setErr(null);
    setImportBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      const data = await postFormData('/api/catalog/import/preview', fd);
      setImportPreview(data);
      setImportModal(true);
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setImportBusy(false);
    }
  }

  async function applyExcelImport() {
    if (!importPreview?.canApply || !importPreview.rows?.length) return;
    setErr(null);
    setImportApplying(true);
    try {
      await api.post('/api/catalog/import/apply', { rows: importPreview.rows });
      setImportModal(false);
      setImportPreview(null);
      load();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setImportApplying(false);
    }
  }

  async function deactivateItem(row) {
    if (!window.confirm(`¿Desactivar ítem "${row.codigo}"?`)) return;
    setErr(null);
    try {
      await api.del(`/api/catalog/items/${row.id}`);
      load();
    } catch (e2) {
      setErr(e2.message);
    }
  }

  return (
    <section className="view-active">
      <div className="page-header page-header--row">
        <div>
          <h1 className="page-title">Catálogo</h1>
          <p className="page-sub muted">
            {pageView === 'requests'
              ? isAdmin
                ? 'Aprobar solicitudes de ítems del equipo comercial'
                : 'Solicitar altas o cambios de nombre/precio en el catálogo'
              : pageView === 'prefixes'
                ? 'Análisis y regularización de prefijos por categoría (solo superusuario)'
                : isAdmin
                  ? 'Administración de categorías e ítems'
                  : 'Consulta de precios y descripciones'}
          </p>
        </div>
        <div className="page-header-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {showRequests && (
            <>
              <button
                type="button"
                className={`btn btn-ghost${pageView === 'catalog' ? ' active' : ''}`}
                onClick={() => setPageView('catalog')}
              >
                Catálogo
              </button>
              <button
                type="button"
                className={`btn btn-ghost${pageView === 'requests' ? ' active' : ''}`}
                onClick={() => setPageView('requests')}
              >
                Solicitudes
                {isAdmin && pendingCount > 0 && (
                  <span className="tag" style={{ marginLeft: 6, borderColor: 'var(--amber)', color: 'var(--amber)' }}>
                    {pendingCount}
                  </span>
                )}
              </button>
              {superuser && (
                <button
                  type="button"
                  className={`btn btn-ghost${pageView === 'prefixes' ? ' active' : ''}`}
                  onClick={() => setPageView('prefixes')}
                >
                  Regularizar prefijos
                </button>
              )}
            </>
          )}
          {canViewInactiveCatalog() && pageView === 'catalog' && (
            <>
              <label className="chk mono" style={{ fontSize: 11 }}>
                <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
                Ver inactivos
              </label>
              <button
                type="button"
                className="btn btn-ghost mono"
                disabled={refreshBusy || loading}
                onClick={refreshCatalogFromDb}
                title="Recarga desde PostgreSQL e invalida caché Redis"
              >
                {refreshBusy ? 'Actualizando…' : 'Actualizar BD'}
              </button>
              <button
                type="button"
                className="btn btn-ghost mono"
                disabled={refreshBusy || loading}
                onClick={regularizeCatalogActive}
                title="Corrige valores active inconsistentes"
              >
                Regularizar activos
              </button>
              <button type="button" className="btn btn-primary" onClick={openNewCategory}>
                Categoría
              </button>
              <button type="button" className="btn btn-primary" onClick={openNewItem}>
                Ítem
              </button>
            </>
          )}
        </div>
      </div>

      {pageView === 'requests' && showRequests ? (
        <CatalogRequestsPanel
          categories={categories}
          catalogItems={items}
          canReview={isAdmin}
          isCommercial={isCommercial}
          autoOpen={requestAutoOpen}
          onAutoOpenHandled={() => setRequestAutoOpen(null)}
          onChanged={() => {
            loadPendingCount();
            load();
          }}
        />
      ) : pageView === 'prefixes' && superuser ? (
        <CatalogPrefixRegularizePanel
          onApplied={() => {
            load();
          }}
        />
      ) : (
        <>
      {fromCache && (
        <div className="banner banner--warning mono" style={{ marginBottom: 12 }}>
          Mostrando datos en caché local (sin conexión o error de red). Los datos pueden estar desactualizados.
        </div>
      )}
      {err && (
        <div className="banner banner--err mono" style={{ marginBottom: 12 }}>
          {err}
        </div>
      )}

      <div className="catalog-excel-actions" style={{ marginBottom: 14 }}>
        <button type="button" className="btn btn-ghost mono" onClick={downloadExcel} disabled={loading}>
          Descargar Excel
        </button>
        {isAdmin && (
          <>
            <button
              type="button"
              className="btn btn-primary"
              disabled={loading || importBusy}
              onClick={() => fileInputRef.current?.click()}
            >
              {importBusy ? 'Leyendo…' : 'Subir Excel…'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              style={{ display: 'none' }}
              onChange={onImportFile}
            />
            <span className="muted mono" style={{ fontSize: 11 }}>
              Plantilla: misma estructura que la exportación. Se validan duplicados de código (por categoría) y de
              descripción.
            </span>
          </>
        )}
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-hdr">
          <span className="panel-title">Categorías</span>
        </div>
        {loading ? (
          <p className="muted mono">Cargando…</p>
        ) : (
          <ul className="cat-reorder-list">
            {sortedCats.map((c) => (
              <li
                key={c.id}
                className={'cat-reorder-row' + (!c.active ? ' row-dim' : '')}
                draggable={isAdmin}
                onDragStart={(e) => {
                  if (!isAdmin) return;
                  setDragId(c.id);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  onDropCategory(c.id);
                }}
                onDragEnd={() => setDragId(null)}
              >
                <span className="cat-drag-hint mono" aria-hidden>
                  ::
                </span>
                <span className="cat-name">{c.nombre}</span>
                {c.codigoPrefix && (
                  <span className="mono" style={{ fontSize: 10, color: 'var(--cyan)' }}>
                    {c.codigoPrefix}-
                  </span>
                )}
                <span className="mono muted" style={{ fontSize: 11 }}>
                  orden {c.sortOrder}
                </span>
                {!c.active && <span className="tag tag--off">inactiva</span>}
                {c.defaultApplyAdjustment === false && (
                  <span className="tag tag--warn mono" title="Las líneas nuevas del presupuesto no aplican margen/descuento M1">
                    sin ajuste M1
                  </span>
                )}
                {isAdmin && (
                  <span className="cat-actions">
                    <button type="button" className="btn-link mono" onClick={() => openEditCategory(c)}>
                      Editar
                    </button>
                    {c.active && !isOtrosCategory(c) && (
                      <button type="button" className="btn-link mono" onClick={() => deactivateCategory(c)}>
                        Desactivar
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn-link mono"
                      onClick={() =>
                        setHistoryTarget({
                          entityType: 'CATEGORY',
                          entityId: c.id,
                          title: `Historial — ${c.nombre}`,
                        })
                      }
                    >
                      Historial
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {isAdmin && <p className="muted mono" style={{ fontSize: 11, marginTop: 8 }}>Arrastra filas para reordenar (escritorio).</p>}
      </div>

      <div className="toolbar">
        <select className="form-input toolbar-filter" value={filterCat} onChange={(e) => setFilterCat(e.target.value)}>
          <option value="">Todas las categorías</option>
          {sortedCats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </select>
        <select className="form-input toolbar-filter" value={filterTipo} onChange={(e) => setFilterTipo(e.target.value)}>
          <option value="">Todos los tipos</option>
          <option value="ACTIVO">ACTIVO</option>
          <option value="CONSUMIBLE">CONSUMIBLE</option>
        </select>
        <input
          type="search"
          className="form-input toolbar-search"
          placeholder="Buscar código o descripción…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <div className="panel panel--flush">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Descripción</th>
                <th>Categoría</th>
                <th>Unidad</th>
                <th>Tipo</th>
                {!hideCatalogPrices && <th className="num">P. unit.</th>}
                <th>Dependencias</th>
                {isAdmin && <th />}
              </tr>
            </thead>
            <tbody>
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={catalogTableColSpan} className="muted">
                    Sin ítems
                  </td>
                </tr>
              ) : (
                filteredItems.map((row) => {
                  const cat = categories.find((c) => c.id === row.categoryId);
                  return (
                    <tr key={row.id} className={!row.active ? 'row-dim' : ''}>
                      <td className="mono">{row.codigo}</td>
                      <td>{row.descripcion}</td>
                      <td>{cat?.nombre || '—'}</td>
                      <td className="mono">{row.unidad}</td>
                      <td>
                        <span
                          className={
                            'tipo-pill ' +
                            (row.tipo === 'CONSUMIBLE' ? 'tipo-pill--consumible' : 'tipo-pill--activo')
                          }
                        >
                          {row.tipo}
                        </span>
                      </td>
                      {!hideCatalogPrices && (
                        <td className="num mono">
                          {Number(row.unitPrice).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </td>
                      )}
                      <td className="mono" style={{ fontSize: 11 }}>
                        {(row.dependencyCount ?? 0) > 0 ? (
                          <span
                            className="tag"
                            style={{ borderColor: 'var(--violet)', color: 'var(--violet)' }}
                            title={`${row.dependencyCount} componente(s) configurado(s)`}
                          >
                            Sí · {row.dependencyCount}
                          </span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      {isAdmin && (
                        <td>
                          <button type="button" className="btn-link mono" onClick={() => openEditItem(row)}>
                            Editar
                          </button>
                          <button type="button" className="btn-link mono" onClick={() => openDuplicateItem(row)}>
                            Duplicar
                          </button>
                          <button
                            type="button"
                            className="btn-link mono"
                            onClick={() =>
                              setHistoryTarget({
                                entityType: 'ITEM',
                                entityId: row.id,
                                title: `Historial — ${row.codigo}`,
                              })
                            }
                          >
                            Historial
                          </button>
                          {row.active && (
                            <button type="button" className="btn-link btn-link--danger mono" onClick={() => deactivateItem(row)}>
                              Desactivar
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
      </div>

      {modalCat && isAdmin && (
        <Modal
          title={modalCat === 'new' ? 'Nueva categoría' : 'Editar categoría'}
          onClose={() => setModalCat(null)}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setModalCat(null)}>
                Cancelar
              </button>
              <button type="submit" form="cat-form" className="btn btn-primary">
                Guardar
              </button>
            </>
          }
        >
          <form id="cat-form" className="stack-form" onSubmit={saveCategory}>
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
              <span className="muted mono" style={{ fontSize: 11 }}>
                Los ítems usarán formato PREFIJO-0001. Puede subir el correlativo, no bajarlo.
              </span>
            </label>
            {modalCat === 'edit' && catForm.codigoPrefix && (
              <div>
                <button
                  type="button"
                  className="btn btn-ghost mono"
                  disabled={regularizeBusy}
                  onClick={onRegularizeCategory}
                >
                  {regularizeBusy ? 'Regularizando…' : 'Regularizar correlativo'}
                </button>
              </div>
            )}
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
                disabled={
                  modalCat === 'edit' &&
                  isOtrosCategory(categories.find((c) => c.id === catForm._id))
                }
                onChange={(e) => setCatForm((f) => ({ ...f, active: e.target.checked }))}
              />
              <span>Activa</span>
            </label>
            {modalCat === 'edit' &&
              isOtrosCategory(categories.find((c) => c.id === catForm._id)) && (
                <p className="muted mono" style={{ fontSize: 11, margin: '-4px 0 0' }}>
                  La categoría OTROS es del sistema y no puede desactivarse.
                </p>
              )}
            <label className="chk-row">
              <input
                type="checkbox"
                checked={catForm.isKitCategory === true}
                onChange={(e) => setCatForm((f) => ({ ...f, isKitCategory: e.target.checked }))}
              />
              <span>Productos finales (KIT)</span>
            </label>
            <p className="muted mono" style={{ fontSize: 11, margin: '-4px 0 0', lineHeight: 1.45 }}>
              Ítems de esta categoría tienen precio calculado por componentes y se agregan al presupuesto como
              conjuntos configurables (instancias).
            </p>
            <label className="chk-row">
              <input
                type="checkbox"
                checked={catForm.defaultApplyAdjustment !== false}
                onChange={(e) =>
                  setCatForm((f) => ({ ...f, defaultApplyAdjustment: e.target.checked }))
                }
              />
              <span>Ajuste M1 activo por defecto</span>
            </label>
            <p className="muted mono" style={{ fontSize: 11, margin: '-4px 0 0', lineHeight: 1.45 }}>
              Si está marcado, al agregar ítems de esta categoría al presupuesto el checkbox «Ajuste» queda ✓
              (entran en margen de seguridad o descuento). Desmarcado = exentos por defecto (el usuario puede
              cambiarlo línea a línea).
            </p>
          </form>
        </Modal>
      )}

      {importModal && importPreview && isAdmin && (
        <Modal
          wide
          title="Previsualización de importación"
          onClose={() => {
            setImportModal(false);
            setImportPreview(null);
          }}
          footer={
            <>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setImportModal(false);
                  setImportPreview(null);
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!importPreview.canApply || importApplying}
                onClick={applyExcelImport}
              >
                {importApplying ? 'Importando…' : 'Confirmar importación'}
              </button>
            </>
          }
        >
          <p className="muted mono" style={{ fontSize: 12, marginBottom: 10 }}>
            Filas: {importPreview.total}.{' '}
            {importPreview.canApply ? (
              <span style={{ color: 'var(--green)' }}>Listo para importar.</span>
            ) : (
              <span style={{ color: 'var(--red)' }}>Corrija el archivo o la categoría y vuelva a subir.</span>
            )}
          </p>
          <div className="table-wrap catalog-import-table-wrap">
            <table className="data-table data-table--compact">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Categoría</th>
                  <th>Código</th>
                  <th>Descripción</th>
                  <th>Unidad</th>
                  <th>Tipo</th>
                  <th className="num">Precio</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {importPreview.rows.map((r) => (
                  <tr key={r.rowIndex} className={r.issues?.length ? 'catalog-import-row--err' : ''}>
                    <td className="mono">{r.rowIndex}</td>
                    <td>{r.categoria}</td>
                    <td className="mono">{r.codigo}</td>
                    <td>{r.descripcion}</td>
                    <td className="mono">{r.unidad}</td>
                    <td className="mono">{r.tipo}</td>
                    <td className="num mono">{r.precio}</td>
                    <td className="mono" style={{ fontSize: 10, lineHeight: 1.35 }}>
                      {r.issues?.length ? (
                        r.issues.map((code) => (
                          <div key={code} className="catalog-issue-tag" title={code}>
                            {ISSUE_LABELS[code] || code}
                          </div>
                        ))
                      ) : (
                        <span style={{ color: 'var(--green)' }}>OK</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}

      {modalItem && isAdmin && (
        <Modal
          title={modalItem === 'new' ? 'Nuevo ítem' : modalItem === 'duplicate' ? 'Duplicar ítem' : 'Editar ítem'}
          onClose={() => setModalItem(null)}
          lg
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setModalItem(null)}>
                Cancelar
              </button>
              <button type="submit" form="item-form" className="btn btn-primary">
                {modalItem === 'duplicate' ? 'Crear copia' : 'Guardar'}
              </button>
            </>
          }
        >
          <form id="item-form" className="stack-form" onSubmit={saveItem}>
            <label>
              <span className="fg-lbl">Categoría *</span>
              <select
                className="form-input"
                required
                value={itemForm.categoryId}
                onChange={(e) => onItemCategoryChange(e.target.value)}
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
                onChange={(e) => setItemForm((f) => ({ ...f, codigo: e.target.value.toUpperCase() }))}
              />
              {itemCodigoHint?.prefix && (
                <span className="muted mono" style={{ fontSize: 11 }}>
                  Formato obligatorio {itemCodigoHint.prefix}-####.
                  {itemCodigoHint.minCodigo && (
                    <>
                      {' '}
                      Mínimo: {itemCodigoHint.minCodigo}
                      {itemCodigoHint.edit ? ' (puede usar uno mayor)' : ''}.
                    </>
                  )}
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
              {modalItem === 'duplicate' && (
                <span className="muted mono" style={{ fontSize: 11 }}>
                  Ajuste el nombre (la descripción debe ser única). Se copian los mismos componentes internos; no se
                  clonan los hijos.
                </span>
              )}
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
            {(() => {
              const itemCat = categories.find((c) => c.id === itemForm.categoryId);
              const isKitItem = itemCat?.isKitCategory === true;
              const kitPreview = isKitItem
                ? (itemForm.dependencies || [])
                    .filter((d) => d.childItemId)
                    .reduce((s, d) => {
                      const it = items.find((x) => x.id === d.childItemId);
                      const q = parseFloat(String(d.qty).replace(',', '.')) || 0;
                      return s + q * (Number(it?.unitPrice) || 0);
                    }, 0)
                : 0;
              return (
                <>
            <label>
              <span className="fg-lbl">Precio unitario nacional (USD) {isKitItem ? '— calculado' : '*'}</span>
              {isKitItem ? (
                <div className="form-input mono" style={{ opacity: 0.9 }}>
                  {Number.isFinite(kitPreview) ? kitPreview.toFixed(2) : '0.00'} (suma componentes)
                </div>
              ) : (
              <input
                type="number"
                step="0.01"
                min="0"
                className="form-input mono"
                required
                value={itemForm.unitPrice}
                onChange={(e) => setItemForm((f) => ({ ...f, unitPrice: e.target.value }))}
              />
              )}
            </label>
            {!isKitItem && (
              <>
                <label className="chk-row">
                  <input
                    type="checkbox"
                    checked={!!itemForm.hasDualPrice}
                    onChange={(e) => setItemForm((f) => ({ ...f, hasDualPrice: e.target.checked }))}
                  />
                  <span>Precio internacional distinto al nacional</span>
                </label>
                {itemForm.hasDualPrice && (
                  <label>
                    <span className="fg-lbl">Precio internacional (USD)</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className="form-input mono"
                      value={itemForm.unitPriceIntl}
                      onChange={(e) => setItemForm((f) => ({ ...f, unitPriceIntl: e.target.value }))}
                    />
                  </label>
                )}
              </>
            )}
                </>
              );
            })()}
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
            <CatalogItemDependenciesEditor
              excludeItemId={modalItem === 'edit' ? itemForm._id : null}
              catalogItems={items}
              value={itemForm.dependencies}
              onChange={(dependencies) => setItemForm((f) => ({ ...f, dependencies }))}
            />
          </form>
        </Modal>
      )}
        </>
      )}

      <CatalogHistoryModal
        open={!!historyTarget}
        entityType={historyTarget?.entityType}
        entityId={historyTarget?.entityId}
        title={historyTarget?.title}
        onClose={() => setHistoryTarget(null)}
      />

      {pwdConfirm && (
        <Modal
          title={pwdConfirm.title}
          onClose={() => {
            if (pwdBusy) return;
            setPwdConfirm(null);
            setPwdValue('');
          }}
          footer={
            <>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={pwdBusy}
                onClick={() => {
                  setPwdConfirm(null);
                  setPwdValue('');
                }}
              >
                Cancelar
              </button>
              <button type="submit" form="cat-pwd-form" className="btn btn-primary" disabled={pwdBusy}>
                {pwdBusy ? 'Confirmando…' : 'Confirmar'}
              </button>
            </>
          }
        >
          <form id="cat-pwd-form" className="stack-form" onSubmit={submitPwdConfirm}>
            <p className="mono" style={{ fontSize: 12, lineHeight: 1.5 }}>
              {pwdConfirm.message}
            </p>
            <label>
              <span className="fg-lbl">Su contraseña *</span>
              <input
                type="password"
                className="form-input mono"
                required
                autoComplete="current-password"
                value={pwdValue}
                onChange={(e) => setPwdValue(e.target.value)}
              />
            </label>
          </form>
        </Modal>
      )}
    </section>
  );
}
