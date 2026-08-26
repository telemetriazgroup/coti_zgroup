import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';

function dash(v) {
  return v == null || String(v).trim() === '' ? '—' : v;
}

function TagPill({ pill }) {
  const cls =
    pill.kind === 'cliente'
      ? 'tag tag--ok'
      : pill.kind === 'proveedor'
        ? 'tag tag--warn'
        : pill.kind === 'local'
          ? 'tag tag--warn'
          : 'tag tag--muted';
  return <span className={cls}>{pill.name}</span>;
}

function RoField({ label, children, mono }) {
  return (
    <div className="odoo-ficha__field">
      <span className="odoo-ficha__lbl">{label}</span>
      <div className={'odoo-ficha__val' + (mono ? ' mono' : '')}>{children}</div>
    </div>
  );
}

function BoolSwitch({ on }) {
  return (
    <span className={'odoo-ficha__switch' + (on ? ' odoo-ficha__switch--on' : '')} aria-hidden>
      {on ? 'Sí' : 'No'}
    </span>
  );
}

function OutboxBanner({ outbox }) {
  if (!outbox?.status || outbox.status === 'enviado') return null;
  const kind = outbox.status === 'pendiente' ? 'warn' : 'err';
  let text;
  if (outbox.status === 'pendiente') {
    text = outbox.consultarSunat
      ? outbox.lastError
        ? `Consultando SUNAT… ${outbox.lastError}`
        : 'Consultando SUNAT… se completarán razón social y dirección.'
      : outbox.lastError
        ? `Sincronizando con Odoo… ${outbox.lastError}`
        : 'Enviando a Odoo… la ficha se actualizará al confirmar.';
  } else if (outbox.status === 'conflicto') {
    text = outbox.lastError || 'Conflicto: Odoo tiene una versión más nueva. Gana Odoo.';
  } else {
    text = outbox.lastError || 'Odoo rechazó el envío.';
  }
  return (
    <div className={`banner banner--${kind} mono`} style={{ marginBottom: 12 }}>
      {text}
    </div>
  );
}

function formFromClient(client, card) {
  return {
    razonSocial: client?.razonSocial || card?.name || '',
    ruc: client?.ruc || card?.vat || '',
    direccion: client?.direccion || card?.street || '',
    street2: card?.street2 || '',
    ciudad: client?.ciudad || card?.city || '',
    zip: card?.zip || '',
    contactoNombre: client?.contactoNombre || '',
    contactoEmail: client?.contactoEmail || card?.email || '',
    contactoTelefono: client?.contactoTelefono || card?.phone || '',
    mobile: card?.mobile || '',
    website: card?.website || '',
    notas: client?.notas || card?.comment || '',
  };
}

const TABS = [
  ['contactos', 'Contactos y direcciones'],
  ['ventas', 'Ventas y compras'],
  ['ficha_ruc', 'Ficha RUC'],
  ['notas', 'Notas internas'],
  ['asignacion', 'Asignación'],
  ['sync', 'Sincronización'],
];

/**
 * Ficha de contacto homologada con Contactos Odoo 17 (campos de la caché + outbox).
 */
export function ClientOdooFicha({ client, ficha, canEdit, onSaved, onClose }) {
  const [tab, setTab] = useState('contactos');
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(() => formFromClient(client, ficha || {}));
  const [saving, setSaving] = useState(false);
  const [sunatBusy, setSunatBusy] = useState(false);
  const [formErr, setFormErr] = useState(null);
  const card = ficha || {};
  const contacts = Array.isArray(card.contacts) ? card.contacts : [];
  const isCompany = card.isCompany !== false;
  const rucFicha = card.rucFicha || {};

  useEffect(() => {
    setEditing(false);
    setFormErr(null);
  }, [client?.id]);

  useEffect(() => {
    if (!editing) setForm(formFromClient(client, ficha || {}));
  }, [client, ficha, editing]);

  async function saveEdit(e) {
    e.preventDefault();
    if (!client?.id) return;
    setSaving(true);
    setFormErr(null);
    try {
      const data = await api.put(`/api/clients/${client.id}`, {
        razonSocial: form.razonSocial,
        ruc: form.ruc || '',
        direccion: form.direccion,
        street2: form.street2,
        ciudad: form.ciudad,
        zip: form.zip,
        contactoNombre: form.contactoNombre,
        contactoEmail: form.contactoEmail,
        contactoTelefono: form.contactoTelefono,
        mobile: form.mobile,
        website: form.website,
        notas: form.notas,
      });
      setEditing(false);
      if (onSaved) onSaved(data);
    } catch (err) {
      setFormErr(err.message || 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  }

  async function consultarSunat() {
    if (!client?.id) return;
    setSunatBusy(true);
    setFormErr(null);
    try {
      const data = await api.post(`/api/clients/${client.id}/sunat`);
      if (onSaved) onSaved(data);
    } catch (err) {
      setFormErr(err.message || 'No se pudo consultar SUNAT');
    } finally {
      setSunatBusy(false);
    }
  }

  const sunatDisabled = sunatBusy || client?.outbox?.status === 'pendiente';

  return (
    <div className="odoo-ficha">
      <div className="odoo-ficha__top">
        <div>
          <div className="odoo-ficha__type" role="group" aria-label="Tipo de contacto">
            <span className={'odoo-ficha__type-opt' + (!isCompany ? ' odoo-ficha__type-opt--on' : '')}>Persona</span>
            <span className={'odoo-ficha__type-opt' + (isCompany ? ' odoo-ficha__type-opt--on' : '')}>Empresa</span>
          </div>
          {editing ? (
            <input
              className="form-input odoo-ficha__name-input"
              value={form.razonSocial}
              onChange={(e) => setForm((f) => ({ ...f, razonSocial: e.target.value }))}
              placeholder="Razón social"
            />
          ) : (
            <h2 className="odoo-ficha__name">{card.name || client?.razonSocial || '—'}</h2>
          )}
          {client?.syncOrigin === 'local' && <span className="tag tag--warn">Pendiente en Odoo</span>}
          {client?.syncOrigin === 'odoo' && <span className="tag tag--cyan">Odoo</span>}
          {client?.syncOrigin === 'linked' && <span className="tag tag--ok">Vinculado</span>}
        </div>
        <div className="odoo-ficha__avatar" aria-hidden>
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
            {isCompany ? (
              <path d="M3 21V8l9-5 9 5v13M9 21v-6h6v6" />
            ) : (
              <>
                <circle cx="12" cy="8" r="4" />
                <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
              </>
            )}
          </svg>
        </div>
        {canEdit && !editing && (
          <button type="button" className="btn btn-ghost" onClick={() => setEditing(true)}>
            Editar
          </button>
        )}
        {onClose && (
          <button type="button" className="btn btn-ghost odoo-ficha__close" onClick={onClose}>
            Cerrar
          </button>
        )}
      </div>

      <OutboxBanner outbox={client?.outbox} />
      {formErr && (
        <div className="banner banner--err mono" style={{ marginBottom: 12 }}>
          {formErr}
        </div>
      )}

      {editing ? (
        <form className="odoo-ficha__grid" onSubmit={saveEdit}>
          <div>
            <RoField label="Dirección">
              <input
                className="form-input"
                value={form.direccion}
                onChange={(e) => setForm((f) => ({ ...f, direccion: e.target.value }))}
                placeholder="Calle"
              />
              <input
                className="form-input"
                style={{ marginTop: 6 }}
                value={form.street2}
                onChange={(e) => setForm((f) => ({ ...f, street2: e.target.value }))}
                placeholder="Calle 2"
              />
              <input
                className="form-input"
                style={{ marginTop: 6 }}
                value={form.ciudad}
                onChange={(e) => setForm((f) => ({ ...f, ciudad: e.target.value }))}
                placeholder="Ciudad"
              />
              <input
                className="form-input mono"
                style={{ marginTop: 6 }}
                value={form.zip}
                onChange={(e) => setForm((f) => ({ ...f, zip: e.target.value }))}
                placeholder="Código postal"
              />
            </RoField>
            <RoField label="NIF">
              <div className="odoo-ficha__nif">
                <span className="odoo-ficha__nif-type">RUC (PE)</span>
                <input
                  className="form-input mono"
                  value={form.ruc}
                  onChange={(e) => setForm((f) => ({ ...f, ruc: e.target.value }))}
                  placeholder="11 dígitos"
                />
              </div>
            </RoField>
            <button type="button" className="btn btn-ghost odoo-ficha__sunat" disabled={sunatDisabled} onClick={consultarSunat}>
              {sunatBusy ? 'Consultando SUNAT…' : 'Consulta SUNAT'}
            </button>
          </div>
          <div>
            <RoField label="Teléfono">
              <input
                className="form-input mono"
                value={form.contactoTelefono}
                onChange={(e) => setForm((f) => ({ ...f, contactoTelefono: e.target.value }))}
              />
            </RoField>
            <RoField label="Móvil">
              <input
                className="form-input mono"
                value={form.mobile}
                onChange={(e) => setForm((f) => ({ ...f, mobile: e.target.value }))}
              />
            </RoField>
            <RoField label="Correo electrónico">
              <input
                type="email"
                className="form-input mono"
                value={form.contactoEmail}
                onChange={(e) => setForm((f) => ({ ...f, contactoEmail: e.target.value }))}
              />
            </RoField>
            <RoField label="Sitio web">
              <input
                className="form-input mono"
                value={form.website}
                onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))}
                placeholder="https://…"
              />
            </RoField>
            <RoField label="Contacto (cotización)">
              <input
                className="form-input"
                value={form.contactoNombre}
                onChange={(e) => setForm((f) => ({ ...f, contactoNombre: e.target.value }))}
              />
            </RoField>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)} disabled={saving}>
                Cancelar
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Guardando…' : 'Guardar en Odoo'}
              </button>
            </div>
          </div>
        </form>
      ) : (
        <div className="odoo-ficha__grid">
          <div>
            <RoField label="Dirección">
              {card.street || card.street2 || card.city ? (
                <>
                  {card.street && <div>{card.street}</div>}
                  {card.street2 && <div>{card.street2}</div>}
                  {card.district && <div>{card.district}</div>}
                  <div>{[card.city, card.state].filter(Boolean).join(' · ')}</div>
                  {card.zip && <div className="mono">{card.zip}</div>}
                  {card.country && <div>{card.country}</div>}
                </>
              ) : (
                dash(client?.direccion)
              )}
            </RoField>
            <RoField label="NIF" mono>
              <div className="odoo-ficha__nif">
                <span className="odoo-ficha__nif-type">{card.identificationType || 'RUC (PE)'}</span>
                <span>{dash(card.vat || client?.ruc)}</span>
              </div>
            </RoField>
            {canEdit && (
              <button
                type="button"
                className="btn btn-ghost odoo-ficha__sunat"
                disabled={sunatDisabled}
                onClick={consultarSunat}
                title="Consulta RUC en SUNAT (vía Odoo) y completa razón social y dirección"
              >
                {sunatBusy ? 'Consultando SUNAT…' : 'Consulta SUNAT'}
              </button>
            )}
          </div>
          <div>
            <RoField label="Teléfono" mono>
              {dash(card.phone || client?.contactoTelefono)}
            </RoField>
            <RoField label="Móvil" mono>
              {dash(card.mobile)}
            </RoField>
            <RoField label="Correo electrónico" mono>
              {card.email || client?.contactoEmail ? (
                <a href={`mailto:${card.email || client.contactoEmail}`} className="odoo-ficha__link">
                  {card.email || client.contactoEmail}
                </a>
              ) : (
                '—'
              )}
            </RoField>
            <RoField label="Sitio web" mono>
              {card.website ? (
                <a href={card.website} target="_blank" rel="noreferrer" className="odoo-ficha__link">
                  {card.website}
                </a>
              ) : (
                '—'
              )}
            </RoField>
            <RoField label="Idioma">{dash(card.lang || 'Español (PE)')}</RoField>
            <RoField label="Etiquetas">
              <span className="odoo-ficha__tags">
                {(card.tagPills || []).map((p) => (
                  <TagPill key={`${p.kind}-${p.id}`} pill={p} />
                ))}
                {!(card.tagPills || []).length && '—'}
              </span>
            </RoField>
          </div>
        </div>
      )}

      <div className="odoo-ficha__tabs" role="tablist">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={'odoo-ficha__tab' + (tab === id ? ' odoo-ficha__tab--on' : '')}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'contactos' && (
        <div className="odoo-ficha__cards">
          {contacts.length === 0 ? (
            <p className="muted mono" style={{ fontSize: 12 }}>
              Sin contactos hijos. En Odoo se agregan desde «Contactos y direcciones».
            </p>
          ) : (
            contacts.map((c) => (
              <div key={c.odooId || c.name} className={'odoo-ficha__card' + (c.selected ? ' odoo-ficha__card--on' : '')}>
                <div className="odoo-ficha__card-av" aria-hidden>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <circle cx="12" cy="8" r="4" />
                    <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
                  </svg>
                </div>
                <div>
                  <div className="odoo-ficha__card-name">{c.name}</div>
                  {c.typeLabel && <div className="muted" style={{ fontSize: 10 }}>{c.typeLabel}</div>}
                  {c.email && (
                    <a href={`mailto:${c.email}`} className="odoo-ficha__link mono" style={{ fontSize: 11 }}>
                      {c.email}
                    </a>
                  )}
                  {(c.phone || c.mobile) && (
                    <div className="muted mono" style={{ fontSize: 11 }}>
                      {[c.phone && `Tel. ${c.phone}`, c.mobile && `Móvil ${c.mobile}`].filter(Boolean).join(' · ')}
                    </div>
                  )}
                  {c.selected && <span className="tag tag--cyan">Seleccionado en cotización</span>}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'ventas' && (
        <div className="odoo-ficha__grid">
          <div>
            <p className="odoo-ficha__section">Ventas</p>
            <RoField label="Vendedor">{dash(card.salesperson)}</RoField>
            <RoField label="Términos de pago">{dash(card.paymentTerm)}</RoField>
            <RoField label="Lista de precios">{dash(card.pricelist)}</RoField>
            <RoField label="Rango cliente" mono>
              {card.customerRank ?? 0}
            </RoField>
          </div>
          <div>
            <p className="odoo-ficha__section">Información fiscal / Perú</p>
            <RoField label="Posición fiscal">{dash(card.fiscalPosition)}</RoField>
            <RoField label="Nº registro MTC" mono>
              {dash(card.mtcNumber)}
            </RoField>
            <RoField label="Entidad emisora">{dash(card.authorizationEntity)}</RoField>
            <RoField label="Nº autorización" mono>
              {dash(card.authorizationNumber)}
            </RoField>
            <RoField label="Industria">{dash(card.industry)}</RoField>
            <RoField label="Referencia" mono>
              {dash(card.ref)}
            </RoField>
            <p className="muted mono" style={{ fontSize: 11, marginTop: 8 }}>
              Pedidos, facturas y cuentas contables se gestionan en Odoo.
            </p>
          </div>
        </div>
      )}

      {tab === 'ficha_ruc' && (
        <div className="odoo-ficha__grid">
          <div>
            <RoField label="Agente retención">
              <BoolSwitch on={rucFicha.agentRetention} />
            </RoField>
            <RoField label="Afecto Nuevo RUS">
              <BoolSwitch on={rucFicha.affectionNewRus} />
            </RoField>
            <RoField label="Agente percepción">
              <BoolSwitch on={rucFicha.agentPerception} />
            </RoField>
            <RoField label="Agente percepción hidrocarburos">
              <BoolSwitch on={rucFicha.hydrocarbonPerceptionAgent} />
            </RoField>
            <RoField label="Buen contribuyente">
              <BoolSwitch on={rucFicha.goodTaxpayer} />
            </RoField>
          </div>
          <div>
            <RoField label="Actividad comercio exterior">{dash(rucFicha.foreignTradeActivity)}</RoField>
            <RoField label="Condición contribuyente">{dash(rucFicha.taxpayerCondition)}</RoField>
            <RoField label="Estado contribuyente">{dash(rucFicha.taxpayerState)}</RoField>
            <p className="muted mono" style={{ fontSize: 11, marginTop: 8 }}>
              Estos datos los llena Consulta SUNAT. No se editan a mano.
            </p>
          </div>
        </div>
      )}

      {tab === 'notas' && (
        <div>
          {editing ? (
            <textarea
              className="form-input form-textarea"
              rows={4}
              value={form.notas}
              onChange={(e) => setForm((f) => ({ ...f, notas: e.target.value }))}
            />
          ) : (
            <p className="odoo-ficha__notes">{card.comment || client?.notas || 'Sin notas internas.'}</p>
          )}
          <RoField label="Advertencia en factura">{dash(card.invoiceWarn === 'no-message' ? 'Sin mensaje' : card.invoiceWarn)}</RoField>
        </div>
      )}

      {tab === 'asignacion' && (
        <div className="odoo-ficha__grid odoo-ficha__grid--single">
          <p className="odoo-ficha__section">Geolocalización</p>
          <RoField label="Latitud" mono>
            {card.latitude != null && Number.isFinite(Number(card.latitude)) ? Number(card.latitude).toFixed(7) : '0.0000000'}
          </RoField>
          <RoField label="Longitud" mono>
            {card.longitude != null && Number.isFinite(Number(card.longitude))
              ? Number(card.longitude).toFixed(7)
              : '0.0000000'}
          </RoField>
        </div>
      )}

      {tab === 'sync' && (
        <div className="odoo-ficha__grid odoo-ficha__grid--single">
          <RoField label="Id Odoo (res.partner)" mono>
            {dash(card.odooId || client?.odooId)}
          </RoField>
          <RoField label="UUID ztrack" mono>
            {dash(client?.xZtrackUid)}
          </RoField>
          <RoField label="Última write_date" mono>
            {card.odooWriteDate || client?.odooWriteDate
              ? new Date(card.odooWriteDate || client.odooWriteDate).toLocaleString('es-PE')
              : '—'}
          </RoField>
          <RoField label="Outbox" mono>
            {client?.outbox ? `${client.outbox.op} · ${client.outbox.status}` : '—'}
          </RoField>
          <RoField label="Estado caché" mono>
            {dash(card.syncStatus)}
          </RoField>
        </div>
      )}
    </div>
  );
}
