-- KIT / Productos finales: categoría especial + instancias de conjunto en presupuesto

ALTER TABLE catalog_categories
  ADD COLUMN IF NOT EXISTS is_kit_category BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS project_item_bundles (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  catalog_item_id UUID REFERENCES catalog_items(id) ON DELETE SET NULL,
  instance_label  VARCHAR(50) NOT NULL DEFAULT '1',
  display_name    VARCHAR(300) NOT NULL,
  unit_price      NUMERIC(12,2) NOT NULL DEFAULT 0,
  qty             NUMERIC(10,3) NOT NULL DEFAULT 1,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_item_bundles_project ON project_item_bundles(project_id);
CREATE INDEX IF NOT EXISTS idx_project_item_bundles_catalog ON project_item_bundles(catalog_item_id);

ALTER TABLE project_items
  ADD COLUMN IF NOT EXISTS bundle_id UUID REFERENCES project_item_bundles(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS is_bundle_header BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_bundle_component BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_project_items_bundle ON project_items(bundle_id);

-- Categoría plantilla (idempotente)
INSERT INTO catalog_categories (nombre, sort_order, is_kit_category, codigo_prefix)
SELECT 'Productos finales', 99, true, 'PF'
WHERE NOT EXISTS (
  SELECT 1 FROM catalog_categories WHERE is_kit_category IS TRUE AND active IS NOT FALSE
);
