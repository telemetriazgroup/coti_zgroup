-- Solicitud del comercial para que su semiadmin / admin / superuser aprueben precios de presupuesto.

CREATE TABLE IF NOT EXISTS project_price_approval_requests (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  requested_by  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at   TIMESTAMPTZ,
  resolved_by   UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_price_approval_req_open
  ON project_price_approval_requests (project_id)
  WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_price_approval_req_reviewer
  ON project_price_approval_requests (status, requested_at DESC);

COMMENT ON TABLE project_price_approval_requests IS
  'Pedido de aprobación de precios de presupuesto. Lo ve el semiadmin encargado, cualquier ADMIN y SUPERUSER.';
