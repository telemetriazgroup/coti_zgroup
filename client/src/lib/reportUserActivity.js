import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../lib/api';

function activityFromPath(pathname) {
  const m = String(pathname || '').match(/^\/projects\/([^/]+)\/(presupuesto|planos)$/);
  if (m) {
    const kind = m[2] === 'planos' ? 'PLANOS' : 'PRESUPUESTO';
    return {
      kind,
      projectId: m[1],
      summary: kind === 'PLANOS' ? 'Viendo planos' : 'Trabajando en presupuesto',
      path: pathname,
    };
  }
  if (pathname === '/projects') {
    return { kind: 'LISTA_PROYECTOS', summary: 'Lista de proyectos', path: pathname };
  }
  if (pathname === '/dashboard' || pathname === '/') {
    return { kind: 'DASHBOARD', summary: 'Dashboard', path: pathname };
  }
  if (pathname.startsWith('/catalog')) {
    return { kind: 'CATALOGO', summary: 'Catálogo', path: pathname };
  }
  if (pathname.startsWith('/clients')) {
    return { kind: 'CLIENTES', summary: 'Clientes', path: pathname };
  }
  if (pathname.startsWith('/users')) {
    return { kind: 'USUARIOS', summary: 'Usuarios', path: pathname };
  }
  return null;
}

/** Reporta módulo y proyecto actuales (throttling en el servidor). */
export function useReportUserActivity(enabled) {
  const location = useLocation();
  const lastRef = useRef('');

  useEffect(() => {
    if (!enabled) return undefined;
    const payload = activityFromPath(location.pathname);
    if (!payload) return undefined;
    const key = `${payload.kind}:${payload.projectId || ''}:${payload.path}`;
    if (lastRef.current === key) return undefined;
    lastRef.current = key;
    api.post('/api/activity', payload).catch(() => {});
    return undefined;
  }, [enabled, location.pathname]);
}
