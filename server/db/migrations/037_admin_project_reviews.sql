-- Proyectos recientes que un ADMIN ya revisó (desaparecen del modal de login).
CREATE TABLE IF NOT EXISTS admin_project_reviews (
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, project_id)
);

CREATE INDEX IF NOT EXISTS idx_admin_project_reviews_user
  ON admin_project_reviews (user_id, reviewed_at DESC);

COMMENT ON TABLE admin_project_reviews IS
  'Proyectos que un admin ya abrió desde el modal de login. No vuelven a listarse.';
