import React, { useEffect, useMemo, useState, Fragment } from 'react';
import { CatalogDependencyAddModal } from './CatalogDependencyAddModal';
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

function kitBaseFromTemplate(template) {
  if (!template) return '';
  if (template.kitBaseDesc) return String(template.kitBaseDesc).trim();
  const desc = String(template.descripcion || '').trim();
  const label = String(template.instanceLabel || '').trim();
  if (label && desc.startsWith(`${label} - `)) {
    return desc.slice(label.length + 3).trim();
  }
  return desc;
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
  fetchDependencyBundle,
  busy = false,
  hidePrices = false,
}) {
  const [lines, setLines] = useState([]);
  const [instanceLabel, setInstanceLabel] = useState('ZONA 1');
  const [displayName, setDisplayName] = useState('');
  const [addItemId, setAddItemId] = useState('');
  const [pickErr, setPickErr] = useState(null);
  const [extraAddBusy, setExtraAddBusy] = useState(false);
  const [pendingExtraDep, setPendingExtraDep] = useState(null);

  const kitBase = useMemo(() => kitBaseFromTemplate(template), [template]);

  useEffect(() => {
    if (open && template) {
      setLines((template.lines || []).map((l) => ({ ...l })));
      const initLabel =
        (editMode ? template.instanceLabel : suggestedLabel) || suggestedLabel || 'ZONA 1';
      setInstanceLabel(initLabel);
      setDisplayName(buildDisplayNameClient(kitBase, initLabel));
      setAddItemId('');
      setPickErr(null);
    }
  }, [open, template, suggestedLabel, editMode, kitBase]);

  useEffect(() => {
    if (!open || !template) return;
    setDisplayName(buildDisplayNameClient(kitBase, instanceLabel));
  }, [open, template, kitBase, instanceLabel]);

  const total = useMemo(() => {
    const included = lines.filter((l) => l.included !== false);
    return Math.round(included.reduce((s, l) => s + Number(l.qty) * Number(l.unitPrice), 0) * 100) / 100;
  }, [lines]);

  const consolidatedPreview = useMemo(() => {
    const map = new Map();
    for (const l of lines) {
      if (l.included === false) continue;
      const k = l.catalogItemId;
      const q = Number(l.qty) || 0;
      if (!map.has(k)) {
        map.set(k, { codigo: l.codigo, descripcion: l.descripcion, qty: q });
      } else {
        const ex = map.get(k);
        ex.qty = Math.round((ex.qty + q) * 1000) / 1000;
      }
    }
    return [...map.values()].sort((a, b) => String(a.codigo || '').localeCompare(String(b.codigo || '')));
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

  function lineKey(l, idx) {
    if (l.lineId) return `id:${l.lineId}`;
    return `${l.catalogItemId}::${l.componentGroupKey || 'template'}::${l.componentGroupSort ?? 0}::${idx}`;
  }

  function toggleLine(key) {
    setPickErr(null);
    setLines((prev) =>
      prev.map((l, i) => (lineKey(l, i) === key ? { ...l, included: !l.included } : l))
    );
  }

  function setLineQty(key, qty) {
    setPickErr(null);
    setLines((prev) => prev.map((l, i) => (lineKey(l, i) === key ? { ...l, qty } : l)));
  }

  function setAllIncluded(included) {
    setPickErr(null);
    setLines((prev) => prev.map((l) => ({ ...l, included })));
  }

  function maxGroupSort(list) {
    return (list || []).reduce((m, l) => Math.max(m, Number(l.componentGroupSort) || 0), 0);
  }

  function mapLinePayload(l) {
    return {
      catalogItemId: l.catalogItemId,
      codigo: l.codigo,
      descripcion: l.descripcion,
      unidad: l.unidad,
      tipo: l.tipo,
      unitPrice: Number(l.unitPrice) || 0,
      qty: Number(l.qty) || 1,
      included: l.included !== false,
      fromTemplate: l.fromTemplate === true,
      componentGroupKey: l.componentGroupKey || 'template',
      componentGroupLabel: l.componentGroupLabel || null,
      componentGroupSort: Number(l.componentGroupSort) || 0,
    };
  }

  function appendExtraLines(selectedLines, { groupKey, groupLabel, groupSort, warnDuplicates = true } = {}) {
    const dupCodes = [];
    for (const l of selectedLines) {
      if (lines.some((x) => x.catalogItemId === l.catalogItemId)) {
        dupCodes.push(l.codigo || l.descripcion || 'ítem');
      }
    }
    if (warnDuplicates && dupCodes.length) {
      setPickErr(
        `Aviso: se agregarán ítems duplicados (${[...new Set(dupCodes)].join(', ')}). En presupuesto consolidado se sumarán las cantidades.`
      );
    } else {
      setPickErr(null);
    }
    setLines((prev) => [
      ...prev,
      ...selectedLines.map((l) =>
        mapLinePayload({
          ...l,
          included: true,
          fromTemplate: false,
          componentGroupKey: groupKey || l.componentGroupKey || `extra-${l.catalogItemId}`,
          componentGroupLabel: groupLabel || l.componentGroupLabel || l.descripcion,
          componentGroupSort: groupSort != null ? groupSort : maxGroupSort(prev) + 1,
        })
      ),
    ]);
    return true;
  }

  async function addExtraLine() {
    if (!addItemId || extraAddBusy) return;
    const it = catalogItems.find((x) => x.id === addItemId);
    if (!it) return;
    if (lines.some((l) => l.catalogItemId === addItemId)) {
      setPickErr('Ese ítem ya está en la lista. Puede agregarlo en otro sub-grupo; se mostrará aviso de duplicado.');
    }

    const depCount = Number(it.dependencyCount) || 0;
    const hasDeps = depCount > 0 || it.hasDependencies === true;

    if (hasDeps && fetchDependencyBundle) {
      setExtraAddBusy(true);
      setPickErr(null);
      try {
        const bundle = await fetchDependencyBundle(it.id, 1);
        const hasOptionalDeps = (bundle?.lines || []).some((l) => !l.isMain);
        if (hasOptionalDeps) {
          setPendingExtraDep({ bundle });
          setAddItemId('');
          return;
        }
      } catch (e) {
        setPickErr(e.message || 'No se pudieron cargar las dependencias.');
        return;
      } finally {
        setExtraAddBusy(false);
      }
    }

    setPickErr(null);
    const groupSort = maxGroupSort(lines) + 1;
    appendExtraLines(
      [
        {
          catalogItemId: it.id,
          codigo: it.codigo,
          descripcion: it.descripcion,
          unidad: it.unidad,
          tipo: it.tipo,
          unitPrice: Number(it.unitPrice) || 0,
          qty: 1,
        },
      ],
      {
        groupKey: `extra-${it.id}-${Date.now()}`,
        groupLabel: it.descripcion,
        groupSort,
        warnDuplicates: true,
      }
    );
    setAddItemId('');
  }

  function confirmExtraDepAdd(selectedLines) {
    const main = selectedLines.find((l) => l.isMain) || selectedLines[0];
    const groupKey = `extra-${main?.catalogItemId || 'dep'}-${Date.now()}`;
    const groupLabel = main?.descripcion || main?.codigo || 'Componente extra';
    const groupSort = maxGroupSort(lines) + 1;
    const rows = selectedLines.map((l) => ({
      catalogItemId: l.catalogItemId,
      codigo: l.codigo,
      descripcion: l.descripcion,
      unidad: l.unidad,
      tipo: l.tipo,
      unitPrice: l.unitPrice,
      qty: l.qty,
    }));
    if (appendExtraLines(rows, { groupKey, groupLabel, groupSort, warnDuplicates: true })) {
      setPendingExtraDep(null);
    }
  }

  function removeLine(key) {
    setLines((prev) => prev.filter((l, i) => lineKey(l, i) !== key));
  }

  function submit(e) {
    e.preventDefault();
    const selected = [];
    for (const l of lines) {
      if (l.included === false) continue;
      const q = parseFloat(String(l.qty).replace(',', '.'));
      if (!Number.isFinite(q) || q < 0.001) {
        setPickErr(`Cantidad inválida en ${l.codigo || 'dependencia'}.`);
        return;
      }
      selected.push({
        catalogItemId: l.catalogItemId,
        qty: q,
        componentGroupKey: l.componentGroupKey || 'template',
        componentGroupLabel: l.componentGroupLabel || null,
        componentGroupSort: Number(l.componentGroupSort) || 0,
        ...(hidePrices ? {} : { unitPrice: Number(l.unitPrice) }),
        included: true,
      });
    }
    const label = instanceLabel.trim();
    if (!label) {
      setPickErr('Indique una etiqueta de instancia (zona).');
      return;
    }
    if (label.length > 50) {
      setPickErr('La etiqueta no puede superar 50 caracteres.');
      return;
    }
    const name = buildDisplayNameClient(kitBase, label);
    onConfirm({
      instanceLabel: label,
      displayName: name,
      qty: template.mainQty || 1,
      lines: selected,
      ...(hidePrices ? {} : { unitPrice: total }),
    });
  }

  const helpText = editMode
    ? hidePrices
      ? 'Edite sub-grupos (plantilla y extras con dependencias). Abajo ve la vista consolidada que se mostrará en el presupuesto.'
      : 'Edite sub-grupos con colores por bloque. Abajo: vista consolidada (cantidades sumadas por código) como en el presupuesto.'
    : hidePrices
      ? 'Marque dependencias opcionales y agregue extras. Abajo ve la vista consolidada del conjunto en el presupuesto.'
      : 'Marque dependencias opcionales y agregue extras. Abajo: vista consolidada (cantidades sumadas) como aparecerá en el presupuesto.';

  return (
    <>
    <Modal
      wide
      panelClassName="modal-panel--kit"
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
        {helpText}
      </p>
      <div className="stack-form" style={{ marginBottom: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label>
            <span className="fg-lbl">Etiqueta instancia (zona)</span>
            <input
              className="form-input mono"
              value={instanceLabel}
              disabled={busy}
              maxLength={50}
              placeholder="ZONA 1, Bodega A, Sala fría…"
              onChange={(e) => {
                setPickErr(null);
                setInstanceLabel(e.target.value);
              }}
            />
          </label>
          <label>
            <span className="fg-lbl">Nombre en presupuesto</span>
            <input
              className="form-input"
              value={displayName}
              disabled
              readOnly
              title="Se genera como: etiqueta — nombre del producto final"
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
        {lines.length > 0 && (
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
                {!hidePrices && <th className="num">Subtotal</th>}
                <th style={{ width: 36 }} />
              </tr>
            </thead>
            <tbody>
              <tr className="catalog-dep-row--main">
                <td>
                  <input
                    type="checkbox"
                    checked
                    disabled
                    title="Producto final (siempre incluido)"
                  />
                </td>
                <td className="mono">
                  {template.codigo}
                  <span className="tag tag--ok" style={{ marginLeft: 6, fontSize: 9 }}>
                    principal
                  </span>
                </td>
                <td>{template.descripcion}</td>
                <td className="num mono">{template.mainQty || 1}</td>
                {!hidePrices && <td className="num mono">—</td>}
                {!hidePrices && <td className="num mono">—</td>}
                <td />
              </tr>
              {lines.map((l, idx) => {
                const sub = (Number(l.qty) || 0) * (Number(l.unitPrice) || 0);
                const groupSort = Number(l.componentGroupSort) || 0;
                const subClass =
                  groupSort > 0 ? ` kit-modal-sub-${((groupSort - 1) % 4) + 1}` : '';
                const key = lineKey(l, idx);
                const prev = idx > 0 ? lines[idx - 1] : null;
                const groupSig = `${l.componentGroupKey || 'template'}::${groupSort}`;
                const prevSig = prev
                  ? `${prev.componentGroupKey || 'template'}::${Number(prev.componentGroupSort) || 0}`
                  : null;
                const showGroupHdr = groupSort > 0 && groupSig !== prevSig;
                return (
                  <Fragment key={key}>
                    {showGroupHdr && (
                      <tr className={`kit-modal-group-hdr${subClass}`}>
                        <td colSpan={hidePrices ? 5 : 7}>
                          {l.componentGroupLabel || `Sub-grupo ${groupSort}`}
                        </td>
                      </tr>
                    )}
                    <tr className={(l.included === false ? 'kit-line--off' : '') + subClass}>
                      <td>
                        <input
                          type="checkbox"
                          checked={l.included !== false}
                          disabled={busy}
                          onChange={() => toggleLine(key)}
                          title="Incluir dependencia"
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
                          onChange={(e) => setLineQty(key, e.target.value)}
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
                            onClick={() => removeLine(key)}
                          >
                            ×
                          </button>
                        )}
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {consolidatedPreview.length > 0 && (
          <div className="kit-modal-consolidated" style={{ marginTop: 14 }}>
            <span className="fg-lbl">Vista consolidada (presupuesto)</span>
            <div className="table-wrap" style={{ marginTop: 6 }}>
              <table className="data-table data-table--compact">
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Descripción</th>
                    <th className="num">Cant.</th>
                  </tr>
                </thead>
                <tbody>
                  {consolidatedPreview.map((r) => (
                    <tr key={`${r.codigo}-${r.qty}`}>
                      <td className="mono">{r.codigo}</td>
                      <td>{r.descripcion}</td>
                      <td className="num mono">{r.qty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
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
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy || extraAddBusy || !addItemId}
            onClick={addExtraLine}
          >
            {extraAddBusy ? 'Cargando…' : '+ Agregar'}
          </button>
        </div>
      </form>
    </Modal>

      <CatalogDependencyAddModal
        open={!!pendingExtraDep}
        bundle={pendingExtraDep?.bundle}
        busy={false}
        hidePrices={hidePrices}
        onClose={() => setPendingExtraDep(null)}
        onConfirm={confirmExtraDepAdd}
      />
    </>
  );
}
