-- Trazabilidad: precio de lista (catálogo / referencia) vs precio asumido (unit_price) en la cotización
ALTER TABLE project_items
  ADD COLUMN IF NOT EXISTS official_unit_price NUMERIC(12,2);

UPDATE project_items
SET official_unit_price = unit_price
WHERE official_unit_price IS NULL;

COMMENT ON COLUMN project_items.official_unit_price IS
  'Precio de referencia (lista catálogo al agregar, o precio inicial en pieza custom). unit_price = asumido en totales.';
