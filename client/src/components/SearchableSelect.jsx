import React, { useEffect, useMemo, useRef, useState } from 'react';

/** Select con búsqueda por texto (combobox). */
export function SearchableSelect({
  id,
  className = 'form-input',
  value,
  onChange,
  options = [],
  placeholder = 'Buscar…',
  emptyLabel = 'Sin coincidencias',
  disabled = false,
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const wrapRef = useRef(null);

  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) {
      setQ(selected?.label || '');
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
    if (!qq) return options;
    return options.filter(
      (o) =>
        (o.label && o.label.toLowerCase().includes(qq)) ||
        (o.searchText && o.searchText.toLowerCase().includes(qq))
    );
  }, [options, q]);

  function pick(opt) {
    onChange(opt.value);
    setQ(opt.label);
    setOpen(false);
  }

  return (
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
        }}
        onFocus={() => setOpen(true)}
        autoComplete="off"
      />
      {open && !disabled && (
        <ul className="searchable-select__list zgroup-scroll" role="listbox">
          {filtered.length === 0 ? (
            <li className="searchable-select__empty muted">{emptyLabel}</li>
          ) : (
            filtered.map((o) => (
              <li key={o.value}>
                <button
                  type="button"
                  className={
                    'searchable-select__opt' + (o.value === value ? ' searchable-select__opt--active' : '')
                  }
                  onClick={() => pick(o)}
                >
                  {o.label}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
