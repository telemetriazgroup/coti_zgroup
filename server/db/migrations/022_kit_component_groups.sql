-- Sub-grupos de componentes dentro de un conjunto KIT (plantilla vs extras con dependencias).
ALTER TABLE project_items
  ADD COLUMN IF NOT EXISTS component_group_key VARCHAR(64),
  ADD COLUMN IF NOT EXISTS component_group_label VARCHAR(150),
  ADD COLUMN IF NOT EXISTS component_group_sort INT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_project_items_component_group
  ON project_items (bundle_id, component_group_sort, sort_order)
  WHERE is_bundle_component = true;
