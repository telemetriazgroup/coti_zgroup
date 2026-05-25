-- Checkbox «Ajuste» en líneas de presupuesto (margen/descuento M1 solo sobre marcadas)

ALTER TABLE project_items
  ADD COLUMN IF NOT EXISTS apply_adjustment BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_project_items_apply_adjustment ON project_items(apply_adjustment);
