import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { fetchCatalog } from '../lib/catalogApi';
import { useAuth } from '../context/AuthContext';
import { Modal } from '../components/Modal';

export function CatalogPage() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole('ADMIN');

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

  const [dragId, setDragId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const { data, fromCache: fc } = await fetchCatalog(isAdmin && showInactive);
      setCategories(data.categories || []);
      setItems(data.items || []);
      setFromCache(fc);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [isAdmin, showInactive]);

  useEffect(() => {
    load();
  }, [load]);

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
    setCatForm({ nombre: '', sortOrder: '', active: true });
    setModalCat('new');
  }

  function openEditCategory(c) {
    setCatForm({
      nombre: c.nombre,
      sortOrder: String(c.sortOrder ?? 0),
      active: c.active,
      _id: c.id,
    });
    setModalCat('edit');
  }

  async function saveCategory(e) {
    e.preventDefault();
    setErr(null);
    try {
      const body = {
        nombre: catForm.nombre.trim(),
        sortOrder: catForm.sortOrder === '' ? undefined : parseInt(catForm.sortOrder, 10),
        active: catForm.active,
      };
      if (modalCat === 'new') {
        await api.post('/api/catalog/categories', body);
      } else {
        await api.put(`/api/catalog/categories/${catForm._id}`, body);
      }
      setModalCat(null);
      load();
    } catch (e2) {
      setErr(e2.message);
    }
  }

  async function deactivateCategory(c) {
    if (!window.confirm(`¿Desactivar categoría "${c.nombre}" e ítems asociados?`)) return;
    setErr(null);
    try {
      await api.del(`/api/catalog/categories/${c.id}`);
      load();
    } catch (e2) {
      setErr(e2.message);
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
      sortOrder: '',
      active: true,
    });
    setModalItem('new');
  }

  function openEditItem(row) {
    setItemForm({
      categoryId: row.categoryId,
      codigo: row.codigo,
      descripcion: row.descripcion,
      unidad: row.unidad || 'UND',
      tipo: row.tipo,
      unitPrice: String(row.unitPrice ?? 0),
      sortOrder: String(row.sortOrder ?? 0),
      active: row.active,
      _id: row.id,
    });
    setModalItem('edit');
  }

  async function saveItem(e) {
    e.preventDefault();
    setErr(null);
    const unitPrice = parseFloat(String(itemForm.unitPrice).replace(',', '.'));
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      setErr('Precio inválido');
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
      if (modalItem === 'new') {
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
            {isAdmin ? 'Administración de categorías e ítems' : 'Consulta de precios y descripciones'}
          </p>
        </div>
        {isAdmin && (
          <div className="page-header-actions">
            <label className="chk mono" style={{ fontSize: 11 }}>
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
              Ver inactivos
            </label>
            <button type="button" className="btn btn-primary" onClick={openNewCategory}>
              Categoría
            </button>
            <button type="button" className="btn btn-primary" onClick={openNewItem}>
              Ítem
            </button>
          </div>
        )}
      </div>

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
                <span className="mono muted" style={{ fontSize: 11 }}>
                  orden {c.sortOrder}
                </span>
                {!c.active && <span className="tag tag--off">inactiva</span>}
                {isAdmin && (
                  <span className="cat-actions">
                    <button type="button" className="btn-link mono" onClick={() => openEditCategory(c)}>
                      Editar
                    </button>
                    {c.active && (
                      <button type="button" className="btn-link btn-link--danger mono" onClick={() => deactivateCategory(c)}>
                        Desactivar
                      </button>
                    )}
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
                <th className="num">P. unit.</th>
                {isAdmin && <th />}
              </tr>
            </thead>
            <tbody>
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={isAdmin ? 7 : 6} className="muted">
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
                      <td className="mono">{row.tipo}</td>
                      <td className="num mono">
                        {Number(row.unitPrice).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </td>
                      {isAdmin && (
                        <td>
                          <button type="button" className="btn-link mono" onClick={() => openEditItem(row)}>
                            Editar
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

      {modalItem && isAdmin && (
        <Modal
          title={modalItem === 'new' ? 'Nuevo ítem' : 'Editar ítem'}
          onClose={() => setModalItem(null)}
          wide
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setModalItem(null)}>
                Cancelar
              </button>
              <button type="submit" form="item-form" className="btn btn-primary">
                Guardar
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
    </section>
  );
}
