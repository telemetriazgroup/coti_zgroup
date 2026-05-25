-- Predeterminado del checkbox «Ajuste» (margen/descuento M1) al agregar ítems al presupuesto.
ALTER TABLE catalog_categories
  ADD COLUMN IF NOT EXISTS default_apply_adjustment BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN catalog_categories.default_apply_adjustment IS
  'Si true, las líneas nuevas del presupuesto heredan ajuste ✓ (margen/descuento M1).';
