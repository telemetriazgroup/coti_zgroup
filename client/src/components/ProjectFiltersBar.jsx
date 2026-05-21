import React, { useEffect, useMemo, useState } from 'react';

function buildQuery(filters, includeDeleted, isAdmin, isSuperuser) {
  const p = new URLSearchParams();
  if ((isSuperuser || isAdmin) && includeDeleted) p.set('includeDeleted', 'true');
  if (filters.q.trim()) p.set('q', filters.q.trim());
  if (filters.clientId) p.set('clientId', filters.clientId);
  if (filters.createdBy) p.set('createdBy', filters.createdBy);
  if (filters.dateFrom) p.set('dateFrom', filters.dateFrom);
  if (filters.dateTo) p.set('dateTo', filters.dateTo);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function useProjectListFilters({ includeDeleted, isAdmin, isSuperuser }) {
  const [filters, setFilters] = useState({
    q: '',
    clientId: '',
    createdBy: '',
    dateFrom: '',
    dateTo: '',
  });
  const [debounced, setDebounced] = useState(filters);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(filters), 300);
    return () => clearTimeout(t);
  }, [filters]);

  const query = useMemo(
    () => buildQuery(debounced, includeDeleted, isAdmin, isSuperuser),
    [debounced, includeDeleted, isAdmin, isSuperuser]
  );

  return { filters, setFilters, query };
}

export function ProjectFiltersBar({ filters, setFilters, clients, creators, showCreatorFilter }) {
  return (
    <div className="projects-filters panel" style={{ padding: 12, marginBottom: 14 }}>
      <div className="projects-filters__grid">
        <label>
          <span className="fg-lbl">Nombre / Odoo</span>
          <input
            type="search"
            className="form-input"
            placeholder="Buscar proyecto…"
            value={filters.q}
            onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
          />
        </label>
        <label>
          <span className="fg-lbl">Cliente</span>
          <select
            className="form-input"
            value={filters.clientId}
            onChange={(e) => setFilters((f) => ({ ...f, clientId: e.target.value }))}
          >
            <option value="">Todos</option>
            {(clients || []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.razonSocial}
              </option>
            ))}
          </select>
        </label>
        {showCreatorFilter && (
          <label>
            <span className="fg-lbl">Creador</span>
            <select
              className="form-input"
              value={filters.createdBy}
              onChange={(e) => setFilters((f) => ({ ...f, createdBy: e.target.value }))}
            >
              <option value="">Todos</option>
              {(creators || []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          <span className="fg-lbl">Desde</span>
          <input
            type="date"
            className="form-input mono"
            value={filters.dateFrom}
            onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))}
          />
        </label>
        <label>
          <span className="fg-lbl">Hasta</span>
          <input
            type="date"
            className="form-input mono"
            value={filters.dateTo}
            onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))}
          />
        </label>
        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
          <button
            type="button"
            className="btn btn-ghost mono"
            onClick={() =>
              setFilters({ q: '', clientId: '', createdBy: '', dateFrom: '', dateTo: '' })
            }
          >
            Limpiar filtros
          </button>
        </div>
      </div>
    </div>
  );
}

export function extractProjectCreators(projects) {
  const map = new Map();
  for (const p of projects || []) {
    if (!p.createdBy) continue;
    if (!map.has(p.createdBy)) {
      map.set(p.createdBy, {
        id: p.createdBy,
        label: p.createdByName || p.createdByEmail || p.createdBy.slice(0, 8),
      });
    }
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
}
