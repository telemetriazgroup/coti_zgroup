-- Solicitudes de catálogo (comercial → admin/superusuario)

DO $$ BEGIN
  CREATE TYPE catalog_request_kind AS ENUM ('CREATE', 'UPDATE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE catalog_request_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS catalog_item_requests (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  kind             catalog_request_kind NOT NULL,
  status           catalog_request_status NOT NULL DEFAULT 'PENDING',
  requested_by     UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  catalog_item_id  UUID REFERENCES catalog_items(id) ON DELETE SET NULL,
  category_id      UUID NOT NULL REFERENCES catalog_categories(id) ON DELETE RESTRICT,
  codigo           VARCHAR(50) NOT NULL,
  descripcion      VARCHAR(300) NOT NULL,
  unidad           VARCHAR(30) NOT NULL DEFAULT 'UND',
  tipo             item_tipo NOT NULL DEFAULT 'ACTIVO',
  unit_price       NUMERIC(12,2) NOT NULL DEFAULT 0,
  prev_descripcion VARCHAR(300),
  prev_unit_price  NUMERIC(12,2),
  request_notes    TEXT,
  review_notes     TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at      TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_catalog_requests_status ON catalog_item_requests(status);
CREATE INDEX IF NOT EXISTS idx_catalog_requests_requested_by ON catalog_item_requests(requested_by);
CREATE INDEX IF NOT EXISTS idx_catalog_requests_pending ON catalog_item_requests(status) WHERE status = 'PENDING';
