-- Categoría opcional en líneas de presupuesto (piezas personalizadas y denormalización desde catálogo)
ALTER TABLE project_items
  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES catalog_categories(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_project_items_category_id ON project_items(category_id);
