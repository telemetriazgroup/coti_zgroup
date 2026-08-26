-- Último acceso y bitácora de qué hacía cada usuario (proyecto / módulo).
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_ip VARCHAR(64);

CREATE TABLE IF NOT EXISTS user_activity_log (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        VARCHAR(40) NOT NULL,
  project_id  UUID REFERENCES projects(id) ON DELETE SET NULL,
  summary     VARCHAR(400),
  path        VARCHAR(200),
  ip_address  VARCHAR(64),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_activity_user_created
  ON user_activity_log (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_activity_created
  ON user_activity_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_activity_project
  ON user_activity_log (project_id)
  WHERE project_id IS NOT NULL;
