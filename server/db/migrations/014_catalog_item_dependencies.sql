-- Dependencias entre ítems de catálogo (BOM / componentes)

CREATE TABLE IF NOT EXISTS catalog_item_dependencies (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  parent_item_id  UUID NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
  child_item_id   UUID NOT NULL REFERENCES catalog_items(id) ON DELETE RESTRICT,
  qty             NUMERIC(10,3) NOT NULL DEFAULT 1 CHECK (qty > 0),
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT catalog_item_deps_no_self CHECK (parent_item_id <> child_item_id),
  CONSTRAINT catalog_item_deps_unique UNIQUE (parent_item_id, child_item_id)
);

CREATE INDEX IF NOT EXISTS idx_catalog_item_deps_parent ON catalog_item_dependencies(parent_item_id);
CREATE INDEX IF NOT EXISTS idx_catalog_item_deps_child ON catalog_item_dependencies(child_item_id);
