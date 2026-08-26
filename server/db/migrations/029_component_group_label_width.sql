-- Etiqueta de sub-grupo KIT: se copia la descripción del ítem (hasta 300).
ALTER TABLE project_items ALTER COLUMN component_group_label TYPE VARCHAR(300);
