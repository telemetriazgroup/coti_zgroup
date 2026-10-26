-- Descuento porcentual opcional sobre el total del conjunto KIT
ALTER TABLE project_item_bundles
  ADD COLUMN IF NOT EXISTS discount_pct NUMERIC(6,2) NOT NULL DEFAULT 0;
