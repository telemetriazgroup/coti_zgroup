import React, { useState } from 'react';

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

/**
 * Ficha de contacto estilo Odoo 17, solo lectura (caché local).
 */
export function ClientOdooFicha({ client, ficha, onClose }) {
  const [tab, setTab] = useState('contactos');
  const card = ficha || {};
  const contacts = Array.isArray(card.contacts) ? card.contacts : [];
  const isCompany = card.isCompany !== false;

  const addrLines = [
    card.street,
    card.street2,
    card.district,
    [card.city, card.state, card.zip].filter(Boolean).join(', '),
    card.country,
  ].filter(Boolean);

  return (
    <div className="odoo-ficha">
      <div className="odoo-ficha__top">
        <div>
          <div className="odoo-ficha__type" role="group" aria-label="Tipo de contacto">
            <span className={'odoo-ficha__type-opt' + (!isCompany ? ' odoo-ficha__type-opt--on' : '')}>Persona</span>
            <span className={'odoo-ficha__type-opt' + (isCompany ? ' odoo-ficha__type-opt--on' : '')}>Empresa</span>
          </div>
          <h2 className="odoo-ficha__name">{card.name || client?.razonSocial || '—'}</h2>
          {client?.syncOrigin === 'local' && <span className="tag tag--warn">No está en Odoo</span>}
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
        {onClose && (
          <button type="button" className="btn btn-ghost odoo-ficha__close" onClick={onClose}>
            Cerrar
          </button>
        )}
      </div>

      <div className="odoo-ficha__grid">
        <div>
          <RoField label="Dirección">
            {addrLines.length ? (
              addrLines.map((line) => (
                <div key={line}>{line}</div>
              ))
            ) : (
              '—'
            )}
          </RoField>
          <RoField label="NIF" mono>
            {card.identificationType ? `${card.identificationType} ` : ''}
            {dash(card.vat)}
          </RoField>
          <button type="button" className="btn btn-ghost odoo-ficha__sunat" disabled title="La consulta SUNAT se hace en Odoo">
            Consulta SUNAT
          </button>
        </div>
        <div>
          <RoField label="Teléfono" mono>
            {dash(card.phone)}
          </RoField>
          <RoField label="Móvil" mono>
            {dash(card.mobile)}
          </RoField>
          <RoField label="Correo electrónico" mono>
            {card.email ? (
              <a href={`mailto:${card.email}`} className="odoo-ficha__link">
                {card.email}
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
          <RoField label="Idioma">{dash(card.lang)}</RoField>
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

      <div className="odoo-ficha__tabs" role="tablist">
        {[
          ['contactos', 'Contactos y direcciones'],
          ['ventas', 'Ventas y compras'],
          ['notas', 'Notas internas'],
          ['sync', 'Sincronización'],
        ].map(([id, label]) => (
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
              Sin contactos hijos en la caché.
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
        <div className="odoo-ficha__grid odoo-ficha__grid--single">
          <RoField label="Rango cliente (customer_rank)" mono>
            {card.customerRank ?? 0}
          </RoField>
          <RoField label="Rango proveedor (supplier_rank)" mono>
            {card.supplierRank ?? 0}
          </RoField>
          <p className="muted mono" style={{ fontSize: 11 }}>
            Solo lectura. Pedidos y tarifas viven en Odoo.
          </p>
        </div>
      )}

      {tab === 'notas' && (
        <p className="odoo-ficha__notes">{card.comment || 'Sin notas internas.'}</p>
      )}

      {tab === 'sync' && (
        <div className="odoo-ficha__grid odoo-ficha__grid--single">
          <RoField label="Id Odoo (res.partner)" mono>
            {dash(card.odooId || client?.odooId)}
          </RoField>
          <RoField label="Última write_date" mono>
            {card.odooWriteDate || client?.odooWriteDate
              ? new Date(card.odooWriteDate || client.odooWriteDate).toLocaleString('es-PE')
              : '—'}
          </RoField>
          <RoField label="Estado caché" mono>
            {dash(card.syncStatus)}
          </RoField>
          <p className="muted mono" style={{ fontSize: 11 }}>
            Alta, edición y archivo hacia Odoo se habilitan cuando esté el módulo en Odoo.sh (etapa 5).
          </p>
        </div>
      )}
    </div>
  );
}
