import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, postFormDataWithProgress } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Modal } from '../components/Modal';
import { ProjectWorkNav } from '../components/ProjectWorkNav';
import { QuotationStatusFlow } from '../components/QuotationStatusFlow';
import { STATUS_LABEL } from '../lib/quotationStatus';

function formatBytes(n) {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

export function ProjectPlansPage() {
  const { projectId } = useParams();
  const { hasRole, user } = useAuth();
  const canWrite = hasRole('ADMIN', 'COMERCIAL');
  const viewerMode = user?.role === 'VIEWER';

  const [project, setProject] = useState(null);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [uploadPct, setUploadPct] = useState(null);
  const [notas, setNotas] = useState('');
  const [preview, setPreview] = useState(null);
  const [delPlan, setDelPlan] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setErr(null);
    try {
      const [proj, data] = await Promise.all([
        api.get(`/api/projects/${projectId}`),
        api.get(`/api/projects/${projectId}/plans`),
      ]);
      setProject(proj);
      setPlans(data.plans || []);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const grouped = useMemo(() => {
    const m = new Map();
    for (const p of plans) {
      const k = p.nombreOriginal || p.id;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(p);
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => b.version - a.version);
    }
    return m;
  }, [plans]);

  async function openPreview(plan) {
    setErr(null);
    try {
      const data = await api.get(`/api/projects/${projectId}/plans/${plan.id}/preview`);
      setPreview({ ...data, plan });
    } catch (e) {
      setErr(e.message);
    }
  }

  async function doUpload(fileList) {
    if (!canWrite || !fileList?.length) return;
    setErr(null);
    setUploadPct(0);
    const fd = new FormData();
    for (const f of fileList) {
      fd.append('files', f);
    }
    if (notas.trim()) fd.append('notasRevision', notas.trim());
    try {
      await postFormDataWithProgress(`/api/projects/${projectId}/plans`, fd, (p) => setUploadPct(p));
      setNotas('');
      setUploadPct(null);
      await load();
      window.dispatchEvent(new CustomEvent('zgroup:plans-changed'));
    } catch (e) {
      setUploadPct(null);
      setErr(e.message);
    }
  }

  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    if (!canWrite) return;
    const files = e.dataTransfer?.files;
    if (files?.length) doUpload(files);
  }

  async function removePlan(plan) {
    if (!canWrite) return;
    setErr(null);
    try {
      await api.del(`/api/projects/${projectId}/plans/${plan.id}`);
      setDelPlan(null);
      await load();
      window.dispatchEvent(new CustomEvent('zgroup:plans-changed'));
    } catch (e) {
      setErr(e.message);
    }
  }

  const isImage = (mime) => mime && mime.startsWith('image/');
  const isPdf = (mime) => mime === 'application/pdf';

  if (loading && !project) {
    return (
      <section className="view-active">
        <p className="muted mono">Cargando planos…</p>
      </section>
    );
  }

  if (err && !project) {
    return (
      <section className="view-active">
        <div className="banner banner--err mono">{err}</div>
        <Link to="/projects" className="btn btn-ghost">
          Volver a proyectos
        </Link>
      </section>
    );
  }

  return (
    <section className="view-active budget-view">
      <div className="page-header page-header--row">
        <div>
          <p className="mono muted" style={{ marginBottom: 4, fontSize: 11 }}>
            <Link to="/projects" className="budget-back-link">
              ← Proyectos
            </Link>
          </p>
          <h1 className="page-title">{project?.nombre || 'Planos'}</h1>
          <p className="page-sub muted mono">
            {STATUS_LABEL[project?.status] || project?.status} · Planos técnicos
          </p>
        </div>
      </div>

      <QuotationStatusFlow
        projectId={projectId}
        status={project?.status}
        canWrite={canWrite}
        viewerMode={viewerMode}
        onStatusChange={(data) => setProject(data)}
      />

      <ProjectWorkNav />

      {err && (
        <div className="banner banner--err mono" style={{ marginBottom: 12 }}>
          {err}
        </div>
      )}

      {canWrite && (
        <div
          className={`plans-dropzone ${dragOver ? 'plans-dropzone--active' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          <div className="plans-dropzone__inner">
            <p className="mono" style={{ marginBottom: 8 }}>
              Arrastra archivos aquí o elige desde tu equipo
            </p>
            <p className="muted mono" style={{ fontSize: 11, marginBottom: 12 }}>
              PDF, DWG, DXF, PNG, JPG, JPEG, SVG · máx. 25 MB por archivo
            </p>
            <label className="btn btn-primary mono plans-file-btn">
              Seleccionar archivos
              <input
                type="file"
                multiple
                className="plans-file-input"
                accept=".pdf,.dwg,.dxf,.png,.jpg,.jpeg,.svg"
                onChange={(e) => {
                  const f = e.target.files;
                  if (f?.length) doUpload(f);
                  e.target.value = '';
                }}
              />
            </label>
            <label className="plans-notas">
              <span className="fg-lbl">Notas de revisión (opcional)</span>
              <input
                className="form-input mono"
                placeholder="Ej. Revisión cliente 12/03"
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
              />
            </label>
            {uploadPct != null && (
              <div className="plans-progress mono">
                <div className="plans-progress__bar">
                  <div className="plans-progress__fill" style={{ width: `${Math.round(uploadPct * 100)}%` }} />
                </div>
                <span>{Math.round(uploadPct * 100)}%</span>
              </div>
            )}
          </div>
        </div>
      )}

      <h2 className="budget-panel-title" style={{ marginTop: 20 }}>
        Archivos
      </h2>
      {plans.length === 0 ? (
        <p className="muted mono">No hay planos cargados.</p>
      ) : (
        <div className="plans-list">
          {Array.from(grouped.entries()).map(([nombre, versions]) => (
            <div key={nombre} className="plans-group">
              <div className="plans-group__title mono">{nombre}</div>
              <ul className="plans-group__ul">
                {versions.map((pl) => (
                  <li key={pl.id} className={`plans-row ${pl.isCurrent ? 'plans-row--current' : ''}`}>
                    <div className="plans-row__meta">
                      <span className="mono">v{pl.version}</span>
                      {pl.isCurrent && <span className="plans-pill plans-pill--current">actual</span>}
                      <span className="muted mono">{formatBytes(pl.sizeBytes)}</span>
                      <span className="muted mono">{formatDate(pl.uploadedAt)}</span>
                      {pl.uploadedByEmail && (
                        <span className="muted mono" style={{ fontSize: 11 }}>
                          {pl.uploadedByEmail}
                        </span>
                      )}
                    </div>
                    {pl.notasRevision && (
                      <div className="plans-notas-row mono muted" style={{ fontSize: 11 }}>
                        Notas: {pl.notasRevision}
                      </div>
                    )}
                    <div className="plans-row__actions">
                      <button type="button" className="btn-link mono" onClick={() => openPreview(pl)}>
                        Ver / previsualizar
                      </button>
                      {canWrite && (
                        <button
                          type="button"
                          className="btn-link btn-link--danger mono"
                          onClick={() => setDelPlan(pl)}
                        >
                          Eliminar
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {!canWrite && (
        <p className="muted mono" style={{ marginTop: 16, fontSize: 12 }}>
          Como VIEWER solo ves la versión actual de cada archivo.
        </p>
      )}

      {preview && (
        <Modal title={preview.nombreOriginal || preview.plan?.nombreOriginal} onClose={() => setPreview(null)}>
          <div className="plans-preview">
            {isImage(preview.mimeType) && (
              <img src={preview.url} alt="" className="plans-preview__img" />
            )}
            {isPdf(preview.mimeType) && (
              <iframe title="PDF" src={preview.url} className="plans-preview__frame" />
            )}
            {!isImage(preview.mimeType) && !isPdf(preview.mimeType) && (
              <p className="mono muted">
                Vista previa no disponible para este tipo.{' '}
                <a href={preview.url} target="_blank" rel="noreferrer" className="btn-link">
                  Abrir en pestaña nueva
                </a>
              </p>
            )}
            <p className="muted mono" style={{ fontSize: 11, marginTop: 8 }}>
              Enlace firmado · caduca en ~15 min
            </p>
          </div>
        </Modal>
      )}

      {delPlan && (
        <Modal
          title="Eliminar plano"
          onClose={() => setDelPlan(null)}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setDelPlan(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                style={{ borderColor: 'var(--red)', color: 'var(--red)' }}
                onClick={() => removePlan(delPlan)}
              >
                Eliminar
              </button>
            </>
          }
        >
          <p className="muted">
            Se borrará la versión v{delPlan.version} de «{delPlan.nombreOriginal}» del almacenamiento y del historial.
            {delPlan.isCurrent && ' Si hay versiones anteriores, la más reciente pasará a ser la actual.'}
          </p>
        </Modal>
      )}
    </section>
  );
}
