import React, { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { Modal } from './Modal';

const emptyCreateForm = {
  razonSocial: '',
  ruc: '',
  contactoNombre: '',
  contactoEmail: '',
  contactoTelefono: '',
  ciudad: '',
};

const TAG_LABEL = {
  cliente: 'Cliente',
  proveedor: 'Proveedor',
  contacto: 'Contacto',
  local: 'Local',
};

function OriginBadge({ origin, tags }) {
  const showLocal = origin === 'local' || (tags || []).includes('local');
  if (showLocal && !origin) {
    return <span className="tag tag--warn">No está en Odoo</span>;
  }
  if (origin === 'local' || showLocal) {
    return <span className="tag tag--warn">No está en Odoo</span>;
  }
  if (origin === 'linked') {
    return <span className="tag tag--ok">Vinculado</span>;
  }
  if (origin === 'odoo') {
    return <span className="tag tag--cyan">Odoo</span>;
  }
  return null;
}

function PickerTags({ tags }) {
  const visual = (tags || []).filter((t) => t !== 'local');
  if (!visual.length) return null;
  return (
    <span className="client-picker__tags">
      {visual.map((t) => (
        <span key={t} className={'tag' + (t === 'cliente' ? ' tag--ok' : t === 'proveedor' ? ' tag--warn' : ' tag--muted')}>
          {TAG_LABEL[t] || t}
        </span>
      ))}
    </span>
  );
}

/** Combobox typeahead contra caché Odoo (GET /api/clients/picker). Sin XML-RPC. */
export function ClientPicker({
  id,
  className = 'form-input',
  value,
  onChange,
  onClientsChange,
  canCreate = false,
  optional = true,
  disabled = false,
  placeholder = 'Buscar cliente por razón social, RUC, contacto…',
  emptyLabel = 'Sin coincidencias en la caché',
  inlineList = false,
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [items, setItems] = useState([]);
  const [stale, setStale] = useState(false);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState(emptyCreateForm);
  const [createBusy, setCreateBusy] = useState(false);
  const [createErr, setCreateErr] = useState(null);
  const [pickErr, setPickErr] = useState(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncHint, setSyncHint] = useState(null);
  const [syncHintCode, setSyncHintCode] = useState(null);
  const [odooUrl, setOdooUrl] = useState('');
  const wrapRef = useRef(null);
  const reqRef = useRef(0);

  useEffect(() => {
    if (!value) {
      setSelected(null);
      if (!open) setQ('');
      return;
    }
    let cancelled = false;
    api
      .get(`/api/clients/${value}`)
      .then((c) => {
        if (cancelled) return;
        setSelected(c);
        if (!open) setQ(c.razonSocial || '');
      })
      .catch(() => {
        if (!cancelled) setSelected(null);
      });
    return () => {
      cancelled = true;
    };
  }, [value]);

  useEffect(() => {
    if (!open || syncBusy) return undefined;
    const handle = setTimeout(() => {
      const n = ++reqRef.current;
      setSearching(true);
      api
        .get(`/api/clients/picker?q=${encodeURIComponent(q.trim())}&limit=30`)
        .then((data) => {
          if (n !== reqRef.current) return;
          setItems(Array.isArray(data?.items) ? data.items : []);
          setStale(Boolean(data?.stale));
        })
        .catch(() => {
          if (n !== reqRef.current) return;
          setItems([]);
        })
        .finally(() => {
          if (n === reqRef.current) setSearching(false);
        });
    }, 250);
    return () => clearTimeout(handle);
  }, [q, open, syncBusy]);

  useEffect(() => {
    function onDoc(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  function displayQuery() {
    if (open) return q;
    return selected?.razonSocial || q;
  }

  async function pick(item) {
    setPickErr(null);
    if (!item) {
      onChange('');
      setSelected(null);
      setQ('');
      setOpen(false);
      return;
    }
    try {
      let client = null;
      if (item.kind === 'local' && item.clientId) {
        client = await api.get(`/api/clients/${item.clientId}`);
      } else if (item.contactOdooId || !item.clientId) {
        client = await api.post('/api/clients/from-odoo', {
          odooId: item.odooId,
          contactOdooId: item.contactOdooId || undefined,
        });
      } else {
        client = await api.get(`/api/clients/${item.clientId}`);
      }
      onChange(client.id);
      setSelected(client);
      setQ(client.razonSocial || '');
      onClientsChange?.((prev) => {
        const list = Array.isArray(prev) ? prev : [];
        if (list.some((c) => c.id === client.id)) return list;
        return [...list, client];
      });
      setOpen(false);
    } catch (err) {
      setPickErr(err.message);
    }
  }

  async function refreshFromOdoo() {
    const term = q.trim();
    if (term.length < 3 || syncBusy) return;
    const n = ++reqRef.current;
    setSyncBusy(true);
    setPickErr(null);
    setSyncHint(null);
    setSyncHintCode(null);
    try {
      const data = await api.post('/api/clients/picker/refresh', { q: term });
      if (n !== reqRef.current) return;
      setItems(Array.isArray(data?.items) ? data.items : []);
      setStale(Boolean(data?.stale));
      setSyncHint(data?.hint || null);
      setSyncHintCode(data?.hintCode || null);
      if (data?.odooUrl) setOdooUrl(data.odooUrl);
    } catch (err) {
      setSyncHint(err.message);
      setSyncHintCode('ERROR');
    } finally {
      setSyncBusy(false);
    }
  }

  function openCreateModal(prefill = '') {
    setCreateErr(null);
    setCreateForm({
      ...emptyCreateForm,
      razonSocial: prefill.trim() || q.trim(),
    });
    setCreateOpen(true);
    setOpen(false);
  }

  async function submitCreate(e) {
    e.preventDefault();
    if (!createForm.razonSocial.trim()) {
      setCreateErr('Razón social requerida');
      return;
    }
    setCreateBusy(true);
    setCreateErr(null);
    try {
      const created = await api.post('/api/clients', {
        razonSocial: createForm.razonSocial.trim(),
        ruc: createForm.ruc.trim() || undefined,
        contactoNombre: createForm.contactoNombre.trim() || undefined,
        contactoEmail: createForm.contactoEmail.trim() || undefined,
        contactoTelefono: createForm.contactoTelefono.trim() || undefined,
        ciudad: createForm.ciudad.trim() || undefined,
      });
      onClientsChange?.((prev) => [...(Array.isArray(prev) ? prev : []), created]);
      onChange(created.id);
      setSelected(created);
      setQ(created.razonSocial || '');
      setCreateOpen(false);
      setCreateForm(emptyCreateForm);
    } catch (err) {
      setCreateErr(err.message);
    } finally {
      setCreateBusy(false);
    }
  }

  return (
    <>
      <div className={'searchable-select' + (inlineList ? ' searchable-select--inline' : '')} ref={wrapRef}>
        <input
          id={id}
          type="search"
          className={className}
          disabled={disabled}
          placeholder={placeholder}
          value={open ? q : displayQuery()}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setSyncHint(null);
            setSyncHintCode(null);
            if (!e.target.value.trim() && optional) {
              onChange('');
              setSelected(null);
            }
          }}
          onFocus={() => {
            setOpen(true);
            if (selected?.razonSocial && q === selected.razonSocial) setQ('');
          }}
          autoComplete="off"
        />
        {stale && (
          <p className="client-picker__stale muted mono">Contactos Odoo desactualizados (&gt;45 min)</p>
        )}
        {pickErr && (
          <p className="client-picker__stale" style={{ color: 'var(--red)' }}>
            {pickErr}
          </p>
        )}
        {open && !disabled && (
          <ul className="searchable-select__list zgroup-scroll" role="listbox">
            {optional && (
              <li>
                <button
                  type="button"
                  className={'searchable-select__opt' + (!value ? ' searchable-select__opt--active' : '')}
                  onClick={() => pick(null)}
                >
                  — Sin cliente —
                </button>
              </li>
            )}
            {syncBusy && items.length === 0 ? (
              <li className="searchable-select__empty muted">Consultando Odoo…</li>
            ) : searching && items.length === 0 ? (
              <li className="searchable-select__empty muted">Buscando…</li>
            ) : items.length === 0 ? (
              <li className="searchable-select__empty muted">
                {emptyLabel}
                {q.trim().length >= 3 && !syncHint && (
                  <span className="client-picker__hint-inline">
                    {' '}
                    Si acaba de crearse, actualice desde Odoo.
                  </span>
                )}
              </li>
            ) : (
              items.map((item) => (
                <li key={item.key}>
                  <button
                    type="button"
                    className={
                      'searchable-select__opt' +
                      (item.indent ? ' searchable-select__opt--child' : '') +
                      (item.clientId && item.clientId === value && !item.contactOdooId
                        ? ' searchable-select__opt--active'
                        : '')
                    }
                    onClick={() => pick(item)}
                  >
                    <span className={item.indent ? 'client-picker__child-name' : 'client-picker__company'}>
                      {item.indent ? item.contactName : item.razonSocial}
                    </span>
                    <span className="client-picker__meta muted">
                      {item.indent
                        ? [item.email, item.razonSocial].filter(Boolean).join(' · ')
                        : [item.ruc, item.ciudad].filter(Boolean).join(' · ')}
                    </span>
                    <span className="client-picker__badges">
                      <PickerTags tags={item.tags} />
                      <OriginBadge origin={item.syncOrigin} tags={item.tags} />
                    </span>
                  </button>
                </li>
              ))
            )}
            {q.trim().length >= 3 && (
              <li className="searchable-select__footer">
                <button
                  type="button"
                  className="searchable-select__odoo mono"
                  disabled={syncBusy}
                  onClick={refreshFromOdoo}
                >
                  {syncBusy ? 'Consultando Odoo…' : 'Actualizar / buscar en Odoo'}
                </button>
                {syncHint && (
                  <p
                    className={
                      'client-picker__hint mono' +
                      (syncHintCode === 'OK' ? ' client-picker__hint--ok' : ' client-picker__hint--warn')
                    }
                  >
                    {syncHint}
                    {(syncHintCode === 'NOT_IN_ODOO' || syncHintCode === 'NOT_ELIGIBLE') && odooUrl ? (
                      <>
                        {' '}
                        <a href={odooUrl} target="_blank" rel="noreferrer">
                          Abrir Odoo
                        </a>
                      </>
                    ) : null}
                  </p>
                )}
              </li>
            )}
            {canCreate && (
              <li className="searchable-select__footer">
                <button
                  type="button"
                  className="searchable-select__create mono"
                  onClick={() => openCreateModal(q)}
                >
                  + Crear cliente local{q.trim() ? ` «${q.trim()}»` : ''}
                </button>
              </li>
            )}
          </ul>
        )}
      </div>

      {createOpen && canCreate && (
        <Modal
          title="Nuevo cliente local"
          onClose={() => !createBusy && setCreateOpen(false)}
          footer={
            <>
              <button type="button" className="btn btn-ghost" disabled={createBusy} onClick={() => setCreateOpen(false)}>
                Cancelar
              </button>
              <button type="submit" form="client-picker-create-form" className="btn btn-primary" disabled={createBusy}>
                {createBusy ? 'Guardando…' : 'Crear y seleccionar'}
              </button>
            </>
          }
        >
          <p className="muted mono" style={{ fontSize: 11, marginBottom: 10 }}>
            Quedará marcado «No está en Odoo» hasta la etapa de alta hacia Odoo. Preferible crearlo en Odoo y pulsar
            Actualizar contactos.
          </p>
          {createErr && (
            <div className="banner banner--err mono" style={{ marginBottom: 12 }}>
              {createErr}
            </div>
          )}
          <form id="client-picker-create-form" className="stack-form" onSubmit={submitCreate}>
            <label>
              <span className="fg-lbl">Razón social *</span>
              <input
                className="form-input"
                required
                value={createForm.razonSocial}
                onChange={(e) => setCreateForm((f) => ({ ...f, razonSocial: e.target.value }))}
              />
            </label>
            <label>
              <span className="fg-lbl">RUC</span>
              <input
                className="form-input mono"
                value={createForm.ruc}
                onChange={(e) => setCreateForm((f) => ({ ...f, ruc: e.target.value }))}
              />
            </label>
            <label>
              <span className="fg-lbl">Contacto</span>
              <input
                className="form-input"
                value={createForm.contactoNombre}
                onChange={(e) => setCreateForm((f) => ({ ...f, contactoNombre: e.target.value }))}
              />
            </label>
            <label>
              <span className="fg-lbl">Email contacto</span>
              <input
                type="email"
                className="form-input mono"
                value={createForm.contactoEmail}
                onChange={(e) => setCreateForm((f) => ({ ...f, contactoEmail: e.target.value }))}
              />
            </label>
            <label>
              <span className="fg-lbl">Teléfono</span>
              <input
                className="form-input mono"
                value={createForm.contactoTelefono}
                onChange={(e) => setCreateForm((f) => ({ ...f, contactoTelefono: e.target.value }))}
              />
            </label>
            <label>
              <span className="fg-lbl">Ciudad</span>
              <input
                className="form-input"
                value={createForm.ciudad}
                onChange={(e) => setCreateForm((f) => ({ ...f, ciudad: e.target.value }))}
              />
            </label>
          </form>
        </Modal>
      )}
    </>
  );
}
