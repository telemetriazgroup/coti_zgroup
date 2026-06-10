import React, { useEffect, useMemo, useState } from 'react';
import { Modal } from './Modal';
import { SearchableSelect } from './SearchableSelect';

function formatUsd(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return '—';
  return x.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
}

function buildDisplayNameClient(baseDesc, instanceLabel) {
  const base = String(baseDesc || '').trim();
  const label = String(instanceLabel || '').trim();
  if (!label) return base;
  if (!base) return label;
  return `${label} - ${base}`;
}

/** Modal al agregar o editar producto final (KIT) en presupuesto. */
export function KitInstanceModal({
  open,
  template,
  suggestedLabel = 'ZONA 1',
  editMode = false,
  catalogItems = [],
  onClose,
  onConfirm,
  busy = false,
  hidePrices = false,
}) {
  const [lines, setLines] = useState([]);
  const [instanceLabel, setInstanceLabel] = useState('ZONA 1');
  const [displayName, setDisplayName] = useState('');
  const [displayEdited, setDisplayEdited] = useState(false);
  const [addItemId, setAddItemId] = useState('');
  const [pickErr, setPickErr] = useState(null);

  useEffect(() => {
    if (open && template) {
      setLines((template.lines || []).map((l) => ({ ...l })));
      if (editMode) {
        setInstanceLabel(template.instanceLabel || suggestedLabel || 'ZONA 1');
        setDisplayName(template.displayName || '');
        setDisplayEdited(true);
      } else {
        setInstanceLabel(suggestedLabel || 'ZONA 1');
        setDisplayName(buildDisplayNameClient(template.descripcion, suggestedLabel || 'ZONA 1'));
        setDisplayEdited(false);
      }
      setAddItemId('');
      setPickErr(null);
    }
  }, [open, template, suggestedLabel, editMode]);

  useEffect(() => {
    if (!open || !template || displayEdited || editMode) return;
    setDisplayName(buildDisplayNameClient(template.descripcion, instanceLabel));
  }, [open, template, instanceLabel, displayEdited, editMode]);

  const total = useMemo(() => {
    const included = lines.filter((l) => l.included !== false);
    return Math.round(included.reduce((s, l) => s + Number(l.qty) * Number(l.unitPrice), 0) * 100) / 100;
  }, [lines]);

  const addOptions = useMemo(() => {
    const used = new Set(lines.map((l) => l.catalogItemId));
    return (catalogItems || [])
      .filter((it) => it.active !== false && !it.isKit && it.id !== template?.catalogItemId)
      .map((it) => ({
        value: it.id,
        label: `${it.codigo} — ${it.descripcion}`,
        searchText: [it.codigo, it.descripcion, it.categoryNombre].filter(Boolean).join(' '),
        disabledOption: used.has(it.id),
      }));
  }, [catalogItems, lines, template?.catalogItemId]);

  if (!open || !template) return null;

  function toggleLine(catalogItemId) {
    setPickErr(null);
    setLines((prev) =>
      prev.map((l) => (l.catalogItemId === catalogItemId ? { ...l, included: !l.included } : l))
    );
  }

  function setLineQty(catalogItemId, qty) {
    setLines((prev) =>
      prev.map((l) => (l.catalogItemId === catalogItemId ? { ...l, qty } : l))
    );
  }

  function addExtraLine() {
    if (!addItemId) return;
    const it = catalogItems.find((x) => x.id === addItemId);
    if (!it) return;
    if (lines.some((l) => l.catalogItemId === addItemId)) {
      setPickErr('Ese ítem ya está en la lista.');
      return;
    }
    setPickErr(null);
    setLines((prev) => [
      ...prev,
      {
        catalogItemId: it.id,
        codigo: it.codigo,
        descripcion: it.descripcion,
        unidad: it.unidad,
        tipo: it.tipo,
        unitPrice: Number(it.unitPrice) || 0,
        qty: 1,
        included: true,
        fromTemplate: false,
      },
    ]);
    setAddItemId('');
  }

  function removeLine(catalogItemId) {
    setLines((prev) => prev.filter((l) => l.catalogItemId !== catalogItemId));
  }

  function submit(e) {
    e.preventDefault();
    const selected = lines.filter((l) => l.included !== false);
    if (selected.length === 0) {
      setPickErr('Seleccione al menos un componente para el conjunto.');
      return;
    }
    const label = instanceLabel.trim() || 'ZONA 1';
    const name = displayName.trim() || buildDisplayNameClient(template.descripcion, label);
    onConfirm({
      instanceLabel: label,
      displayName: name,
      qty: template.mainQty || 1,
      lines: selected.map((l) => ({
        catalogItemId: l.catalogItemId,
        qty: Number(l.qty) || 0,
        ...(hidePrices ? {} : { unitPrice: Number(l.unitPrice) }),
        included: true,
      })),
      ...(hidePrices ? {} : { unitPrice: total }),
    });
  }

  return (
    <Modal
      wide
      title={`${editMode ? 'Editar conjunto' : 'Producto final'} — ${template.descripcion}`}
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" form="kit-instance-form" className="btn btn-primary" disabled={busy}>
            {busy
              ? editMode
                ? 'Guardando…'
                : 'Agregando…'
              : editMode
                ? hidePrices
                  ? 'Guardar cambios'
                  : `Guardar cambios (${formatUsd(total)})`
                : hidePrices
                  ? 'Agregar conjunto'
                  : `Agregar conjunto (${formatUsd(total)})`}
          </button>
        </>
      }
    >
      <p className="muted mono" style={{ fontSize: 12, marginBottom: 12, lineHeight: 1.45 }}>
        {editMode
          ? hidePrices
            ? 'Modifique componentes, cantidades o agregue ítems al conjunto.'
            : 'Modifique componentes, cantidades o agregue ítems al conjunto. El precio se recalcula automáticamente.'
          : hidePrices
            ? 'Configure los componentes de esta instancia. Marque o desmarque cada fila para incluirla en el conjunto.'
            : 'Configure los componentes de esta instancia. Marque o desmarque cada fila; el precio del conjunto es la suma de los componentes seleccionados.'}
      </p>
      <div className="stack-form" style={{ marginBottom: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label>
            <span className="fg-lbl">Etiqueta instancia (zona)</span>
            <input
              className="form-input mono"
              value={instanceLabel}
              disabled={busy}
              placeholder="ZONA 1, ZONA 2…"
              onChange={(e) => {
                setInstanceLabel(e.target.value);
                if (!displayEdited) {
                  setDisplayName(buildDisplayNameClient(template.descripcion, e.target.value));
                }
              }}
            />
          </label>
          <label>
            <span className="fg-lbl">Nombre en presupuesto</span>
            <input
              className="form-input"
              value={displayName}
              disabled={busy}
              onChange={(e) => {
                setDisplayEdited(true);
                setDisplayName(e.target.value);
              }}
            />
          </label>
        </div>
      </div>
      {pickErr && (
        <div className="banner banner--err mono" style={{ marginBottom: 12 }}>
          {pickErr}
        </div>
      )}
      <form id="kit-instance-form" onSubmit={submit}>
        <div className="table-wrap">
          <table className="data-table data-table--compact">
            <thead>
              <tr>
                <th style={{ width: 36 }}>+</th>
                <th>Código</th>
                <th>Descripción</th>
                <th className="num">Cant.</th>
                {!hidePrices && <th className="num">P. unit.</th>}
                {!hidePrices && <th className="num">Subtotal</th>}
                <th style={{ width: 36 }} />
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const sub = (Number(l.qty) || 0) * (Number(l.unitPrice) || 0);
                return (
                  <tr key={l.catalogItemId} className={l.included === false ? 'kit-line--off' : ''}>
                    <td>
                      <input
                        type="checkbox"
                        checked={l.included !== false}
                        disabled={busy}
                        onChange={() => toggleLine(l.catalogItemId)}
                      />
                    </td>
                    <td className="mono">{l.codigo}</td>
                    <td>{l.descripcion}</td>
                    <td className="num">
                      <input
                        type="number"
                        min="0.001"
                        step="any"
                        className="form-input table-input mono"
                        style={{ width: 72 }}
                        value={l.qty}
                        disabled={busy || l.included === false}
                        onChange={(e) => setLineQty(l.catalogItemId, e.target.value)}
                      />
                    </td>
                    {!hidePrices && <td className="num mono">{formatUsd(l.unitPrice)}</td>}
                    {!hidePrices && (
                      <td className="num mono">{l.included !== false ? formatUsd(sub) : '—'}</td>
                    )}
                    <td>
                      {(editMode || !l.fromTemplate) && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-icon"
                          disabled={busy}
                          title="Quitar del conjunto"
                          onClick={() => removeLine(l.catalogItemId)}
                        >
                          ×
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="kit-instance-add" style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <label style={{ flex: 1 }}>
            <span className="fg-lbl">Agregar componente extra</span>
            <SearchableSelect
              className="form-input mono"
              value={addItemId}
              onChange={setAddItemId}
              options={addOptions}
              placeholder="Buscar ítem del catálogo…"
              emptyLabel="Sin ítems"
              disabled={busy}
            />
          </label>
          <button type="button" className="btn btn-ghost" disabled={busy || !addItemId} onClick={addExtraLine}>
            + Agregar
          </button>
        </div>
      </form>
    </Modal>
  );
}
