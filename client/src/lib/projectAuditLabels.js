/** Etiquetas legibles para eventos de project_audit_log. */

export const AUDIT_EVENT_LABEL = {
  PROJECT_CREATE: 'Proyecto creado',
  PROJECT_UPDATE: 'Proyecto actualizado',
  PROJECT_DELETE: 'Proyecto archivado',
  PROJECT_CLONE: 'Proyecto clonado',
  PROJECT_STATUS_CHANGE: 'Cambio de estado',
  BUDGET_ITEM_ADD: 'Línea agregada',
  BUDGET_ITEM_UPDATE: 'Línea modificada',
  BUDGET_ITEM_DELETE: 'Línea eliminada',
  BUDGET_CLEAR: 'Presupuesto limpiado',
  BUDGET_SNAPSHOT: 'Snapshot de presupuesto',
  BUDGET_BUNDLE_ADD: 'Conjunto KIT agregado',
  BUDGET_BUNDLE_UPDATE: 'Conjunto KIT modificado',
  PLAN_UPLOAD: 'Plano subido',
  PLAN_DELETE: 'Plano eliminado',
  CLIENT_ASSIGN: 'VIEWER asignado',
  PROJECT_SHARE: 'Proyecto compartido',
  PROJECT_UNSHARE: 'Compartido revocado',
};

export function formatAuditEventType(code) {
  return AUDIT_EVENT_LABEL[code] || code || '—';
}

export function summarizeAuditRow(row) {
  const next = row?.newData || {};
  const prev = row?.prevData || {};
  const pick = (o) =>
    o.descripcion ||
    o.displayName ||
    o.codigo ||
    o.nombre ||
    (o.batchCount != null ? `${o.batchCount} línea(s)` : null) ||
    (o.qty != null && o.id ? `qty ${prev.qty ?? '?'} → ${o.qty}` : null);
  return pick(next) || pick(prev) || '—';
}

export function formatItemTraceUser(name, email) {
  const n = String(name || '').trim();
  if (n) return n;
  if (email) return email;
  return '—';
}
