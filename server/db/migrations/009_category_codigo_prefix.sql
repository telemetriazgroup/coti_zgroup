-- Prefijo de código por categoría (ej. SF → SF-0011)

ALTER TABLE catalog_categories
  ADD COLUMN IF NOT EXISTS codigo_prefix VARCHAR(20),
  ADD COLUMN IF NOT EXISTS next_seq INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_catalog_categories_prefix ON catalog_categories(codigo_prefix) WHERE codigo_prefix IS NOT NULL;
