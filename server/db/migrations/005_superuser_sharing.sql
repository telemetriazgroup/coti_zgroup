-- SUPERUSER role, project sharing, item creator tracking
-- Ejecutar en BD existente: psql ... -f server/db/migrations/005_superuser_sharing.sql

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'SUPERUSER';

ALTER TYPE audit_event ADD VALUE IF NOT EXISTS 'PROJECT_SHARE';
ALTER TYPE audit_event ADD VALUE IF NOT EXISTS 'PROJECT_UNSHARE';

CREATE TABLE IF NOT EXISTS project_shares (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shared_by   UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_project_shares_project ON project_shares(project_id);
CREATE INDEX IF NOT EXISTS idx_project_shares_user ON project_shares(user_id);

ALTER TABLE project_items
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_project_items_created_by ON project_items(created_by);
