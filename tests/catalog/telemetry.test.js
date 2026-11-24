import { createRequire } from 'module';
import { describe, it, expect } from 'vitest';

const require = createRequire(import.meta.url);
const {
  TELEMETRY_PREFIX,
  prefixReservedForTelemetry,
  applyTelemetryFlag,
  isTelemetryGroupKey,
} = require('../../server/lib/telemetry.js');

describe('prefijo TEL', () => {
  it('reserva TEL para la categoría Telemetría', () => {
    expect(TELEMETRY_PREFIX).toBe('TEL');
    expect(prefixReservedForTelemetry('TEL', false).ok).toBe(false);
    expect(prefixReservedForTelemetry('tel', false).code).toBe('PREFIX_RESERVED');
    expect(prefixReservedForTelemetry('TEL', true).ok).toBe(true);
    expect(prefixReservedForTelemetry('SF', false).ok).toBe(true);
    expect(prefixReservedForTelemetry('EST', true).ok).toBe(false);
  });

  it('con el check apagado quita solo el grupo telemetría', () => {
    const lines = [
      { catalogItemId: 'a', componentGroupKey: 'template', qty: 1 },
      { catalogItemId: 'b', componentGroupKey: 'telemetry', qty: 2 },
    ];
    const off = applyTelemetryFlag(lines, false);
    expect(off.enabled).toBe(false);
    expect(off.lines).toHaveLength(1);
    expect(off.lines[0].catalogItemId).toBe('a');
    const on = applyTelemetryFlag(lines, true);
    expect(on.enabled).toBe(true);
    expect(on.lines).toHaveLength(2);
    expect(isTelemetryGroupKey('telemetry')).toBe(true);
    expect(isTelemetryGroupKey('template')).toBe(false);
  });
});
