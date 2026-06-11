import React, { useEffect, useState } from 'react';
import { Modal } from './Modal';

function formatUsd(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return '—';
  return x.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
}

/** Modal al agregar ítem con dependencias al presupuesto. */
export function CatalogDependencyAddModal({ open, bundle, onClose, onConfirm, busy = false, hidePrices = false }) {
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
    const row = lines.find((l) => l.catalogItemId === catalogItemId);
    if (row?.isMain) return;
    setPickErr(null);
    setLines((prev) =>
      prev.map((l) => (l.catalogItemId === catalogItemId ? { ...l, included: !l.included } : l))
    );
  }

  function setLineQty(catalogItemId, rawQty) {
    setPickErr(null);
    setLines((prev) =>
      prev.map((l) => {
        if (l.catalogItemId !== catalogItemId) return l;
        return { ...l, qty: rawQty };
      })
    );
  }

  function setAllIncluded(included) {
    setPickErr(null);
    setLines((prev) => prev.map((l) => (l.isMain ? l : { ...l, included })));
  }

  const depLines = lines.filter((l) => !l.isMain);

  function submit(e) {
    e.preventDefault();
    const main = lines.find((l) => l.isMain);
    if (!main) {
      setPickErr('No se encontró el ítem principal.');
      return;
    }
    const mainQty = parseFloat(String(main.qty).replace(',', '.'));
    if (!Number.isFinite(mainQty) || mainQty < 0.001) {
      setPickErr('Cantidad del ítem principal inválida.');
      return;
    }
    const selected = [{ ...main, qty: mainQty, included: true }];
    for (const l of lines) {
      if (l.isMain || !l.included) continue;
      const q = parseFloat(String(l.qty).replace(',', '.'));
      if (!Number.isFinite(q) || q < 0.001) {
        setPickErr(`Cantidad inválida en ${l.codigo || 'dependencia'}.`);
        return;
      }
      selected.push({ ...l, qty: q });
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
        El ítem principal siempre se agrega. Marque las dependencias opcionales que desee incluir (puede elegir
        ninguna, una o varias) y ajuste las cantidades antes de confirmar.
      </p>
      {pickErr && (
        <div className="banner banner--err mono" style={{ marginBottom: 12 }}>
          {pickErr}
        </div>
      )}
      <form id="catalog-dep-add-form" onSubmit={submit}>
        {depLines.length > 0 && (
          <div className="dep-bulk-actions">
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy}
              onClick={() => setAllIncluded(true)}
            >
              Seleccionar todo
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy}
              onClick={() => setAllIncluded(false)}
            >
              Quitar todo
            </button>
          </div>
        )}
        <div className="table-wrap">
          <table className="data-table data-table--compact">
            <thead>
              <tr>
                <th style={{ width: 36 }} title="Incluir dependencia">
                  +
                </th>
                <th>Código</th>
                <th>Descripción</th>
                <th className="num">Cant.</th>
                {!hidePrices && <th className="num">P. unit.</th>}
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.catalogItemId} className={l.isMain ? 'catalog-dep-row--main' : ''}>
                  <td>
                    <input
                      type="checkbox"
                      checked={l.isMain ? true : l.included}
                      disabled={busy || l.isMain}
                      onChange={() => toggleLine(l.catalogItemId)}
                      title={l.isMain ? 'Ítem principal (siempre incluido)' : 'Incluir dependencia'}
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
                  <td className="num">
                    <input
                      type="number"
                      min="0.001"
                      step="any"
                      className="form-input table-input mono"
                      style={{ width: 72 }}
                      value={l.qty}
                      disabled={busy || (!l.isMain && !l.included)}
                      onChange={(e) => setLineQty(l.catalogItemId, e.target.value)}
                    />
                  </td>
                  {!hidePrices && <td className="num mono">{formatUsd(l.unitPrice)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </form>
    </Modal>
  );
}
