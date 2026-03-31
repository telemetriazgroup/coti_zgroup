-- Clientes: marcar inactivos sin borrar histórico de proyectos vinculados
ALTER TABLE clients ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;
CREATE INDEX IF NOT EXISTS idx_clients_active ON clients(active);
