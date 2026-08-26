-- Virtualización de sesión: el refresh del SUPERUSER apunta al usuario efectivo.
ALTER TABLE refresh_tokens
  ADD COLUMN IF NOT EXISTS impersonate_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_impersonate
  ON refresh_tokens (impersonate_user_id)
  WHERE impersonate_user_id IS NOT NULL;
