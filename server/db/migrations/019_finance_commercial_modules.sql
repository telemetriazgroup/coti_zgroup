-- Visibilidad financiera por módulo para comerciales (autorización del admin)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS can_see_finance_m1 BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_see_finance_cp BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_see_finance_lp BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_see_finance_est BOOLEAN NOT NULL DEFAULT false;

UPDATE users
SET
  can_see_finance_m1 = true,
  can_see_finance_cp = true,
  can_see_finance_lp = true,
  can_see_finance_est = true
WHERE role = 'COMERCIAL' AND can_see_finance_summary = true;

COMMENT ON COLUMN users.can_see_finance_m1 IS 'COMERCIAL: ve total venta (M1) sin margen/descuento.';
COMMENT ON COLUMN users.can_see_finance_cp IS 'COMERCIAL: ve cuota CP y plazo, sin fórmulas.';
COMMENT ON COLUMN users.can_see_finance_lp IS 'COMERCIAL: ve cuotas LP y plazos, sin fórmulas.';
COMMENT ON COLUMN users.can_see_finance_est IS 'COMERCIAL: ve resumen estacionalidad, sin parámetros internos.';
