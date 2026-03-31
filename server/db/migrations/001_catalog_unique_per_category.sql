-- Sprint 2: código único por categoría (antes era único global por codigo)
DROP INDEX IF EXISTS idx_catalog_items_codigo;
CREATE UNIQUE INDEX IF NOT EXISTS idx_catalog_items_category_codigo ON catalog_items(category_id, codigo);

DROP TRIGGER IF EXISTS trg_catalog_categories_updated_at ON catalog_categories;
CREATE TRIGGER trg_catalog_categories_updated_at
  BEFORE UPDATE ON catalog_categories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
