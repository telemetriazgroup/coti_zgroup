-- Etapa 5: outbox de escritura hacia Odoo (create/write). El POST HTTP no llama a XML-RPC.

CREATE TABLE IF NOT EXISTS odoo_outbox (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  op               VARCHAR(16) NOT NULL CHECK (op IN ('create', 'write')),
  client_id        UUID REFERENCES clients(id) ON DELETE SET NULL,
  odoo_id          INTEGER,
  x_ztrack_uid     UUID NOT NULL,
  payload          JSONB NOT NULL DEFAULT '{}'::jsonb,
  expected_write_date TIMESTAMPTZ,
  attempts         INTEGER NOT NULL DEFAULT 0,
  next_attempt_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status           VARCHAR(16) NOT NULL DEFAULT 'pendiente'
                   CHECK (status IN ('pendiente', 'enviado', 'fallido', 'conflicto')),
  last_error       TEXT,
  actor_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_odoo_outbox_status_next
  ON odoo_outbox (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_odoo_outbox_client
  ON odoo_outbox (client_id);
CREATE INDEX IF NOT EXISTS idx_odoo_outbox_uid
  ON odoo_outbox (x_ztrack_uid);

ALTER TABLE clients ADD COLUMN IF NOT EXISTS x_ztrack_uid UUID;
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_x_ztrack_uid
  ON clients (x_ztrack_uid) WHERE x_ztrack_uid IS NOT NULL;
