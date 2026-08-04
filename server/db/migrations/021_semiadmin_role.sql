-- Rol SEMIADMIN: acceso administrativo sin archivados, backup, explorador BD ni catálogo inactivo.
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'SEMIADMIN';
