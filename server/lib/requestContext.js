const { AsyncLocalStorage } = require('node:async_hooks');

const store = new AsyncLocalStorage();

function runWithRequestContext(ctx, fn) {
  return store.run(ctx || {}, fn);
}

function getRequestContext() {
  return store.getStore() || {};
}

/**
 * Durante virtualización, la auditoría queda a nombre del superadmin.
 * El id efectivo (permisos) sigue siendo el usuario virtualizado.
 */
function resolveAuditActorId(explicitId) {
  const ctx = getRequestContext();
  if (ctx.impersonatorId) return ctx.impersonatorId;
  return explicitId || ctx.effectiveUserId || null;
}

module.exports = {
  runWithRequestContext,
  getRequestContext,
  resolveAuditActorId,
};
