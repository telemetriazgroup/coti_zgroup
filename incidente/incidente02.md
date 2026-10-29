# Incidente 02 — Matriz de roles: semiadmin, catálogo liberado y finanzas

**Fecha:** 2026-10-29  
**Reportado por:** operación / administración  
**Roles afectados:** SUPERUSER, ADMIN, SEMIADMIN, COMERCIAL, VIEWER

## Observación

Había que alinear el producto con esta matriz:

1. **SEMIADMIN** no edita precios ni categorías del catálogo; sí filtra el catálogo y ve precios.
2. **SEMIADMIN** solo ve sus proyectos, los compartidos y los de su equipo comercial (y pares de su grupo de semiadmin).
3. **SEMIADMIN** puede crear/editar comerciales, listar los existentes y traerlos a su equipo.
4. Los **grupos admin** pasan a ser **grupos de semiadmin**. Un ADMIN en el grupo no cambia nada: el admin ya ve todos los proyectos.
5. **Todos** los usuarios pueden ver clientes.
6. Al crear un producto, ADMIN/SUPERUSER elige si lo **libera** o queda solo para admin (por defecto liberado).
7. El **comercial** ve precios de catálogo al agregar al proyecto; para cambiar el precio de catálogo pide permiso a semiadmin o admin.
8. Hay **parámetros financieros predeterminados** (admin/superuser). Cada proyecto nuevo los copia.
9. **SEMIADMIN** puede editar M1, plazo contrato de corto plazo y plazos de largo plazo; ve el resto en solo lectura; no toca estacionalidad ni gerencia.
10. El **comercial** solo ve los campos financieros que puede usar; el resumen de gerencia le muestra montos resumidos.
11. El **superusuario** sigue pudiendo hacer todos los procesos.

## Causa

- `canManageCatalog` incluía SEMIADMIN (categorías, import, precios).
- SEMIADMIN no podía crear COMERCIAL (`allowedCreateRoles` vacío) ni listar comerciales ajenos.
- El menú de catálogo/clientes/usuarios usaba `isAdmin()` estricto, así que el semiadmin no entraba.
- Grupos y SQL de visibilidad cruzada exigían `role = 'ADMIN'`.
- No existía flag `released` en catálogo.
- El comercial no veía precios (`canSeeItemPrices` = false).
- Los proyectos nuevos nacían con `finance_params = {}` (motor hardcodeado, no defaults de sistema).
- PUT de finanzas del semiadmin reemplazaba todo el JSON.

## Qué se hizo

1. Catálogo: escritura de categorías/ítems/precios solo ADMIN y SUPERUSER. SEMIADMIN filtra y revisa solicitudes. Comercial ve precios y solicita cambios.
2. `catalog_items.released` (default true). Semiadmin/comercial no ven productos no liberados.
3. SEMIADMIN crea COMERCIAL, lista todos los comerciales y los asigna a su equipo (`/equipo`). Al editar un comercial, entra al equipo.
4. Grupos del superusuario: miembros SEMIADMIN (ADMIN opcional, sin efecto de visibilidad). SQL de pares usa `SEMIADMIN`.
5. Clientes visibles para cualquier usuario autenticado.
6. `app_settings.finance_defaults` + pantalla **Finanzas predet.** Los proyectos nuevos copian esos parámetros.
7. SEMIADMIN persiste solo M1 (`adjType`/`adjPct`), `cpPlazo`, `lpN`, `lpNContrato` y toggles comerciales. El panel muestra el resto bloqueado. Comercial sigue en vista resumida.

## Seguimiento — semiadmin: lista vs abrir proyecto

El listado del SEMIADMIN incluía proyectos de su equipo y los compartidos, pero al abrirlos `loadProjectAccessContext` solo resolvía equipo/grupo si el rol era ADMIN. Quedaba `acceso denegado`. Ahora ADMIN y SEMIADMIN usan el mismo contexto (equipo, grupo y shares).

## Seguimiento — mercado del proyecto

SEMIADMIN no cambia un proyecto de nacional a internacional (ni al revés). Solo ADMIN y SUPERUSER. Si le comparten un proyecto del otro mercado, ve **los precios de ese proyecto**; su usuario no cambia de vista. Cada cotización conserva su mercado.

## Seguimiento — pedido de aprobación de precios

Si el comercial no puede generar el reporte, ve un **modal** con el recuento de precios con `*` y un botón **Pedir aprobación**. El pedido llega a su semiadmin encargado, a los ADMIN y al SUPERUSER. Solo el semiadmin encargado o cualquier admin (o superusuario) aprueban; un semiadmin de otro equipo no.

## Seguimiento — precio de presupuesto del comercial

El comercial **sí puede cambiar el precio en el presupuesto** (no el catálogo). El valor queda `PENDING` con `*` hasta que un SEMIADMIN o ADMIN lo apruebe o rechace. Mientras haya precios pendientes, el comercial no puede generar vista previa ni PDF. Rechazar restaura el último precio aprobado.

## Registro

- Este archivo documenta la observación y el alcance del cambio.
