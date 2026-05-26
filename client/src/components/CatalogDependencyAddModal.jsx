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
  const [pickErr, setPickErr] = useState(null);

  useEffect(() => {
    if (open && bundle?.lines) {
      setLines(bundle.lines.map((l) => ({ ...l })));
      setPickErr(null);
    }
  }, [open, bundle]);

  if (!open || !bundle) return null;

  function toggleLine(catalogItemId) {
    setPickErr(null);
    setLines((prev) =>
      prev.map((l) => (l.catalogItemId === catalogItemId ? { ...l, included: !l.included } : l))
    );
  }

  function submit(e) {
    e.preventDefault();
    const selected = lines.filter((l) => l.included);
    if (selected.length === 0) {
      setPickErr('Seleccione al menos un ítem para agregar.');
      return;
    }
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
        Por defecto solo se agrega el ítem principal (primera fila). Marque el check de otros componentes si
        también desea incluirlos. Las cantidades se calculan según la cantidad del principal y las dependencias
        del catálogo.
      </p>
      {pickErr && (
        <div className="banner banner--err mono" style={{ marginBottom: 12 }}>
          {pickErr}
        </div>
      )}
      <form id="catalog-dep-add-form" onSubmit={submit}>
        <div className="table-wrap">
          <table className="data-table data-table--compact">
            <thead>
              <tr>
                <th style={{ width: 36 }} title="Incluir en presupuesto">
                  +
                </th>
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
                      disabled={busy}
                      onChange={() => toggleLine(l.catalogItemId)}
                      title={l.isMain ? 'Ítem principal (marcado por defecto)' : 'Incluir componente'}
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
