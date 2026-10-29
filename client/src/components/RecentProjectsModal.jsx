import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { Modal } from './Modal';
import { STATUS_LABEL } from '../lib/quotationStatus';

function formatCreatedAt(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-PE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function RecentProjectsModal({ projects, onClose }) {
  const navigate = useNavigate();
  const [busyId, setBusyId] = useState(null);

  async function openProject(row) {
    if (!row?.id || busyId) return;
    setBusyId(row.id);
    try {
      await api.post(`/api/projects/${row.id}/admin-review`, {});
    } catch {
      /* igual se abre; el siguiente login lo volverá a listar si falló */
    }
    onClose();
    navigate(`/projects/${row.id}/presupuesto`);
  }

  return (
    <Modal title="Proyectos recientes" onClose={onClose} panelClassName="modal-panel--recent">
      <p className="recent-proj-lead">
        Últimos proyectos agregados en la semana. Al abrir uno, no volverá a aparecer en el próximo inicio de
        sesión.
      </p>
      <ul className="recent-proj-list">
        {projects.map((row) => (
          <li key={row.id}>
            <button
              type="button"
              className="recent-proj-item"
              disabled={busyId === row.id}
              onClick={() => openProject(row)}
            >
              <span className="recent-proj-item__name">{row.nombre}</span>
              <span className="recent-proj-item__meta mono">
                {row.clientRazonSocial || 'Sin cliente'}
                {row.odooRef ? ` · ${row.odooRef}` : ''}
              </span>
              <span className="recent-proj-item__meta muted">
                {STATUS_LABEL[row.status] || row.status} · {formatCreatedAt(row.createdAt)}
                {row.createdByName ? ` · ${row.createdByName}` : ''}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
