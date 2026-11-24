-- Categoría Telemetría (prefijo TEL, exclusivo) y check por conjunto.

ALTER TABLE catalog_categories
  ADD COLUMN IF NOT EXISTS is_telemetry_category BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE catalog_items
  ADD COLUMN IF NOT EXISTS telemetry_eligible BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE project_item_bundles
  ADD COLUMN IF NOT EXISTS telemetry_enabled BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS uq_catalog_categories_prefix_tel
  ON catalog_categories ((upper(codigo_prefix)))
  WHERE upper(coalesce(codigo_prefix, '')) = 'TEL';

CREATE UNIQUE INDEX IF NOT EXISTS uq_catalog_categories_telemetry
  ON catalog_categories ((is_telemetry_category))
  WHERE is_telemetry_category IS TRUE;

INSERT INTO catalog_categories
  (nombre, sort_order, active, default_apply_adjustment, is_kit_category, is_telemetry_category, codigo_prefix)
SELECT 'Telemetría', 98, true, true, false, true, 'TEL'
WHERE NOT EXISTS (
  SELECT 1 FROM catalog_categories
  WHERE is_telemetry_category IS TRUE OR upper(coalesce(codigo_prefix, '')) = 'TEL'
);
