import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Modal } from './Modal';

const STATUS_LABEL = {
  PENDING: 'Pendiente',
  APPROVED: 'Aprobada',
  REJECTED: 'Rechazada',
};

const KIND_LABEL = {
  CREATE: 'Nuevo ítem',
  UPDATE: 'Cambio nombre/precio',
};

function formatUsd(n) {
  if (n == null || Number.isNaN(n)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

const emptyCreate = {
  categoryId: '',
  codigo: '',
  descripcion: '',
  unidad: 'UND',
  tipo: 'ACTIVO',
  unitPrice: '',
  requestNotes: '',
};

const emptyUpdate = {
  catalogItemId: '',
  descripcion: '',
  unitPrice: '',
  requestNotes: '',
};

/** Panel de solicitudes de catálogo: cola de aprobación (admin) o envío (comercial). */
export function CatalogRequestsPanel({
  categories = [],
  catalogItems = [],
  canReview,
  isCommercial,
  onChanged,
  autoOpen,
  onAutoOpenHandled,
}) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);
  const [tab, setTab] = useState(canReview ? 'pending' : 'mine');
  const [modal, setModal] = useState(null);
  const [sel, setSel] = useState(null);
  const [createForm, setCreateForm] = useState(emptyCreate);
  const [updateForm, setUpdateForm] = useState(emptyUpdate);
  const [reviewForm, setReviewForm] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const status = tab === 'pending' ? 'PENDING' : '';
      const qs = status ? `?status=${status}` : '';
      const data = await api.get(`/api/catalog/requests${qs}`);
      let list = data || [];
      if (tab === 'pending') list = list.filter((r) => r.status === 'PENDING');
      setRequests(list);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (autoOpen === 'create' || autoOpen === 'update') {
      setModal(autoOpen);
      onAutoOpenHandled?.();
    }
  }, [autoOpen, onAutoOpenHandled]);

  function openReview(row) {
    setSel(row);
    setReviewForm({
      categoryId: row.categoryId,
      codigo: row.codigo,
      descripcion: row.descripcion,
      unidad: row.unidad,
      tipo: row.tipo,
      unitPrice: String(row.unitPrice ?? ''),
      reviewNotes: '',
    });
    setModal('review');
  }

  async function submitCreate(e) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.post('/api/catalog/requests', {
        kind: 'CREATE',
        categoryId: createForm.categoryId,
        codigo: createForm.codigo.trim(),
        descripcion: createForm.descripcion.trim(),
        unidad: createForm.unidad.trim() || 'UND',
        tipo: createForm.tipo,
        unitPrice: parseFloat(createForm.unitPrice) || 0,
        requestNotes: createForm.requestNotes.trim() || undefined,
      });
      setMsg('Solicitud enviada. Un administrador la revisará.');
      setCreateForm(emptyCreate);
      setModal(null);
      load();
      onChanged?.();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitUpdate(e) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const body = {
        kind: 'UPDATE',
        catalogItemId: updateForm.catalogItemId,
        requestNotes: updateForm.requestNotes.trim() || undefined,
      };
      if (updateForm.descripcion.trim()) body.descripcion = updateForm.descripcion.trim();
      if (updateForm.unitPrice !== '') body.unitPrice = parseFloat(updateForm.unitPrice);
      await api.post('/api/catalog/requests', body);
      setMsg('Solicitud de cambio enviada.');
      setUpdateForm(emptyUpdate);
      setModal(null);
      load();
      onChanged?.();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

  async function approve(e) {
    e.preventDefault();
    if (!sel || !reviewForm) return;
    setBusy(true);
    setErr(null);
    try {
      await api.put(`/api/catalog/requests/${sel.id}/approve`, {
        categoryId: reviewForm.categoryId,
        codigo: reviewForm.codigo.trim(),
        descripcion: reviewForm.descripcion.trim(),
        unidad: reviewForm.unidad.trim(),
        tipo: reviewForm.tipo,
        unitPrice: parseFloat(reviewForm.unitPrice) || 0,
        reviewNotes: reviewForm.reviewNotes.trim() || undefined,
      });
      setMsg('Solicitud aprobada. El ítem ya está en el catálogo.');
      setModal(null);
      setSel(null);
      load();
      onChanged?.();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    if (!sel) return;
    const notes = reviewForm?.reviewNotes?.trim() || window.prompt('Motivo del rechazo (opcional):') || '';
    setBusy(true);
    setErr(null);
    try {
      await api.put(`/api/catalog/requests/${sel.id}/reject`, { reviewNotes: notes || undefined });
      setMsg('Solicitud rechazada.');
      setModal(null);
      setSel(null);
      load();
      onChanged?.();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

  const sortedCats = [...categories].filter((c) => c.active !== false).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  return (
    <div className="catalog-requests">
      {err && (
        <div className="banner banner--err mono" style={{ marginBottom: 12 }}>
          {err}
        </div>
      )}
      {msg && (
        <div className="banner banner--ok mono" style={{ marginBottom: 12 }}>
          {msg}
        </div>
      )}

      <div className="page-header-actions" style={{ marginBottom: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {canReview && (
          <>
            <button
              type="button"
              className={`btn btn-ghost${tab === 'pending' ? ' active' : ''}`}
              onClick={() => setTab('pending')}
            >
              Pendientes
            </button>
            <button
              type="button"
              className={`btn btn-ghost${tab === 'history' ? ' active' : ''}`}
              onClick={() => setTab('history')}
            >
              Historial
            </button>
          </>
        )}
        {isCommercial && (
          <>
            <button type="button" className="btn btn-primary" onClick={() => setModal('create')}>
              Solicitar nuevo ítem
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setModal('update')}>
              Solicitar cambio nombre/precio
            </button>
            <button
              type="button"
              className={`btn btn-ghost${tab === 'mine' ? ' active' : ''}`}
              onClick={() => setTab('mine')}
            >
              Mis solicitudes
            </button>
          </>
        )}
      </div>

      <div className="panel panel--flush">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Código</th>
                <th>Descripción</th>
                <th>Precio</th>
                {canReview && <th>Solicitante</th>}
                <th>Estado</th>
                <th>Fecha</th>
                {canReview && <th className="actions-col">Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={canReview ? 8 : 6} className="muted mono">
                    Cargando…
                  </td>
                </tr>
              ) : requests.length === 0 ? (
                <tr>
                  <td colSpan={canReview ? 8 : 6} className="muted">
                    {tab === 'pending' ? 'No hay solicitudes pendientes' : 'Sin solicitudes'}
                  </td>
                </tr>
              ) : (
                requests.map((r) => (
                  <tr key={r.id}>
                    <td className="mono" style={{ fontSize: 11 }}>
                      {KIND_LABEL[r.kind] || r.kind}
                    </td>
                    <td className="mono">{r.codigo}</td>
                    <td>
                      {r.descripcion}
                      {r.kind === 'UPDATE' && r.prevDescripcion && r.prevDescripcion !== r.descripcion && (
                        <span className="muted mono" style={{ display: 'block', fontSize: 10 }}>
                          Antes: {r.prevDescripcion}
                        </span>
                      )}
                    </td>
                    <td className="mono">
                      {formatUsd(r.unitPrice)}
                      {r.kind === 'UPDATE' && r.prevUnitPrice != null && Math.abs(r.prevUnitPrice - r.unitPrice) > 0.005 && (
                        <span className="muted" style={{ display: 'block', fontSize: 10 }}>
                          Antes: {formatUsd(r.prevUnitPrice)}
                        </span>
                      )}
                    </td>
                    {canReview && (
                      <td className="mono" style={{ fontSize: 11 }}>
                        {r.requestedByEmail}
                      </td>
                    )}
                    <td>
                      <span
                        className="tag"
                        style={{
                          borderColor:
                            r.status === 'PENDING' ? 'var(--amber)' : r.status === 'APPROVED' ? 'var(--green)' : 'var(--red)',
                          color:
                            r.status === 'PENDING' ? 'var(--amber)' : r.status === 'APPROVED' ? 'var(--green)' : 'var(--red)',
                        }}
                      >
                        {STATUS_LABEL[r.status] || r.status}
                      </span>
                    </td>
                    <td className="mono" style={{ fontSize: 11 }}>
                      {r.createdAt ? new Date(r.createdAt).toLocaleString('es-PE') : '—'}
                    </td>
                    {canReview && (
                      <td>
                        {r.status === 'PENDING' && (
                          <button type="button" className="btn-link mono" onClick={() => openReview(r)}>
                            Revisar
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modal === 'create' && (
        <Modal
          title="Solicitar nuevo ítem de catálogo"
          onClose={() => setModal(null)}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setModal(null)}>
                Cancelar
              </button>
              <button type="submit" form="cat-req-create" className="btn btn-primary" disabled={busy}>
                {busy ? 'Enviando…' : 'Enviar solicitud'}
              </button>
            </>
          }
        >
          <form id="cat-req-create" className="stack-form" onSubmit={submitCreate}>
            <p className="muted mono" style={{ fontSize: 12 }}>
              El ítem no se publicará hasta que un administrador o superusuario lo apruebe.
            </p>
            <label>
              <span className="fg-lbl">Categoría *</span>
              <select
                className="form-input"
                required
                value={createForm.categoryId}
                onChange={(e) => setCreateForm((f) => ({ ...f, categoryId: e.target.value }))}
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
                value={createForm.codigo}
                onChange={(e) => setCreateForm((f) => ({ ...f, codigo: e.target.value }))}
              />
            </label>
            <label>
              <span className="fg-lbl">Descripción / nombre *</span>
              <input
                className="form-input"
                required
                value={createForm.descripcion}
                onChange={(e) => setCreateForm((f) => ({ ...f, descripcion: e.target.value }))}
              />
            </label>
            <label>
              <span className="fg-lbl">Precio unitario USD *</span>
              <input
                className="form-input mono"
                type="number"
                min="0"
                step="0.01"
                required
                value={createForm.unitPrice}
                onChange={(e) => setCreateForm((f) => ({ ...f, unitPrice: e.target.value }))}
              />
            </label>
            <label>
              <span className="fg-lbl">Unidad</span>
              <input
                className="form-input mono"
                value={createForm.unidad}
                onChange={(e) => setCreateForm((f) => ({ ...f, unidad: e.target.value }))}
              />
            </label>
            <label>
              <span className="fg-lbl">Tipo</span>
              <select
                className="form-input"
                value={createForm.tipo}
                onChange={(e) => setCreateForm((f) => ({ ...f, tipo: e.target.value }))}
              >
                <option value="ACTIVO">ACTIVO</option>
                <option value="CONSUMIBLE">CONSUMIBLE</option>
              </select>
            </label>
            <label>
              <span className="fg-lbl">Notas para el revisor</span>
              <textarea
                className="form-input form-textarea"
                rows={2}
                value={createForm.requestNotes}
                onChange={(e) => setCreateForm((f) => ({ ...f, requestNotes: e.target.value }))}
              />
            </label>
          </form>
        </Modal>
      )}

      {modal === 'update' && (
        <Modal
          title="Solicitar cambio de nombre o precio"
          onClose={() => setModal(null)}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setModal(null)}>
                Cancelar
              </button>
              <button type="submit" form="cat-req-update" className="btn btn-primary" disabled={busy}>
                {busy ? 'Enviando…' : 'Enviar solicitud'}
              </button>
            </>
          }
        >
          <form id="cat-req-update" className="stack-form" onSubmit={submitUpdate}>
            <label>
              <span className="fg-lbl">Ítem del catálogo *</span>
              <select
                className="form-input"
                required
                value={updateForm.catalogItemId}
                onChange={(e) => {
                  const id = e.target.value;
                  const it = catalogItems.find((x) => x.id === id);
                  setUpdateForm((f) => ({
                    ...f,
                    catalogItemId: id,
                    descripcion: it?.descripcion || '',
                    unitPrice: it?.unitPrice != null ? String(it.unitPrice) : '',
                  }));
                }}
              >
                <option value="">—</option>
                {catalogItems.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.codigo} — {it.descripcion}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="fg-lbl">Nuevo nombre / descripción</span>
              <input
                className="form-input"
                value={updateForm.descripcion}
                onChange={(e) => setUpdateForm((f) => ({ ...f, descripcion: e.target.value }))}
              />
            </label>
            <label>
              <span className="fg-lbl">Nuevo precio USD</span>
              <input
                className="form-input mono"
                type="number"
                min="0"
                step="0.01"
                value={updateForm.unitPrice}
                onChange={(e) => setUpdateForm((f) => ({ ...f, unitPrice: e.target.value }))}
              />
            </label>
            <label>
              <span className="fg-lbl">Motivo del cambio</span>
              <textarea
                className="form-input form-textarea"
                rows={2}
                value={updateForm.requestNotes}
                onChange={(e) => setUpdateForm((f) => ({ ...f, requestNotes: e.target.value }))}
              />
            </label>
          </form>
        </Modal>
      )}

      {modal === 'review' && sel && reviewForm && (
        <Modal
          wide
          title={`Revisar solicitud — ${KIND_LABEL[sel.kind]}`}
          onClose={() => setModal(null)}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setModal(null)} disabled={busy}>
                Cancelar
              </button>
              <button type="button" className="btn btn-ghost" style={{ color: 'var(--red)' }} onClick={reject} disabled={busy}>
                Rechazar
              </button>
              <button type="submit" form="cat-req-review" className="btn btn-primary" disabled={busy}>
                {busy ? 'Guardando…' : 'Aprobar y publicar'}
              </button>
            </>
          }
        >
          <p className="muted mono" style={{ fontSize: 12, marginBottom: 12 }}>
            Solicitante: <strong>{sel.requestedByEmail}</strong>
            {sel.requestNotes && <> · Nota: {sel.requestNotes}</>}
          </p>
          <form id="cat-req-review" className="stack-form" onSubmit={approve}>
            <label>
              <span className="fg-lbl">Categoría</span>
              <select
                className="form-input"
                value={reviewForm.categoryId}
                onChange={(e) => setReviewForm((f) => ({ ...f, categoryId: e.target.value }))}
              >
                {sortedCats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="fg-lbl">Código</span>
              <input
                className="form-input mono"
                required
                value={reviewForm.codigo}
                onChange={(e) => setReviewForm((f) => ({ ...f, codigo: e.target.value }))}
                disabled={sel.kind === 'UPDATE'}
              />
            </label>
            <label>
              <span className="fg-lbl">Descripción / nombre</span>
              <input
                className="form-input"
                required
                value={reviewForm.descripcion}
                onChange={(e) => setReviewForm((f) => ({ ...f, descripcion: e.target.value }))}
              />
            </label>
            <label>
              <span className="fg-lbl">Precio USD</span>
              <input
                className="form-input mono"
                type="number"
                min="0"
                step="0.01"
                required
                value={reviewForm.unitPrice}
                onChange={(e) => setReviewForm((f) => ({ ...f, unitPrice: e.target.value }))}
              />
            </label>
            <label>
              <span className="fg-lbl">Unidad</span>
              <input
                className="form-input mono"
                value={reviewForm.unidad}
                onChange={(e) => setReviewForm((f) => ({ ...f, unidad: e.target.value }))}
              />
            </label>
            <label>
              <span className="fg-lbl">Tipo</span>
              <select
                className="form-input"
                value={reviewForm.tipo}
                onChange={(e) => setReviewForm((f) => ({ ...f, tipo: e.target.value }))}
              >
                <option value="ACTIVO">ACTIVO</option>
                <option value="CONSUMIBLE">CONSUMIBLE</option>
              </select>
            </label>
            <label>
              <span className="fg-lbl">Notas de revisión</span>
              <textarea
                className="form-input form-textarea"
                rows={2}
                value={reviewForm.reviewNotes}
                onChange={(e) => setReviewForm((f) => ({ ...f, reviewNotes: e.target.value }))}
              />
            </label>
          </form>
        </Modal>
      )}
    </div>
  );
}
