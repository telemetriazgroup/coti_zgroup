-- Historial de cambios en clientes (CRM)

CREATE TABLE IF NOT EXISTS client_change_log (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id      UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  client_label   VARCHAR(200),
  field_name     VARCHAR(50) NOT NULL,
  old_value      TEXT,
  new_value      TEXT,
  change_source  VARCHAR(30) NOT NULL DEFAULT 'DIRECT',
  actor_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_change_client ON client_change_log(client_id);
CREATE INDEX IF NOT EXISTS idx_client_change_created ON client_change_log(created_at DESC);
