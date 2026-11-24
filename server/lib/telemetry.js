/** Telemetría: prefijo reservado y grupo dentro del kit. Sin I/O. */

const TELEMETRY_PREFIX = 'TEL';
const TELEMETRY_GROUP_KEY = 'telemetry';
const TELEMETRY_GROUP_LABEL = 'Telemetría';

function isTelemetryGroupKey(key) {
  return String(key || '') === TELEMETRY_GROUP_KEY;
}

/**
 * TEL solo lo usa la categoría Telemetría. Ninguna otra puede tomarlo.
 * @param {string|null} prefix
 * @param {boolean} isTelemetryCategory
 */
function prefixReservedForTelemetry(prefix, isTelemetryCategory) {
  const p = String(prefix || '').trim().toUpperCase();
  if (p === TELEMETRY_PREFIX && !isTelemetryCategory) {
    return {
      ok: false,
      code: 'PREFIX_RESERVED',
      message: 'El prefijo TEL está reservado para Telemetría. Ninguna otra categoría puede usarlo.',
    };
  }
  if (isTelemetryCategory && p && p !== TELEMETRY_PREFIX) {
    return {
      ok: false,
      code: 'TELEMETRY_PREFIX',
      message: 'La categoría Telemetría debe usar el prefijo TEL.',
    };
  }
  return { ok: true };
}

/**
 * Check apagado: se quitan las líneas del grupo y el resto del kit queda igual.
 * Check ausente: se conserva el grupo si ya viene en las líneas (import / revisión).
 */
function applyTelemetryFlag(lines, telemetryEnabled) {
  const list = Array.isArray(lines) ? lines : [];
  if (telemetryEnabled === false) {
    return {
      lines: list.filter((line) => !isTelemetryGroupKey(line?.componentGroupKey)),
      enabled: false,
    };
  }
  const has = list.some((line) => isTelemetryGroupKey(line?.componentGroupKey));
  return { lines: list, enabled: telemetryEnabled === true || has };
}

module.exports = {
  TELEMETRY_PREFIX,
  TELEMETRY_GROUP_KEY,
  TELEMETRY_GROUP_LABEL,
  isTelemetryGroupKey,
  prefixReservedForTelemetry,
  applyTelemetryFlag,
};
