-- Medidas de unidad (sufijos: UND, GLN, M2, …)

CREATE TABLE IF NOT EXISTS measure_units (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  suffix      VARCHAR(30) NOT NULL,
  nombre      VARCHAR(100) NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT measure_units_suffix_unique UNIQUE (suffix)
);

CREATE INDEX IF NOT EXISTS idx_measure_units_active ON measure_units(active);
CREATE INDEX IF NOT EXISTS idx_measure_units_sort ON measure_units(sort_order);

INSERT INTO measure_units (suffix, nombre, sort_order) VALUES
  ('UND', 'Unidad', 0),
  ('GLN', 'Galón', 10),
  ('M2', 'Metro cuadrado', 20),
  ('ML', 'Metro lineal', 30),
  ('CENT', 'Ciento', 40),
  ('ROL', 'Rollo', 50),
  ('GLB', 'Global', 60),
  ('KIT', 'Kit', 70)
ON CONFLICT (suffix) DO NOTHING;
