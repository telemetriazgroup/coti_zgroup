import React, { useMemo } from 'react';
import { SearchableSelect } from './SearchableSelect';

function emptyRow() {
  return { childItemId: '', qty: '1' };
}

/** Editor de dependencias de ítem (componentes BOM). */
export function CatalogItemDependenciesEditor({
  excludeItemId,
  catalogItems = [],
  value = [],
  onChange,
  disabled = false,
}) {
  const options = useMemo(() => {
    const used = new Set((value || []).map((d) => d.childItemId).filter(Boolean));
    return (catalogItems || [])
      .filter((it) => it.active !== false && it.id !== excludeItemId)
      .map((it) => ({
        value: it.id,
        label: `${it.codigo} — ${it.descripcion}`,
        searchText: [it.codigo, it.descripcion, it.categoryNombre].filter(Boolean).join(' '),
        disabledOption: used.has(it.id),
      }));
  }, [catalogItems, excludeItemId, value]);

  const rows = value?.length ? value : [];

  function updateRow(idx, patch) {
    const next = rows.map((r, i) => (i === idx ? { ...r, ...patch } : r));
    onChange(next);
  }

  function addRow() {
    onChange([...rows, emptyRow()]);
  }

  function removeRow(idx) {
    onChange(rows.filter((_, i) => i !== idx));
  }

  return (
    <div className="catalog-deps-editor">
      <div className="catalog-deps-editor__head">
        <span className="fg-lbl">Dependencias (componentes)</span>
        <span className="muted mono" style={{ fontSize: 11 }}>
          Opcional · cantidad por unidad del ítem principal
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="muted mono" style={{ fontSize: 11, margin: '8px 0' }}>
          Sin dependencias. Al agregar este ítem al presupuesto solo se incluirá el ítem principal.
        </p>
      ) : (
        <ul className="catalog-deps-editor__list">
          {rows.map((row, idx) => (
            <li key={idx} className="catalog-deps-editor__row">
              <SearchableSelect
                className="form-input mono catalog-deps-editor__pick"
                value={row.childItemId}
                onChange={(id) => updateRow(idx, { childItemId: id })}
                options={options.filter((o) => o.value === row.childItemId || !rows.some((r, i) => i !== idx && r.childItemId === o.value))}
                placeholder="Buscar ítem…"
                emptyLabel="Sin ítems"
                disabled={disabled}
              />
              <label className="catalog-deps-editor__qty mono">
                <span className="muted" style={{ fontSize: 10 }}>
                  Cant.
                </span>
                <input
                  type="number"
                  min="0.001"
                  step="any"
                  className="form-input mono"
                  value={row.qty}
                  disabled={disabled}
                  onChange={(e) => updateRow(idx, { qty: e.target.value })}
                />
              </label>
              {!disabled && (
                <button type="button" className="btn-link btn-link--danger mono" onClick={() => removeRow(idx)}>
                  Quitar
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!disabled && (
        <button type="button" className="btn btn-ghost mono" style={{ fontSize: 11, marginTop: 8 }} onClick={addRow}>
          + Agregar dependencia
        </button>
      )}
    </div>
  );
}
