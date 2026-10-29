-- Catálogo: productos liberados (visibles a semiadmin/comercial) vs solo admin.
ALTER TABLE catalog_items
  ADD COLUMN IF NOT EXISTS released BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_catalog_items_released ON catalog_items(released);

COMMENT ON COLUMN catalog_items.released IS
  'true = visible para semiadmin y comercial; false = solo ADMIN/SUPERUSER. Default liberado.';
