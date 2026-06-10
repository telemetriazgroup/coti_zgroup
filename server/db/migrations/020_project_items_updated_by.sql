-- Trazabilidad: último usuario que modificó una línea de presupuesto

ALTER TABLE project_items
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_project_items_updated_by ON project_items(updated_by);

UPDATE project_items
SET updated_by = created_by
WHERE updated_by IS NULL AND created_by IS NOT NULL;
