import React from 'react';
import { useMeasureUnits } from '../lib/measureUnits';

/** Select de medidas (sufijo + nombre). */
export function MeasureUnitSelect({ id, className = 'form-input', value, onChange, required, disabled, allowEmpty }) {
  const { units, loading } = useMeasureUnits(false);

  return (
    <select
      id={id}
      className={className}
      required={required}
      disabled={disabled || loading}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {allowEmpty && <option value="">—</option>}
      {units.map((u) => (
        <option key={u.id} value={u.suffix}>
          {u.suffix} — {u.nombre}
        </option>
      ))}
      {value && !units.some((u) => u.suffix === value) && (
        <option value={value}>{value} (legacy)</option>
      )}
    </select>
  );
}
