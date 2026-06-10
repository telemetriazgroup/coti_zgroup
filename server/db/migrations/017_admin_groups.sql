-- Grupos de administradores: peers en el mismo grupo ven proyectos propios y de comerciales del otro.

CREATE TABLE IF NOT EXISTS admin_groups (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre      VARCHAR(120) NOT NULL,
  created_by  UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_group_members (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id    UUID NOT NULL REFERENCES admin_groups(id) ON DELETE CASCADE,
  admin_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (group_id, admin_id)
);

CREATE INDEX IF NOT EXISTS idx_admin_group_members_group ON admin_group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_admin_group_members_admin ON admin_group_members(admin_id);

COMMENT ON TABLE admin_groups IS 'Grupos creados por superusuario; admins miembros comparten visibilidad de proyectos.';
COMMENT ON TABLE admin_group_members IS 'Administradores miembros de un grupo (role ADMIN).';
