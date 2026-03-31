/**
 * Transiciones permitidas para project_status (alineado a client/src/lib/quotationStatus.js).
 */

function isTerminal(s) {
  return s === 'ACEPTADA' || s === 'RECHAZADA';
}

const ALLOWED = {
  BORRADOR: ['EN_SEGUIMIENTO'],
  EN_SEGUIMIENTO: ['BORRADOR', 'PRESENTADA'],
  PRESENTADA: ['ACEPTADA', 'RECHAZADA', 'EN_NEGOCIACION', 'EN_SEGUIMIENTO'],
  EN_NEGOCIACION: ['PRESENTADA', 'ACEPTADA', 'RECHAZADA', 'EN_SEGUIMIENTO'],
};

function isValidStatusTransition(from, to) {
  if (from === to) return true;
  if (isTerminal(from)) return false;
  const list = ALLOWED[from];
  return Array.isArray(list) && list.includes(to);
}

module.exports = { isValidStatusTransition, isTerminal };
