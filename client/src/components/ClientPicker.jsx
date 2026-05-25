import React, { useEffect, useMemo, useRef, useState } from 'react';
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

function clientSearchText(c) {
  return [c.razonSocial, c.ruc, c.contactoNombre, c.contactoEmail, c.ciudad].filter(Boolean).join(' ');
}

/** Combobox de clientes con búsqueda y creación rápida en modal. */
export function ClientPicker({
  id,
  className = 'form-input',
  clients = [],
  value,
  onChange,
  onClientsChange,
  canCreate = true,
  optional = true,
  disabled = false,
  placeholder = 'Buscar cliente por razón social, RUC…',
  emptyLabel = 'Sin clientes coincidentes',
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState(emptyCreateForm);
  const [createBusy, setCreateBusy] = useState(false);
  const [createErr, setCreateErr] = useState(null);
  const wrapRef = useRef(null);

  const selected = clients.find((c) => c.id === value);

  useEffect(() => {
    if (!open) {
      setQ(selected?.razonSocial || '');
    }
  }, [value, selected, open]);

  useEffect(() => {
    function onDoc(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const list = clients.filter((c) => c.active !== false);
    if (!qq) return list;
    return list.filter((c) => clientSearchText(c).toLowerCase().includes(qq));
  }, [clients, q]);

  function pick(clientId) {
    onChange(clientId);
    const c = clients.find((x) => x.id === clientId);
    setQ(c?.razonSocial || '');
    setOpen(false);
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
      onClientsChange?.([...clients, created]);
      onChange(created.id);
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
      <div className="searchable-select" ref={wrapRef}>
        <input
          id={id}
          type="search"
          className={className}
          disabled={disabled}
          placeholder={placeholder}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            if (!e.target.value.trim() && optional) onChange('');
          }}
          onFocus={() => setOpen(true)}
          autoComplete="off"
        />
        {open && !disabled && (
          <ul className="searchable-select__list zgroup-scroll" role="listbox">
            {optional && (
              <li>
                <button
                  type="button"
                  className={'searchable-select__opt' + (!value ? ' searchable-select__opt--active' : '')}
                  onClick={() => pick('')}
                >
                  — Sin cliente —
                </button>
              </li>
            )}
            {filtered.length === 0 ? (
              <li className="searchable-select__empty muted">{emptyLabel}</li>
            ) : (
              filtered.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className={'searchable-select__opt' + (c.id === value ? ' searchable-select__opt--active' : '')}
                    onClick={() => pick(c.id)}
                  >
                    <span>{c.razonSocial}</span>
                    {(c.ruc || c.ciudad) && (
                      <span className="muted" style={{ display: 'block', fontSize: 10, marginTop: 2 }}>
                        {[c.ruc, c.ciudad].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </button>
                </li>
              ))
            )}
            {canCreate && (
              <li className="searchable-select__footer">
                <button
                  type="button"
                  className="searchable-select__create mono"
                  onClick={() => openCreateModal(q)}
                >
                  + Crear cliente{q.trim() ? ` «${q.trim()}»` : ''}
                </button>
              </li>
            )}
          </ul>
        )}
      </div>

      {createOpen && canCreate && (
        <Modal
          title="Nuevo cliente"
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
