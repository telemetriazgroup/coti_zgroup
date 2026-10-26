# Incidente 01 — Precios de componentes KIT y descuento del conjunto

**Fecha:** 2026-10-26  
**Reportado por:** operación / cotización  
**Rol afectado:** usuarios que editan presupuesto (dueño o administrador con permiso de kits)

## Observación

Al armar una cotización con **kits / zonas**:

1. No se podían editar los precios de los elementos que conforman el conjunto (ni en la tabla ni en «Editar conjunto»).
2. No existía un descuento porcentual sobre el **kit en general**.
3. Se pedía que, si hay descuento, el precio original aparezca **tachado**.

## Causa

- El alta del conjunto (`createProjectBundle`) ignoraba los `unitPrice` enviados y volvía a poner el precio de catálogo (`preserveOverrides: false`).
- El modal de conjunto mostraba el P. unit. de cada componente como texto, no como campo editable.
- En la tabla del presupuesto, `rowPriceEditable` excluía cabecera y componentes del KIT.
- `PUT /items/:id` devolvía `BUNDLE_COMPONENT_READONLY` para cualquier cambio en un componente.
- No había campo de descuento en `project_item_bundles`.

## Qué se hizo para levantar la observación

1. **Precios de componentes editables**
   - En «Editar conjunto» / alta de producto final, cada línea tiene input de precio unitario.
   - El servidor **respeta** el precio enviado al crear o actualizar el KIT.
   - En la tabla del presupuesto se puede editar el P. unit. de un componente (si no está consolidado con otro sub-grupo del mismo código). La cantidad del componente sigue editándose en el modal.
   - Al cambiar el precio de un componente se recalcula el total de la cabecera del conjunto.

2. **Descuento porcentual del kit**
   - Columna `project_item_bundles.discount_pct` (migración `031_kit_bundle_discount.sql`).
   - Campo «Descuento del conjunto (%)» en el modal.
   - Precio de cabecera = suma de componentes × (1 − %).
   - `official_unit_price` de la cabecera = total **antes** del descuento (se muestra tachado).
   - Etiqueta `−X%` junto a la zona en la fila KIT.
   - El descuento se copia al duplicar proyecto y al restaurar revisiones.

3. **Registro**
   - Este archivo documenta la observación y el alcance del cambio.

## Cómo validar

1. Abrir un presupuesto con un KIT / zona (como dueño o admin).
2. En «Editar conjunto», cambiar el P. unit. de un componente y guardar: el total del KIT debe actualizarse.
3. En la tabla, editar el P. unit. de un componente no consolidado: la cabecera debe recalcularse.
4. En el modal, cargar p. ej. 10% de descuento: el total bruto queda tachado y el neto es el 90%.
5. Vista previa / PDF: la partida KIT debe llevar el precio neto; si hay descuento, el bruto tachado (mismo criterio que precio de lista vs asumido).
