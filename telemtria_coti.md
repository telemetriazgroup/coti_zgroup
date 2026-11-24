# Telemetría en la cotización — implicancias

**Fecha:** 2026-11-24  
**Estado:** en implementación. Prefijo acordado: **TEL** (exclusivo).

## Qué se pide

1. Una categoría de catálogo **Telemetría**, prefijo **TEL** (ninguna otra categoría puede usarlo).
2. Al agregar un producto final (kit) al presupuesto, la telemetría viene **apagada**.
3. Si se activa el check, dentro de ese kit se arma un presupuesto de telemetría.
4. Ahí se pueden agregar insumos propios de la categoría, ítems de otras categorías habilitados para telemetría, dependencias y también un kit.
5. Todo ese bloque queda marcado como telemetría del conjunto, no como una cotización aparte.

## Cómo está el sistema hoy

- Una categoría es una fila de `catalog_categories`: nombre, prefijo, `is_kit_category`, ajuste M1 por defecto. No existe un tipo de categoría «especial» más allá del flag de producto final.
- El código de un ítem es único **dentro de su categoría**, formato `PREFIJO-0001` (4 dígitos). Dos categorías pueden repetir el mismo texto de código.
- El precio de un producto final no se tipea: es la suma de sus dependencias de catálogo. Un insumo normal tiene precio propio.
- En el presupuesto, un kit es una cabecera más componentes planos. El grupo (`component_group_key` / etiqueta) solo organiza sub-bloques. No hay kit dentro de otro kit.
- El modal del conjunto **excluye** los productos finales al agregar extras (`!it.isKit`). Una dependencia de un insumo sí se puede desplegar como líneas del mismo conjunto.
- El total del kit es la suma de los componentes incluidos, con el descuento del conjunto. Activos y consumibles se reparten por el **tipo** del componente (ACTIVO / CONSUMIBLE), no por categoría.
- El PDF de gerencia y el de cliente usan ese mismo reparto. La categoría solo se imprime como texto de la línea.

## Dónde va cada check

| Check | Dónde vive | Valor inicial | Para qué |
| --- | --- | --- | --- |
| Telemetría del conjunto | Instancia del kit en el presupuesto (`project_item_bundles`), no en la plantilla del producto final | Apagado | Este STORE puede llevar telemetría y el de al lado no |
| Usable en telemetría | Ítem de catálogo que **no** es de la categoría Telemetría | Apagado | Entra al selector del bloque sin mudarse de categoría |
| Ítem nativo | Categoría Telemetría | Siempre usable ahí | Insumo creado para telemetría; no necesita el segundo check |

El check del conjunto es por cotización. Dos kits del mismo producto final pueden diferir. Apagarlo después de haber cargado líneas debe pedir confirmación y quitar solo el grupo Telemetría; el resto del kit no se toca. El precio de la cabecera se recalcula.

La categoría Telemetría **no** se marca como producto final (`is_kit_category` sigue en falso). Si se marcara, cada insumo TE exigiría dependencias y perdería el precio propio. El flag conviene guardarlo aparte (`is_telemetry_category`), igual que el de kit, para que un cambio de nombre no rompa la regla. Una sola categoría activa con ese flag.

## Prefijo TEL

Decisión: **TEL**, no TE. Trab. Estructura ya usó `TE-001` en el seed y el catálogo v12 usa **EST**. TEL no choca con eso.

El formato es `TEL-0001`. Un índice único impide que otra categoría guarde el prefijo `TEL`. La categoría Telemetría no puede cambiar de prefijo ni marcarse como producto final.

## Qué se puede meter en el bloque

El selector del bloque, con el check activo, muestra solo:

- ítems activos y liberados de la categoría Telemetría;
- ítems de otras categorías con «usable en telemetría».

No muestra el catálogo completo. Esos mismos insumos TE no se ofrecen como línea suelta en el catálogo lateral del presupuesto: entran por el kit. Un ítem de otra categoría con el check sigue pudiendo agregarse como línea normal **y** dentro de telemetría.

**Dependencias.** Si el ítem elegido tiene dependencias, se despliegan como líneas del grupo Telemetría, igual que hoy un extra con BOM. Los hijos entran por ser parte de ese ítem; no hace falta que cada hijo tenga el check.

**Kit dentro de telemetría.** Hoy el modal no deja elegir un producto final como componente. Anidar otro `project_item_bundles` (cabecera dentro de cabecera) rompe totales, PDF, orden, clonado y revisiones: el motor asume componentes planos y una sola cabecera cobrada.

Recomendación para la primera versión: al elegir un kit dentro de telemetría, se **aplanan** sus componentes en el grupo Telemetría, con la etiqueta del kit interno (sub-grupo). No nace una segunda cabecera ni un segundo descuento de kit. El precio que suma es el de esos componentes, y el descuento que manda es el del conjunto exterior. Si más adelante hace falta un kit interno con su propio descuento y su propia cabecera, es otro modelo.

## Precio, finanzas y documentos

- Cada línea de telemetría es un componente del kit. Sube el bruto, entra al descuento del conjunto y al precio cobrado de la cabecera.
- Sigue valiendo su tipo ACTIVO o CONSUMIBLE. Un sensor activo se deprecia con los activos; un consumible de telemetría se diluye con los consumibles. No hace falta tocar `shared/finance-engine.js`.
- No hay un quinto módulo «telemetría» ni un total de lista aparte. Si en algún momento la telemetría se cotiza fuera del activo (servicio, no capital), eso es otra decisión y no sale de este check.
- En gerencia y cliente las líneas salen en activos o consumibles, con categoría Telemetría y grupo «Telemetría» en el bloque del conjunto. El PDF no debe volver a tratar el kit entero como un solo activo.

## Roles y catálogo

- Crear la categoría, los insumos TE y el check «usable en telemetría» es escritura de catálogo: ADMIN y SUPERUSER. SEMIADMIN no edita precios ni categorías.
- Activar telemetría en un kit y armar el bloque es edición de conjunto: dueño, ADMIN, SEMIADMIN o SUPERUSER. El comercial dueño puede armarlo con lo ya liberado; no crea ítems TE.
- Un ítem TE no liberado no lo ve el comercial en el selector.
- La descripción activa sigue siendo única en todo el catálogo. No se duplica un cable «igual» en Telemetría si ya existe: se le marca «usable en telemetría».
- El alta comercial por solicitud puede pedir un ítem en Telemetría; el check de elegibilidad no lo pone el comercial.

## Qué más hay que acompañar

- Clonado, revisión de presupuesto e import/export de líneas copian hoy `component_group_*`. Tienen que copiar también el check del conjunto. Si el import no trae el grupo `telemetry`, esas líneas volverían al grupo plantilla y el check quedaría apagado con líneas mezcladas.
- Los kits ya guardados quedan con el check apagado. No se reclasifica nada solo.
- Precio pendiente del comercial aplica igual a un componente de telemetría.
- Auditoría de catálogo: el check nuevo es un campo más del ítem.

## Qué no cambia

- Motor financiero M1–M4 y el reparto activo/consumible del kit.
- Plantilla de dependencias del producto final (la telemetría no forma parte del BOM de catálogo del STORE; se arma en la cotización).
- Paleta, tipografías y el formato de respuesta de la API.

## Orden sugerido cuando se implemente

1. Prefijo `TEL` reservado. Categoría Telemetría creada por migración.
2. Ítems TEL con precio propio. El check `telemetry_eligible` queda para el resto del catálogo.
3. Check `telemetry_eligible` en el ítem de catálogo y en la ficha de admin.
4. Check apagado por defecto en la instancia del kit, grupo `telemetry`, selector filtrado.
5. Dependencias desplegadas dentro de ese grupo; kit interno aplanado, sin segunda cabecera.
6. Apagar el check borra solo ese grupo y recalcula la cabecera.
7. Clonado, revisiones, Excel y los dos PDF reconocen el grupo.
8. Prueba: kit sin telemetría (totales iguales a hoy); kit con dos insumos TE y un ítem elegible de otra categoría; apagar el check y volver al total anterior.
