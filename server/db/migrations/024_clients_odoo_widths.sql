-- Etapa 4: anchos de clients alineados con caché Odoo (name 512, vat 32, phone 64).
ALTER TABLE clients ALTER COLUMN razon_social TYPE VARCHAR(512);
ALTER TABLE clients ALTER COLUMN ruc TYPE VARCHAR(32);
ALTER TABLE clients ALTER COLUMN contacto_telefono TYPE VARCHAR(64);
ALTER TABLE clients ALTER COLUMN ciudad TYPE VARCHAR(128);
