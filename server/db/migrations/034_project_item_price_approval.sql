-- Precio de partida en presupuesto: el comercial puede cambiarlo, queda PENDING hasta semiadmin/admin.

ALTER TABLE project_items
  ADD COLUMN IF NOT EXISTS price_status VARCHAR(16) NOT NULL DEFAULT 'APPROVED',
  ADD COLUMN IF NOT EXISTS approved_unit_price NUMERIC(12,2);

UPDATE project_items
   SET approved_unit_price = unit_price
 WHERE approved_unit_price IS NULL;

CREATE INDEX IF NOT EXISTS idx_project_items_price_pending
  ON project_items (project_id)
  WHERE price_status = 'PENDING';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'project_items_price_status_chk'
  ) THEN
    ALTER TABLE project_items
      ADD CONSTRAINT project_items_price_status_chk
      CHECK (price_status IN ('APPROVED', 'PENDING'));
  END IF;
END $$;

COMMENT ON COLUMN project_items.price_status IS
  'APPROVED o PENDING. El comercial edita unit_price; un semiadmin/admin debe aprobar antes de reportes.';
COMMENT ON COLUMN project_items.approved_unit_price IS
  'Último precio aprobado. Si se rechaza, se restaura este valor.';

CREATE OR REPLACE FUNCTION trg_project_items_approved_price()
RETURNS trigger AS $$
BEGIN
  IF NEW.approved_unit_price IS NULL THEN
    NEW.approved_unit_price := NEW.unit_price;
  END IF;
  IF NEW.price_status IS NULL OR NEW.price_status = '' THEN
    NEW.price_status := 'APPROVED';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_project_items_approved_price ON project_items;
CREATE TRIGGER trg_project_items_approved_price
  BEFORE INSERT ON project_items
  FOR EACH ROW EXECUTE FUNCTION trg_project_items_approved_price();
