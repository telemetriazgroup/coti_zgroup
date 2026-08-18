-- Etapa 2: caché local de res.partner (Odoo 17). Sin sync aún (ODOO_SYNC_ENABLED=0).
-- Idempotente. No rompe clients/projects existentes (odoo_id NULL = cliente solo local).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ─── Caché cruda + normalizada ─────────────────────────────────
CREATE TABLE IF NOT EXISTS odoo_partners (
  odoo_id                   INTEGER PRIMARY KEY,
  x_ztrack_uid              UUID UNIQUE,
  raw                       JSONB NOT NULL DEFAULT '{}'::jsonb,
  name                      VARCHAR(512),
  display_name              VARCHAR(512),
  vat                       VARCHAR(32),
  email                     VARCHAR(255),
  phone                     VARCHAR(64),
  mobile                    VARCHAR(64),
  city                      VARCHAR(128),
  is_company                BOOLEAN NOT NULL DEFAULT false,
  parent_odoo_id            INTEGER,
  type                      VARCHAR(32),
  active                    BOOLEAN NOT NULL DEFAULT true,
  customer_rank             INTEGER NOT NULL DEFAULT 0,
  supplier_rank             INTEGER NOT NULL DEFAULT 0,
  category_ids              INTEGER[] NOT NULL DEFAULT '{}',
  odoo_write_date           TIMESTAMPTZ NOT NULL,
  last_pushed_write_date    TIMESTAMPTZ,
  sync_status               VARCHAR(24) NOT NULL DEFAULT 'sincronizado'
    CHECK (sync_status IN ('sincronizado', 'pendiente', 'conflicto', 'borrado_en_odoo')),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_odoo_partners_vat ON odoo_partners (vat);
CREATE INDEX IF NOT EXISTS idx_odoo_partners_name ON odoo_partners (name);
CREATE INDEX IF NOT EXISTS idx_odoo_partners_name_trgm ON odoo_partners USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_odoo_partners_parent ON odoo_partners (parent_odoo_id);
CREATE INDEX IF NOT EXISTS idx_odoo_partners_write_date ON odoo_partners (odoo_write_date);
CREATE INDEX IF NOT EXISTS idx_odoo_partners_status ON odoo_partners (sync_status);
CREATE INDEX IF NOT EXISTS idx_odoo_partners_category_ids ON odoo_partners USING gin (category_ids);
CREATE INDEX IF NOT EXISTS idx_odoo_partners_active_company ON odoo_partners (active, is_company);

-- ─── Estado del pull (un registro por modelo) ──────────────────
CREATE TABLE IF NOT EXISTS odoo_sync_state (
  model                  VARCHAR(64) PRIMARY KEY,
  watermark              TIMESTAMPTZ,
  last_run_at            TIMESTAMPTZ,
  last_ok_at             TIMESTAMPTZ,
  duration_ms            INTEGER,
  created_n              INTEGER NOT NULL DEFAULT 0,
  updated_n              INTEGER NOT NULL DEFAULT 0,
  error_n                INTEGER NOT NULL DEFAULT 0,
  last_error             TEXT,
  category_cliente_id    INTEGER,
  category_proveedor_id  INTEGER,
  category_contacto_id   INTEGER,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ids de etiquetas inventariados en etapa 0 (zgroup.odoo.com). El pull puede sobreescribirlos.
INSERT INTO odoo_sync_state (model, category_cliente_id, category_proveedor_id, category_contacto_id)
VALUES ('res.partner', 3, 4, 5)
ON CONFLICT (model) DO NOTHING;

-- ─── Lock del job (botón + cron no simultáneos) ────────────────
CREATE TABLE IF NOT EXISTS odoo_sync_locks (
  lock_key    VARCHAR(64) PRIMARY KEY,
  holder      VARCHAR(80),
  expires_at  TIMESTAMPTZ NOT NULL
);

-- ─── Vínculo CRM local ↔ contacto Odoo ─────────────────────────
ALTER TABLE clients ADD COLUMN IF NOT EXISTS odoo_id INTEGER;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS odoo_parent_id INTEGER;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS odoo_contact_id INTEGER;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS sync_origin VARCHAR(16) NOT NULL DEFAULT 'local';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS odoo_write_date TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'clients_odoo_id_key'
  ) THEN
    ALTER TABLE clients ADD CONSTRAINT clients_odoo_id_key UNIQUE (odoo_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'clients_sync_origin_check'
  ) THEN
    ALTER TABLE clients ADD CONSTRAINT clients_sync_origin_check
      CHECK (sync_origin IN ('local', 'odoo', 'linked'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_clients_odoo_id ON clients (odoo_id);
CREATE INDEX IF NOT EXISTS idx_clients_sync_origin ON clients (sync_origin);

DROP TRIGGER IF EXISTS trg_odoo_partners_updated_at ON odoo_partners;
CREATE TRIGGER trg_odoo_partners_updated_at
  BEFORE UPDATE ON odoo_partners
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_odoo_sync_state_updated_at ON odoo_sync_state;
CREATE TRIGGER trg_odoo_sync_state_updated_at
  BEFORE UPDATE ON odoo_sync_state
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
