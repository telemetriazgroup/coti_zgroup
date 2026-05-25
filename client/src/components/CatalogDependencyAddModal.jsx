import React, { useEffect, useState } from 'react';
import { Modal } from './Modal';

function formatUsd(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return '—';
  return x.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
}

/** Modal al agregar ítem con dependencias al presupuesto. */
export function CatalogDependencyAddModal({ open, bundle, onClose, onConfirm, busy = false }) {
  const [lines, setLines] = useState([]);

  useEffect(() => {
    if (open && bundle?.lines) {
      setLines(bundle.lines.map((l) => ({ ...l })));
    }
  }, [open, bundle]);

  if (!open || !bundle) return null;

  function toggleLine(catalogItemId) {
    setLines((prev) =>
      prev.map((l) =>
        l.catalogItemId === catalogItemId && !l.required ? { ...l, included: !l.included } : l
      )
    );
  }

  function submit(e) {
    e.preventDefault();
    const selected = lines.filter((l) => l.included);
    onConfirm(selected);
  }

  return (
    <Modal
      wide
      title="Componentes del ítem"
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" form="catalog-dep-add-form" className="btn btn-primary" disabled={busy}>
            {busy ? 'Agregando…' : 'Agregar al presupuesto'}
          </button>
        </>
      }
    >
      <p className="muted mono" style={{ fontSize: 12, marginBottom: 12, lineHeight: 1.45 }}>
        Este ítem tiene componentes configurados. Marque cuáles desea incluir en el presupuesto. Las cantidades
        se calculan según la cantidad del ítem principal y las dependencias del catálogo (incluye sub-componentes).
      </p>
      <form id="catalog-dep-add-form" onSubmit={submit}>
        <div className="table-wrap">
          <table className="data-table data-table--compact">
            <thead>
              <tr>
                <th style={{ width: 36 }} />
                <th>Código</th>
                <th>Descripción</th>
                <th className="num">Cant.</th>
                <th className="num">P. unit.</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.catalogItemId} className={l.isMain ? 'catalog-dep-row--main' : ''}>
                  <td>
                    <input
                      type="checkbox"
                      checked={l.included}
                      disabled={l.required || busy}
                      onChange={() => toggleLine(l.catalogItemId)}
                      title={l.required ? 'Ítem principal (obligatorio)' : undefined}
                    />
                  </td>
                  <td className="mono">
                    {l.codigo}
                    {l.isMain && (
                      <span className="tag tag--ok" style={{ marginLeft: 6, fontSize: 9 }}>
                        principal
                      </span>
                    )}
                  </td>
                  <td>{l.descripcion}</td>
                  <td className="num mono">{l.qty}</td>
                  <td className="num mono">{formatUsd(l.unitPrice)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </form>
    </Modal>
  );
}
