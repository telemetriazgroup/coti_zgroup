import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, getBlob, postFormData } from '../lib/api';
import { fetchCatalog } from '../lib/catalogApi';
import { useAuth } from '../context/AuthContext';
import { Modal } from '../components/Modal';

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

  const fileInputRef = useRef(null);
  const [importModal, setImportModal] = useState(false);
  const [importPreview, setImportPreview] = useState(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importApplying, setImportApplying] = useState(false);

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
