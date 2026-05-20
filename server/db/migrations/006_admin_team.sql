-- Usuario creador + asignación comerciales → admin (superusuario)

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_created_by ON users(created_by);

CREATE TABLE IF NOT EXISTS admin_commercial_assignments (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  commercial_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by   UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (admin_id, commercial_id)
);

CREATE INDEX IF NOT EXISTS idx_admin_commercial_admin ON admin_commercial_assignments(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_commercial_com ON admin_commercial_assignments(commercial_id);
