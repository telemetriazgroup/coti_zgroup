const { isTelemetryGroupKey, applyTelemetryFlag } = require('./telemetry');

/**
 * Valida las líneas del grupo telemetría. Los hijos de un ítem elegible,
 * nativo o de un producto final entran sin check propio (BOM aplanado).
 */
async function prepareBundleTelemetry(client, lines, telemetryEnabled, actorRole) {
  const flagged = applyTelemetryFlag(lines, telemetryEnabled);
  const telemetryLines = flagged.lines.filter((line) => isTelemetryGroupKey(line?.componentGroupKey));
  if (!telemetryLines.length) return flagged;

  const ids = [...new Set(telemetryLines.map((line) => line.catalogItemId).filter(Boolean))];
  const { rows } = await client.query(
    `SELECT i.id, i.active, i.released, i.telemetry_eligible,
            c.is_telemetry_category
     FROM catalog_items i
     JOIN catalog_categories c ON c.id = i.category_id
     WHERE i.id = ANY($1::uuid[])`,
    [ids]
  );
  const byId = new Map(rows.map((row) => [row.id, row]));

  for (const id of ids) {
    const row = byId.get(id);
    if (!row || row.active === false) {
      return {
        errorCode: 'TELEMETRY_ITEM',
        message: 'Un ítem de telemetría no está activo en el catálogo',
      };
    }
    if (actorRole === 'COMERCIAL' && row.released === false) {
      return {
        errorCode: 'TELEMETRY_ITEM',
        message: 'Ese ítem de telemetría no está liberado',
      };
    }
    if (row.is_telemetry_category === true || row.telemetry_eligible === true) continue;
    const { rows: parent } = await client.query(
      `SELECT 1
       FROM catalog_item_dependencies d
       JOIN catalog_items p ON p.id = d.parent_item_id
       JOIN catalog_categories c ON c.id = p.category_id
       WHERE d.child_item_id = $1
         AND p.active IS NOT FALSE
         AND (
           p.telemetry_eligible IS TRUE
           OR c.is_telemetry_category IS TRUE
           OR c.is_kit_category IS TRUE
         )
       LIMIT 1`,
      [id]
    );
    if (!parent[0]) {
      return {
        errorCode: 'TELEMETRY_ITEM',
        message: 'Ese ítem no puede usarse en el bloque de telemetría',
      };
    }
  }

  return flagged;
}

module.exports = { prepareBundleTelemetry };
