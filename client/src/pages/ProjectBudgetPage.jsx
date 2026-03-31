import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { fetchCatalog } from '../lib/catalogApi';
import { useAuth } from '../context/AuthContext';
import { Modal } from '../components/Modal';

const STATUS_LABEL = {
  BORRADOR: 'Borrador',
  EN_SEGUIMIENTO: 'En seguimiento',
  PRESENTADA: 'Presentada',
  ACEPTADA: 'Aceptada',
  RECHAZADA: 'Rechazada',
  EN_NEGOCIACION: 'En negociación',
};

function formatUsd(n) {
  if (n == null || Number.isNaN(n)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

export function ProjectBudgetPage() {
  const { projectId } = useParams();
  const { hasRole } = useAuth();
  const canWrite = hasRole('ADMIN', 'COMERCIAL');

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
    unidad: 'UND',
    tipo: 'ACTIVO',
    unitPrice: '',
    qty: '1',
  });

  const [deletingId, setDeletingId] = useState(null);
  const draftsRef = useRef({});
  const itemsRef = useRef([]);
  const flushTimers = useRef({});

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
            {STATUS_LABEL[projectStatus] || projectStatus} · {items.length} ítems · Lista {formatUsd(totals.lista)}
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
          </div>
          <div className="budget-catalog-list">
            {filteredCatalog.length === 0 ? (
              <p className="muted mono" style={{ padding: 12 }}>
                Sin resultados
              </p>
            ) : (
              filteredCatalog.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  className="budget-cat-item"
                  disabled={!canWrite}
                  onClick={() => addFromCatalog(it)}
                >
                  <span className="budget-cat-code mono">{it.codigo}</span>
                  <span className="budget-cat-desc">{it.descripcion}</span>
                  <span className="budget-cat-meta mono">
                    {it.tipo} · {formatUsd(it.unitPrice)} / {it.unidad}
                  </span>
                </button>
              ))
            )}
          </div>
        </aside>

        <div className="budget-panel budget-panel--table">
          <h2 className="budget-panel-title">Líneas del presupuesto</h2>
          <div className="table-wrap budget-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Descripción</th>
                  <th>Tipo</th>
                  <th>Unidad</th>
                  <th className="num">P. unit.</th>
                  <th className="num">Cant.</th>
                  <th className="num">Subtotal</th>
                  {canWrite && <th className="actions-col" />}
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={canWrite ? 8 : 7} className="muted">
                      Agregue ítems desde el catálogo o una pieza personalizada.
                    </td>
                  </tr>
                ) : (
                  items.map((row) => {
                    const dr = getDraft(row.id);
                    return (
                      <tr
                        key={row.id}
                        className={deletingId === row.id ? 'budget-row-deleting' : ''}
                      >
                        <td className="mono">{row.codigo}</td>
                        <td>{row.descripcion}</td>
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
                          <td className="actions-cell">
                            <button
                              type="button"
                              className="btn-link btn-link--danger mono"
                              onClick={() => removeItem(row.id)}
                            >
                              Quitar
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
