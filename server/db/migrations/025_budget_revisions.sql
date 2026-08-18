-- Historial de versiones del presupuesto (git-like). Solo SUPERUSER consulta y restaura.
-- La auditoría de eventos (project_audit_log) se mantiene; esto guarda el estado completo.

ALTER TYPE audit_event ADD VALUE IF NOT EXISTS 'BUDGET_BUNDLE_ADD';
ALTER TYPE audit_event ADD VALUE IF NOT EXISTS 'BUDGET_BUNDLE_UPDATE';
ALTER TYPE audit_event ADD VALUE IF NOT EXISTS 'BUDGET_IMPORT_APPLY';
ALTER TYPE audit_event ADD VALUE IF NOT EXISTS 'BUDGET_RESTORE';

DO $$ BEGIN
  CREATE TYPE budget_revision_kind AS ENUM ('AUTO', 'RESTORE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS project_budget_revisions (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id       UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  seq              INTEGER NOT NULL,
  kind             budget_revision_kind NOT NULL DEFAULT 'AUTO',
  cause            VARCHAR(64),
  restored_from_id UUID REFERENCES project_budget_revisions(id) ON DELETE SET NULL,
  actor_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  payload          JSONB NOT NULL DEFAULT '{}',
  content_hash     VARCHAR(64) NOT NULL,
  item_count       INTEGER NOT NULL DEFAULT 0,
  added_count      INTEGER NOT NULL DEFAULT 0,
  removed_count    INTEGER NOT NULL DEFAULT 0,
  changed_count    INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_budget_revisions_project_seq
  ON project_budget_revisions(project_id, seq DESC);
CREATE INDEX IF NOT EXISTS idx_budget_revisions_project_created
  ON project_budget_revisions(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_budget_revisions_hash
  ON project_budget_revisions(project_id, content_hash);
