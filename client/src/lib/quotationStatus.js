/**
 * Ciclo de vida de la cotización (proyecto) — etiquetas y transiciones permitidas.
 * Debe coincidir con server/utils/projectStatusTransitions.js
 */

export const STATUS_LABEL = {
  BORRADOR: 'Borrador',
  EN_SEGUIMIENTO: 'En seguimiento',
  PRESENTADA: 'Presentada',
  ACEPTADA: 'Aceptada',
  RECHAZADA: 'Rechazada',
  EN_NEGOCIACION: 'En negociación',
};

/** Pasos principales del carril (visualización) */
export const MAIN_PIPELINE_STEPS = ['BORRADOR', 'EN_SEGUIMIENTO', 'PRESENTADA'];

export function isTerminalStatus(s) {
  return s === 'ACEPTADA' || s === 'RECHAZADA';
}

const ALLOWED = {
  BORRADOR: ['EN_SEGUIMIENTO'],
  EN_SEGUIMIENTO: ['BORRADOR', 'PRESENTADA'],
  PRESENTADA: ['ACEPTADA', 'RECHAZADA', 'EN_NEGOCIACION', 'EN_SEGUIMIENTO'],
  EN_NEGOCIACION: ['PRESENTADA', 'ACEPTADA', 'RECHAZADA', 'EN_SEGUIMIENTO'],
};

export function isValidTransition(from, to) {
  if (!from || !to) return false;
  if (from === to) return true;
  if (isTerminalStatus(from)) return false;
  return (ALLOWED[from] || []).includes(to);
}

export function getAllowedTransitions(from) {
  if (!from || isTerminalStatus(from)) return [];
  return [...(ALLOWED[from] || [])];
}

/**
 * Etiqueta corta para botón de acción (from → to).
 */
export function getTransitionActionLabel(from, to) {
  if (from === 'BORRADOR' && to === 'EN_SEGUIMIENTO') return 'Pasar a en seguimiento';
  if (from === 'EN_SEGUIMIENTO' && to === 'PRESENTADA') return 'Marcar como presentada';
  if (from === 'EN_SEGUIMIENTO' && to === 'BORRADOR') return 'Volver a borrador';
  if (from === 'PRESENTADA' && to === 'ACEPTADA') return 'Marcar como aceptada';
  if (from === 'PRESENTADA' && to === 'RECHAZADA') return 'Marcar como rechazada';
  if (from === 'PRESENTADA' && to === 'EN_NEGOCIACION') return 'Pasar a negociación';
  if (from === 'PRESENTADA' && to === 'EN_SEGUIMIENTO') return 'Retirar presentación';
  if (from === 'EN_NEGOCIACION' && to === 'PRESENTADA') return 'Volver a presentada';
  if (from === 'EN_NEGOCIACION' && to === 'ACEPTADA') return 'Marcar como aceptada';
  if (from === 'EN_NEGOCIACION' && to === 'RECHAZADA') return 'Marcar como rechazada';
  if (from === 'EN_NEGOCIACION' && to === 'EN_SEGUIMIENTO') return 'Volver a seguimiento';
  return `Cambiar a «${STATUS_LABEL[to] || to}»`;
}
