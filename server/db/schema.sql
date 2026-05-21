-- ═══════════════════════════════════════════════════════════════
-- ZGROUP Cotizaciones Técnicas — Schema PostgreSQL
-- Sprint 0 base: users, employees, refresh_tokens
-- Sprint 1+: clients, projects, audit log
-- Sprint 2+: catalog_categories, catalog_items
-- Sprint 3+: project_items
-- Sprint 5+: project_plans
-- Sprint 6+: project_budget_snapshots
-- ═══════════════════════════════════════════════════════════════

-- Extensiones
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── ENUM TYPES ────────────────────────────────────────────────

CREATE TYPE user_role AS ENUM ('SUPERUSER', 'ADMIN', 'COMERCIAL', 'VIEWER');

CREATE TYPE project_status AS ENUM (
  'BORRADOR',
  'EN_SEGUIMIENTO',
  'PRESENTADA',
  'ACEPTADA',
  'RECHAZADA',
  'EN_NEGOCIACION'
);

CREATE TYPE item_tipo AS ENUM ('ACTIVO', 'CONSUMIBLE');

CREATE TYPE snapshot_kind AS ENUM ('CLIENTE', 'GERENCIA', 'INTERNO');

CREATE TYPE audit_event AS ENUM (
  'PROJECT_CREATE',
  'PROJECT_UPDATE',
  'PROJECT_DELETE',
  'PROJECT_CLONE',
  'PROJECT_STATUS_CHANGE',
  'BUDGET_ITEM_ADD',
  'BUDGET_ITEM_UPDATE',
  'BUDGET_ITEM_DELETE',
  'BUDGET_CLEAR',
  'BUDGET_SNAPSHOT',
  'PLAN_UPLOAD',
  'PLAN_DELETE',
  'CLIENT_ASSIGN',
  'PROJECT_SHARE',
  'PROJECT_UNSHARE'
);

-- ─── USERS ─────────────────────────────────────────────────────

CREATE TABLE users (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email       VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role        user_role NOT NULL DEFAULT 'COMERCIAL',
  active      BOOLEAN NOT NULL DEFAULT true,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_created_by ON users(created_by);

-- ─── ADMIN ↔ COMERCIAL (asignación por superusuario) ───────────

CREATE TABLE admin_commercial_assignments (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  commercial_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by   UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (admin_id, commercial_id)
);

CREATE INDEX idx_admin_commercial_admin ON admin_commercial_assignments(admin_id);
CREATE INDEX idx_admin_commercial_com ON admin_commercial_assignments(commercial_id);

-- ─── EMPLOYEES ─────────────────────────────────────────────────

CREATE TABLE employees (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  nombres         VARCHAR(100) NOT NULL,
  apellidos       VARCHAR(100) NOT NULL,
  cargo           VARCHAR(100),
  telefono        VARCHAR(20),
  dni             VARCHAR(20),
  foto_url        TEXT,
  fecha_ingreso   DATE,
  notas           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_employees_user_id ON employees(user_id);

-- ─── REFRESH TOKENS ────────────────────────────────────────────

CREATE TABLE refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  VARCHAR(255) UNIQUE NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at  TIMESTAMPTZ,
  ip_address  VARCHAR(45),
  user_agent  TEXT
);

CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_token_hash ON refresh_tokens(token_hash);
CREATE INDEX idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);

-- ─── CLIENTS ───────────────────────────────────────────────────

CREATE TABLE clients (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  active            BOOLEAN NOT NULL DEFAULT true,
  razon_social      VARCHAR(200) NOT NULL,
  ruc               VARCHAR(20),
  contacto_nombre   VARCHAR(150),
  contacto_email    VARCHAR(255),
  contacto_telefono VARCHAR(20),
  direccion         TEXT,
  ciudad            VARCHAR(100),
  notas             TEXT,
  created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_clients_active ON clients(active);
CREATE INDEX idx_clients_razon_social ON clients(razon_social);
CREATE INDEX idx_clients_ruc ON clients(ruc);
CREATE INDEX idx_clients_created_by ON clients(created_by);

-- ─── PROJECTS ──────────────────────────────────────────────────

CREATE TABLE projects (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre          VARCHAR(200) NOT NULL,
  odoo_ref        VARCHAR(50),
  client_id       UUID REFERENCES clients(id) ON DELETE SET NULL,
  status          project_status NOT NULL DEFAULT 'BORRADOR',
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_viewer UUID REFERENCES users(id) ON DELETE SET NULL,
  currency        VARCHAR(3) NOT NULL DEFAULT 'USD',
  tc              NUMERIC(8,4) DEFAULT 3.75,
  finance_params  JSONB NOT NULL DEFAULT '{}',
  deleted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_projects_created_by ON projects(created_by);
CREATE INDEX idx_projects_client_id ON projects(client_id);
CREATE INDEX idx_projects_status ON projects(status);
CREATE INDEX idx_projects_deleted_at ON projects(deleted_at);
CREATE INDEX idx_projects_assigned_viewer ON projects(assigned_viewer);

-- ─── PROJECT SHARES (ADMIN → ADMIN/COMERCIAL) ─────────────────

CREATE TABLE project_shares (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shared_by   UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, user_id)
);

CREATE INDEX idx_project_shares_project ON project_shares(project_id);
CREATE INDEX idx_project_shares_user ON project_shares(user_id);

-- ─── CATALOG CATEGORIES ────────────────────────────────────────

CREATE TABLE catalog_categories (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre      VARCHAR(100) NOT NULL,
  codigo_prefix VARCHAR(20),
  next_seq    INTEGER NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── CATALOG ITEMS ─────────────────────────────────────────────

CREATE TABLE catalog_items (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category_id   UUID NOT NULL REFERENCES catalog_categories(id) ON DELETE RESTRICT,
  codigo        VARCHAR(50) NOT NULL,
  descripcion   VARCHAR(300) NOT NULL,
  unidad        VARCHAR(30) NOT NULL DEFAULT 'UND',
  tipo          item_tipo NOT NULL DEFAULT 'ACTIVO',
  unit_price    NUMERIC(12,2) NOT NULL DEFAULT 0,
  active        BOOLEAN NOT NULL DEFAULT true,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_catalog_items_category ON catalog_items(category_id);
CREATE INDEX idx_catalog_items_tipo ON catalog_items(tipo);
CREATE INDEX idx_catalog_items_active ON catalog_items(active);
CREATE UNIQUE INDEX idx_catalog_items_category_codigo ON catalog_items(category_id, codigo);

-- ─── MEASURE UNITS (sufijos: UND, GLN, …) ─────────────────────

CREATE TABLE measure_units (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  suffix      VARCHAR(30) NOT NULL,
  nombre      VARCHAR(100) NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT measure_units_suffix_unique UNIQUE (suffix)
);

CREATE INDEX idx_measure_units_active ON measure_units(active);
CREATE INDEX idx_measure_units_sort ON measure_units(sort_order);

-- ─── CATALOG ITEM REQUESTS (aprobación comercial → admin) ───────

CREATE TYPE catalog_request_kind AS ENUM ('CREATE', 'UPDATE');
CREATE TYPE catalog_request_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE catalog_item_requests (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  kind             catalog_request_kind NOT NULL,
  status           catalog_request_status NOT NULL DEFAULT 'PENDING',
  requested_by     UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  catalog_item_id  UUID REFERENCES catalog_items(id) ON DELETE SET NULL,
  category_id      UUID NOT NULL REFERENCES catalog_categories(id) ON DELETE RESTRICT,
  codigo           VARCHAR(50) NOT NULL,
  descripcion      VARCHAR(300) NOT NULL,
  unidad           VARCHAR(30) NOT NULL DEFAULT 'UND',
  tipo             item_tipo NOT NULL DEFAULT 'ACTIVO',
  unit_price       NUMERIC(12,2) NOT NULL DEFAULT 0,
  prev_descripcion VARCHAR(300),
  prev_unit_price  NUMERIC(12,2),
  request_notes    TEXT,
  review_notes     TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at      TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_catalog_requests_status ON catalog_item_requests(status);
CREATE INDEX idx_catalog_requests_requested_by ON catalog_item_requests(requested_by);
CREATE INDEX idx_catalog_requests_pending ON catalog_item_requests(status) WHERE status = 'PENDING';

-- ─── CATALOG CHANGE LOG ────────────────────────────────────────

CREATE TYPE catalog_entity_type AS ENUM ('CATEGORY', 'ITEM');

CREATE TABLE catalog_change_log (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_type    catalog_entity_type NOT NULL,
  entity_id      UUID NOT NULL,
  entity_label   VARCHAR(300),
  field_name     VARCHAR(50) NOT NULL,
  old_value      TEXT,
  new_value      TEXT,
  change_source  VARCHAR(30) NOT NULL DEFAULT 'DIRECT',
  actor_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  request_id     UUID REFERENCES catalog_item_requests(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_catalog_change_entity ON catalog_change_log(entity_type, entity_id);
CREATE INDEX idx_catalog_change_created ON catalog_change_log(created_at DESC);

-- ─── PROJECT ITEMS ─────────────────────────────────────────────

CREATE TABLE project_items (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  catalog_item_id UUID REFERENCES catalog_items(id) ON DELETE SET NULL,
  codigo          VARCHAR(50) NOT NULL,
  descripcion     VARCHAR(300) NOT NULL,
  unidad          VARCHAR(30) NOT NULL DEFAULT 'UND',
  tipo            item_tipo NOT NULL DEFAULT 'ACTIVO',
  unit_price        NUMERIC(12,2) NOT NULL DEFAULT 0,
  -- Precio de lista / catálogo al incorporar la línea (trazabilidad). unit_price = precio asumido en cotización.
  official_unit_price NUMERIC(12,2),
  qty             NUMERIC(10,3) NOT NULL DEFAULT 1,
  subtotal        NUMERIC(14,2) GENERATED ALWAYS AS (unit_price * qty) STORED,
  is_custom       BOOLEAN NOT NULL DEFAULT false,
  category_id     UUID REFERENCES catalog_categories(id) ON DELETE SET NULL,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_project_items_project_id ON project_items(project_id);
CREATE INDEX idx_project_items_created_by ON project_items(created_by);
CREATE INDEX idx_project_items_tipo ON project_items(tipo);
CREATE INDEX idx_project_items_category_id ON project_items(category_id);

-- ─── PROJECT PLANS (Technical drawings) ────────────────────────

CREATE TABLE project_plans (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  nombre_original VARCHAR(255) NOT NULL,
  s3_key          VARCHAR(500) NOT NULL,
  s3_bucket       VARCHAR(100),
  mime_type       VARCHAR(100),
  size_bytes      BIGINT,
  version         INTEGER NOT NULL DEFAULT 1,
  is_current      BOOLEAN NOT NULL DEFAULT true,
  uploaded_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notas_revision  TEXT
);

CREATE INDEX idx_project_plans_project_id ON project_plans(project_id);
CREATE INDEX idx_project_plans_is_current ON project_plans(is_current);

-- ─── PROJECT BUDGET SNAPSHOTS ──────────────────────────────────

CREATE TABLE project_budget_snapshots (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind        snapshot_kind NOT NULL DEFAULT 'INTERNO',
  label       VARCHAR(200),
  payload     JSONB NOT NULL DEFAULT '{}',
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_snapshots_project_id ON project_budget_snapshots(project_id);
CREATE INDEX idx_snapshots_kind ON project_budget_snapshots(kind);

-- ─── PROJECT AUDIT LOG ─────────────────────────────────────────

CREATE TABLE project_audit_log (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id  UUID REFERENCES projects(id) ON DELETE SET NULL,
  event_type  audit_event NOT NULL,
  actor_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  prev_data   JSONB,
  new_data    JSONB,
  ip_address  VARCHAR(45),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_project_id ON project_audit_log(project_id);
CREATE INDEX idx_audit_event_type ON project_audit_log(event_type);
CREATE INDEX idx_audit_actor_id ON project_audit_log(actor_id);
CREATE INDEX idx_audit_created_at ON project_audit_log(created_at);

-- ─── TRIGGERS: updated_at automático ──────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_employees_updated_at
  BEFORE UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_clients_updated_at
  BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_catalog_categories_updated_at
  BEFORE UPDATE ON catalog_categories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_catalog_items_updated_at
  BEFORE UPDATE ON catalog_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_project_items_updated_at
  BEFORE UPDATE ON project_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
