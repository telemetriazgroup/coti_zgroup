import React, { useCallback, useState } from 'react';
import { api } from '../lib/api';
import { Modal } from './Modal';
import { QuotationEstadosGuideContent } from './QuotationEstadosGuideContent';
import {
  STATUS_LABEL,
  MAIN_PIPELINE_STEPS,
  getAllowedTransitions,
  getTransitionActionLabel,
  isTerminalStatus,
} from '../lib/quotationStatus';

function StepDot({ done, current, label, sub }) {
  return (
    <div
      className={`status-flow__step${done ? ' status-flow__step--done' : ''}${current ? ' status-flow__step--current' : ''}`}
    >
      <span className="status-flow__dot" aria-hidden="true" />
      <span className="status-flow__lbl">{label}</span>
      {sub ? (
        <span className="status-flow__sub mono muted" style={{ fontSize: 10 }}>
          {sub}
        </span>
      ) : null}
    </div>
  );
}

function pipelineFlags(st) {
  const isNeg = st === 'EN_NEGOCIACION';
  const s0 = st === 'BORRADOR';
  const s1 = st === 'EN_SEGUIMIENTO';
  const s2 = st === 'PRESENTADA';
  return {
    step0: { done: !s0, current: s0 },
    step1: {
      done: s1 || s2 || isNeg || st === 'ACEPTADA' || st === 'RECHAZADA',
      current: s1,
    },
    step2: {
      done: s2 || isNeg || st === 'ACEPTADA' || st === 'RECHAZADA',
      current: s2,
      sub: isNeg ? 'luego: negociación' : null,
    },
  };
}

export function QuotationStatusFlow({
  projectId,
  status,
  canWrite,
  viewerMode,
  onStatusChange,
}) {
  const [busy, setBusy] = useState(false);
  const [localErr, setLocalErr] = useState(null);
  const [helpOpen, setHelpOpen] = useState(false);

  const st = status || 'BORRADOR';
  const terminal = isTerminalStatus(st);
  const isNeg = st === 'EN_NEGOCIACION';
  const pf = pipelineFlags(st);

  const applyTransition = useCallback(
    async (next) => {
      if (!projectId || !canWrite || viewerMode) return;
      if (next === 'RECHAZADA') {
        if (!window.confirm('¿Marcar esta cotización como rechazada?')) return;
      }
      if (next === 'ACEPTADA') {
        if (!window.confirm('¿Confirmar que la cotización fue aceptada por el cliente?')) return;
      }
      setBusy(true);
      setLocalErr(null);
      try {
        const data = await api.put(`/api/projects/${projectId}`, { status: next });
        onStatusChange?.(data);
      } catch (e) {
        setLocalErr(e.message);
      } finally {
        setBusy(false);
      }
    },
    [projectId, canWrite, viewerMode, onStatusChange]
  );

  const nextOptions = canWrite && !viewerMode && !terminal ? getAllowedTransitions(st) : [];

  return (
    <div className="status-flow">
      <div className="status-flow__hdr">
        <span className="status-flow__title mono">Estado de la cotización</span>
        <button
          type="button"
          className="btn btn-ghost mono"
          style={{ fontSize: 11, padding: '6px 12px' }}
          onClick={() => setHelpOpen(true)}
        >
          Guía de ayuda
        </button>
      </div>

      <div className="status-flow__track" aria-label="Flujo de estados">
        <StepDot done={pf.step0.done} current={pf.step0.current} label={STATUS_LABEL.BORRADOR} />
        <span className="status-flow__sep" aria-hidden="true" />
        <StepDot done={pf.step1.done} current={pf.step1.current} label={STATUS_LABEL.EN_SEGUIMIENTO} />
        <span className="status-flow__sep" aria-hidden="true" />
        <StepDot
          done={pf.step2.done}
          current={pf.step2.current}
          label={STATUS_LABEL.PRESENTADA}
          sub={pf.step2.sub}
        />

        <span className="status-flow__sep" aria-hidden="true" />

        {terminal ? (
          <div
            className={`status-flow__step status-flow__step--done status-flow__step--terminal${st === 'ACEPTADA' ? ' status-flow__step--ok' : ' status-flow__step--no'}`}
          >
            <span className="status-flow__dot" aria-hidden="true" />
            <span className="status-flow__lbl">{STATUS_LABEL[st]}</span>
          </div>
        ) : isNeg ? (
          <div className="status-flow__step status-flow__step--current">
            <span className="status-flow__dot" aria-hidden="true" />
            <span className="status-flow__lbl">{STATUS_LABEL.EN_NEGOCIACION}</span>
          </div>
        ) : (
          <div className="status-flow__step status-flow__step--future">
            <span className="status-flow__dot status-flow__dot--dim" aria-hidden="true" />
            <span className="status-flow__lbl muted">Cierre</span>
            <span className="status-flow__sub mono muted" style={{ fontSize: 10 }}>
              Aceptada o rechazada
            </span>
          </div>
        )}
      </div>

      {localErr && (
        <div className="banner banner--err mono" style={{ marginTop: 10, fontSize: 12 }}>
          {localErr}
        </div>
      )}

      {nextOptions.length > 0 && (
        <div className="status-flow__actions">
          {nextOptions.map((to) => (
            <button
              key={to}
              type="button"
              className={`btn btn-ghost mono${to === 'RECHAZADA' ? ' status-flow__btn--danger' : ''}`}
              disabled={busy}
              onClick={() => applyTransition(to)}
            >
              {getTransitionActionLabel(st, to)}
            </button>
          ))}
        </div>
      )}

      {viewerMode && (
        <p className="muted mono" style={{ fontSize: 11, marginTop: 8 }}>
          Solo lectura: el equipo comercial gestiona el estado.
        </p>
      )}

      {helpOpen && (
        <Modal
          title="Guía: ciclo de vida de la cotización"
          wide
          onClose={() => setHelpOpen(false)}
          footer={
            <button type="button" className="btn btn-primary" onClick={() => setHelpOpen(false)}>
              Cerrar
            </button>
          }
        >
          <QuotationEstadosGuideContent />
        </Modal>
      )}
    </div>
  );
}
