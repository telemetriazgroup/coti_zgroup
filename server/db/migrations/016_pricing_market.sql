-- Mercado de precios (nacional / internacional) y visibilidad comercial

CREATE TYPE pricing_market AS ENUM ('NACIONAL', 'INTERNACIONAL');

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS pricing_market pricing_market NOT NULL DEFAULT 'NACIONAL',
  ADD COLUMN IF NOT EXISTS can_see_finance_summary BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS quotation_market pricing_market NOT NULL DEFAULT 'NACIONAL';

ALTER TABLE catalog_items
  ADD COLUMN IF NOT EXISTS unit_price_intl NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS has_dual_price BOOLEAN NOT NULL DEFAULT false;

-- Datos existentes: mismo precio nacional/internacional, mercado nacional
UPDATE catalog_items
SET unit_price_intl = unit_price
WHERE unit_price_intl IS NULL;

UPDATE users SET pricing_market = 'NACIONAL' WHERE pricing_market IS NULL;
UPDATE projects SET quotation_market = 'NACIONAL' WHERE quotation_market IS NULL;

COMMENT ON COLUMN catalog_items.unit_price IS 'Precio nacional (USD). Por defecto también aplica como internacional si has_dual_price = false.';
COMMENT ON COLUMN catalog_items.unit_price_intl IS 'Precio internacional (USD) cuando has_dual_price = true.';
COMMENT ON COLUMN projects.quotation_market IS 'Mercado de la cotización; homogéneo en todas las líneas. Heredado del creador al crear.';
COMMENT ON COLUMN users.pricing_market IS 'Mercado del usuario creador; define mercado inicial de proyectos nuevos.';
COMMENT ON COLUMN users.can_see_finance_summary IS 'COMERCIAL: si true, ve cuotas CP/LP del módulo financiero (sin detalle de fórmulas).';
