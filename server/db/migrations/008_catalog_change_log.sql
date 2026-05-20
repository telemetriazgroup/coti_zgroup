-- Historial de cambios en catálogo (ítems y categorías)

DO $$ BEGIN
  CREATE TYPE catalog_entity_type AS ENUM ('CATEGORY', 'ITEM');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS catalog_change_log (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_type    catalog_entity_type NOT NULL,
  entity_id      UUID NOT NULL,
  entity_label   VARCHAR(300),
  field_name     VARCHAR(50) NOT NULL,
  old_value      TEXT,
  new_value      TEXT,
  change_source  VARCHAR(30) NOT NULL DEFAULT 'DIRECT',
  actor_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  request_id     UUID REFERENCES catalog_item_requests(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_catalog_change_entity ON catalog_change_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_catalog_change_created ON catalog_change_log(created_at DESC);
