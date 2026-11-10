-- Quién actualizó el módulo financiero de una cotización (más reciente primero).

CREATE TABLE IF NOT EXISTS project_finance_edits (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  actor_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_finance_edits_project
  ON project_finance_edits (project_id, created_at DESC);
