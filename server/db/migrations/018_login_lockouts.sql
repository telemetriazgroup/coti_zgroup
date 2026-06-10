-- Bloqueo de login por cuenta (email), no por IP compartida.

CREATE TABLE IF NOT EXISTS login_lockouts (
  email_normalized VARCHAR(255) PRIMARY KEY,
  user_id          UUID REFERENCES users(id) ON DELETE SET NULL,
  failed_count     INTEGER NOT NULL DEFAULT 0,
  locked_until     TIMESTAMPTZ,
  last_attempt_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_login_lockouts_locked_until ON login_lockouts(locked_until);
CREATE INDEX IF NOT EXISTS idx_login_lockouts_user_id ON login_lockouts(user_id);

COMMENT ON TABLE login_lockouts IS 'Intentos fallidos de login por email; locked_until bloquea solo esa cuenta.';
