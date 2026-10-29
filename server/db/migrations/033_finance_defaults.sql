-- Parámetros financieros predeterminados del sistema (ADMIN/SUPERUSER).
CREATE TABLE IF NOT EXISTS app_settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE app_settings IS 'Ajustes globales (p. ej. finance_defaults copiados a cada proyecto nuevo).';
