import { useEffect, useState } from 'react';
import { api } from './api';

let cache = null;

export async function fetchMeasureUnits(includeInactive = false) {
  if (!includeInactive && cache) return cache;
  const qs = includeInactive ? '?includeInactive=true' : '';
  const data = await api.get(`/api/measures${qs}`);
  if (!includeInactive) cache = data;
  return data;
}

export function useMeasureUnits(includeInactive = false) {
  const [units, setUnits] = useState(cache || []);
  const [loading, setLoading] = useState(!cache);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchMeasureUnits(includeInactive)
      .then((data) => {
        if (!cancelled) setUnits(data || []);
      })
      .catch(() => {
        if (!cancelled) setUnits([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [includeInactive]);

  return { units, loading };
}

export function invalidateMeasureUnitsCache() {
  cache = null;
}
