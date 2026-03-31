import React, { useCallback, useEffect, useState } from 'react';
import { NavLink, useParams } from 'react-router-dom';
import { api } from '../lib/api';

export function ProjectWorkNav() {
  const { projectId } = useParams();
  const [planCount, setPlanCount] = useState(null);

  const loadCount = useCallback(() => {
    if (!projectId) return;
    api
      .get(`/api/projects/${projectId}/plans`)
      .then((d) => setPlanCount(typeof d.count === 'number' ? d.count : 0))
      .catch(() => setPlanCount(0));
  }, [projectId]);

  useEffect(() => {
    loadCount();
  }, [loadCount]);

  useEffect(() => {
    const onChange = () => loadCount();
    window.addEventListener('zgroup:plans-changed', onChange);
    return () => window.removeEventListener('zgroup:plans-changed', onChange);
  }, [loadCount]);

  if (!projectId) return null;

  return (
    <nav className="project-work-nav mono" aria-label="Secciones del proyecto">
      <NavLink
        end
        to={`/projects/${projectId}/presupuesto`}
        className={({ isActive }) =>
          'project-work-nav__link' + (isActive ? ' project-work-nav__link--active' : '')
        }
      >
        Presupuesto
      </NavLink>
      <NavLink
        end
        to={`/projects/${projectId}/planos`}
        className={({ isActive }) =>
          'project-work-nav__link' + (isActive ? ' project-work-nav__link--active' : '')
        }
      >
        Planos
        <span className="project-work-nav__badge" title="Planos (versión actual)">
          {planCount == null ? '…' : planCount}
        </span>
      </NavLink>
    </nav>
  );
}
