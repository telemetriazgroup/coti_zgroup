-- Restaurar proyectos archivados (solo SUPERUSER en API).
ALTER TYPE audit_event ADD VALUE IF NOT EXISTS 'PROJECT_RESTORE';
