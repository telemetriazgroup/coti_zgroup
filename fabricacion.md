# Fabricación — productos intermedios, BOM anidado y lista de materiales

Documento de análisis (no es implementación). Origen del requerimiento: `SPRINT_PLAN.md` (notas al final del plan).

Objetivo: poder **armar productos intermedios** (categoría tipo KIT) que agrupan activos y consumibles, **anidarlos** en otros intermedios o en un producto final, y generar una **lista de materiales de producción** que explota la cadena (estilo Lego: cajas dentro de cajas) **sin listar los intermedios como partidas comprables**.

---

## 1. Qué pide el negocio

Hoy el comercial cotiza un **producto final (KIT)** y el presupuesto muestra el conjunto + componentes **directos**.

Se necesita un segundo concepto:

| Concepto | Quién lo ve | Para qué sirve |
|----------|-------------|----------------|
| **Producto intermedio** | Catálogo / producción (ADMIN, SEMIADMIN, SUPERUSER). **No** se ofrece a COMERCIAL ni a quien opere como “ejecutivo de venta”. | Trazar *qué se consume* para fabricar un ensamble. No es una línea de venta. |
| **Producto final (KIT actual)** | Todos los roles que ya cotizan (incluye COMERCIAL). | Lo que se vende. Puede estar compuesto por intermedios + activos/consumibles sueltos. |

Ejemplo del requerimiento (cantidades por **1 unidad** del padre):

```
PRODUCTO_UNO  (intermedio, ACTIVO)
  ACTIVO1 ×2
  ACTIVO2 ×3
  CONSUMIBLE1 ×1
  ACTIVO3 ×1

PRODUCTO_DOS  (intermedio)
  PRODUCTO_UNO ×2
  ACTIVO4 ×2
  ACTIVO5 ×1
  CONSUMIBLE2 ×1
  ACTIVO1 ×1

PRODUCTO_TRES (final o intermedio de nivel superior)
  PRODUCTO_UNO ×1
  PRODUCTO_DOS ×1
  ACTIVO6 ×1
  CONSUMIBLE1 ×1
  ACTIVO3 ×1
```

Reglas de la **lista de materiales (producción)**:

1. Mostrar la **cadena de transformación** (Uno → Dos → Tres, con sus cajas).
2. En la tabla de materiales **no** aparecen PRODUCTO_UNO / DOS / TRES: se fabrican en proceso.
3. Sí aparecen, **consolidados**, los **activos y consumibles hoja** necesarios para producir lo pedido.
4. Totales de activos vs consumibles sobre esa explosión.

UI pedida: editor **tipo Lego** (cuadros dentro de cuadros) al crear el intermedio / final.

---

## 2. Cómo está el sistema hoy

### 2.1 Catálogo

- Categoría con `catalog_categories.is_kit_category`. Seed: **Productos finales** (`PF`).
- Cualquier ítem de esa categoría es un KIT: precio **calculado** (no editable), exige ≥1 componente.
- BOM en `catalog_item_dependencies` (padre → hijo + `qty`). Unicidad `(parent, child)`, anti-ciclo, **solo un nivel al usar el KIT**.
- `item_tipo` solo admite `ACTIVO` | `CONSUMIBLE`. No existe “intermedio” ni “semi-elaborado”.
- El editor de dependencias **ya permite elegir cualquier ítem** (incluido otro PF) como hijo. El grafo anidado **es posible en BD**; **no está soportado** en precio en cascada, plantilla de presupuesto ni UI.

Precio KIT (`server/lib/catalogKit.js` → `computeKitCatalogPrice`):

```
precio(padre) = Σ qty_directa × unit_price(hijo)
```

Solo hijos **directos**. Si el hijo es otro KIT, se usa el `unit_price` guardado de ese KIT. **No hay recálculo de ancestros**: si cambia PRODUCTO_UNO, PRODUCTO_DOS y PRODUCTO_TRES quedan con precio viejo.

### 2.2 Presupuesto

Al agregar un PF se crea un **bundle** (`project_item_bundles` + líneas):

- Cabecera (`is_bundle_header`): el producto final, con el precio rollup.
- Componentes (`is_bundle_component`): **solo dependencias directas**.

Los componentes **no entran** en totales de lista ni en M1–M4 (`totalsFromRows` ignora `is_bundle_component`). El costo vive en la cabecera; el `tipo` de la cabecera (casi siempre ACTIVO) decide si todo el KIT alimenta base **activos** o **consumibles**.

La UI de presupuesto aplana el KIT (`shared/kitBudgetRows.js`). No hay árbol.

### 2.3 Visibilidad

No hay rol `EJECUTIVO`. En la práctica “ejecutivo / comercial” = **COMERCIAL** (y **VIEWER** en lectura). COMERCIAL **sí ve todo el catálogo activo**, incluidos PF. No hay flag “ocultar en cotización”.

COMERCIAL no ve precios unitarios (`commercialVisibility.js`); **sí ve descripciones** de las líneas del KIT. Si un intermedio se agregara como componente, el comercial lo vería en la tabla.

### 2.4 Finanzas, PDF, Excel, backup

| Superficie | Comportamiento actual | Riesgo si se anida sin diseño |
|------------|----------------------|-------------------------------|
| `shared/finance-engine.js` | Recibe bases activos/consumibles ya sumadas. No conoce BOM. | Si se explotara el BOM **en el presupuesto**, cambiarían CP/LP/estacionalidad. |
| PDF gerencia/cliente | Partidas por conjunto: cabecera + componentes **directos**. | Listaría intermedios como si fueran materiales. |
| Excel catálogo | Categoría, código, precio. **Sin BOM**. | No se pueden versionar recetas por Excel. |
| Excel/CSV presupuesto | Líneas + KIT/zona. | Misma aplanación de un nivel. |
| JSON SUPERUSER | `catalog_item_dependencies` + bundles. | Importaría grafos anidados **sin** explosión ni visibilidad. |
| Solicitudes de catálogo (COMERCIAL) | Alta/cambio de ítem. | Un comercial no debería pedir ni “vender” un intermedio. |
| Odoo | Contactos; no hay productos/BOM. | Fuera de alcance salvo decisión explícita. |

### 2.5 Lo que ya se puede reutilizar

- Tabla `catalog_item_dependencies` + `wouldCreateCycle`.
- Precio rollup de un nivel (`recalcKitItemPrice`).
- Bundles de presupuesto y modal de instancia KIT (`KitInstanceModal`).
- Editor plano de dependencias (`CatalogItemDependenciesEditor`).
- Tests de filas KIT (`tests/budget/kitBudgetRows.test.js`).

---

## 3. Brecha frente al caso PRODUCTO_UNO / DOS / TRES

| Necesidad | Hoy | Falta |
|-----------|-----|--------|
| Categoría KIT **no vendible** (intermedio) | Un solo flag `is_kit_category` = vendible | Distinguir **intermedio** vs **final** |
| Ocultar intermedios a COMERCIAL | Catálogo único para todos | Filtro de API + picker de presupuesto |
| Hijo = otro ensamble | BD lo permite | Recalc **en cascada**, explosión, UI árbol |
| Lista de materiales de producción | No existe | Motor puro + pantalla/export |
| No listar intermedios en materiales | Presupuesto lista hijos directos (incl. otros PF) | Vista **producción** ≠ vista **cotización** |
| Totales activos/consumibles de **hojas** | Totales del presupuesto = tipo de la **cabecera** | Totales de explosión (otra cifra) |
| UI Lego | Lista plana padre→hijo | Árbol anidado al editar receta |

Punto crítico: **cotización y fabricación no deben mezclarse**.

- **Cotización:** se vende PRODUCTO_TRES (una partida / un KIT). Precio = rollup coherente con la receta. COMERCIAL no arma ni ve intermedios.
- **Fabricación:** se explota el árbol hasta hojas ACTIVO/CONSUMIBLE. Los intermedios son **nodos de proceso**, no renglones de compra.

Si se explotara el BOM **dentro** de `project_items`, M1–M4 y el PDF comercial cambiarían de semántica (un KIT que hoy cuenta 100 % como ACTIVO pasaría a partir activos/consumibles hoja). Eso **no** está pedido; hay que **prohibirlo** salvo decisión de gerencia.

---

## 4. Ejemplo numérico (explosión)

Para **1 × PRODUCTO_TRES**:

Instancias de PRODUCTO_UNO = 1 (directo) + 2 (vía DOS) = **3**.

| Hoja | Cantidad |
|------|----------|
| ACTIVO1 | 3×2 + 1 (en DOS) = **7** |
| ACTIVO2 | 3×3 = **9** |
| ACTIVO3 | 3×1 + 1 (en TRES) = **4** |
| ACTIVO4 | **2** |
| ACTIVO5 | **1** |
| ACTIVO6 | **1** |
| CONSUMIBLE1 | 3×1 + 1 (en TRES) = **4** |
| CONSUMIBLE2 | **1** |

No salen en la lista: PRODUCTO_UNO, PRODUCTO_DOS, PRODUCTO_TRES.

El precio de catálogo de TRES, si cada intermedio tiene `unit_price` al día, coincide con Σ (qty hoja × precio hoja), porque DOS ya incluye 2×UNO.

---

## 5. Impacto en la lógica actual (por módulo)

### 5.1 Modelo de datos (catálogo)

Hace falta un **rol de fabricación** además de “es KIT”. Opciones:

**A — Flag de categoría (alineado al texto: “una categoría que funciona como kit”)**

```
catalog_categories.kit_kind  NULL | 'INTERMEDIATE' | 'FINAL'
```

- `FINAL` = actual `is_kit_category` (Productos finales).
- `INTERMEDIATE` = nueva categoría (p. ej. Productos intermedios, prefijo `PI`).
- Precio calculado y BOM obligatorio en ambos.
- Migración: `is_kit_category = true` → `kit_kind = 'FINAL'`; mantener `is_kit_category` un tiempo como alias.

**B — Flag por ítem** (`manufacturing_role`)  
Más flexible, más UI y más riesgo de mezclar PF e intermedios en la misma categoría.

**Recomendación:** **A**, más un campo opcional por ítem `visible_in_quote BOOLEAN` por si un intermedio puntual debiera cotizarse (default `false` en INTERMEDIATE, `true` en FINAL).

No conviene un tercer valor en `item_tipo`: ACTIVO/CONSUMIBLE sigue describiendo el **resultado económico** del ensamble (un intermedio suele ser ACTIVO). El rol de fabricación es ortogonal.

### 5.2 Precio y dependencias (`catalogKit.js`, `catalogItemDependencies.js`)

Hoy el recálculo es **local**. Con anidación hay que:

1. Recalcular el ítem editado.
2. Recalcular **todos los ancestros** (quién lo usa, y quién usa a esos).
3. Tope de profundidad (p. ej. 8) además del anti-ciclo.
4. Al cambiar precio de una **hoja**, invalidar/recalcular KITs e intermedios que la cuelgan (directa o transitivamente).

El anti-ciclo actual **sí** sirve (DFS hijo → … → ¿vuelve al padre?).

Restricción de negocio a validar en código:

- Un **FINAL** puede depender de intermedios, hojas y (¿otros finales?). Lo más limpio: **final no depende de otro final** (evita vender un PF “dentro” de otro PF).
- Un **INTERMEDIATE** puede depender de intermedios y hojas, **no** de un FINAL (el final es output de venta, no insumo).

Esas reglas no existen hoy: un PF puede colgarse de otro PF.

### 5.3 API de catálogo y caché

- `GET /api/catalog` (Redis): para COMERCIAL/VIEWER **filtrar** ítems/categorías `INTERMEDIATE`.
- ADMIN/SUPERUSER/SEMIADMIN: catálogo completo (editor Lego).
- `GET .../kit-template`: hoy `NOT_KIT_ITEM` si no es categoría KIT. Debe aceptar FINAL (presupuesto) e INTERMEDIATE (solo roles de catálogo/producción).
- Nuevo: `GET /api/catalog/items/:id/bom-explode?qty=` → árbol + hojas consolidadas + totales tipo.
- Excel catálogo: hojas extra `BOM` (padre, hijo, qty) o no se puede mantener recetas fuera de la UI.
- Caché: dos vistas (full vs quote) o filtrar en servidor tras el cache full.

### 5.4 Presupuesto (no romper cotización)

Al agregar un **FINAL**:

- Cabecera = producto final (como ahora).
- Componentes del bundle: **solo hojas y, si se desea trazabilidad interna, intermedios colapsados** — decisión de producto:

  | Variante | Comercial ve | Producción | Esfuerzo |
  |----------|--------------|------------|----------|
  | **P0** Cabecera + hijos **directos** (hoy) | Intermedios si el final los tiene como hijo | Insuficiente | 0, pero no cumple el pedido |
  | **P1** Cabecera + **solo hojas explotadas** | Materiales, sin nombres de intermedio | Lista útil; se pierde el árbol en el presupuesto | Medio; cambia PDF/Excel de partidas |
  | **P2** Presupuesto **igual que hoy** (o solo cabecera) + pestaña **Fabricación** | Cotiza el PF | Árbol + lista explotada | **Recomendado** |

**Recomendación P2:** no reescribir `project_item_bundles` ni `kitBudgetRows` ni M1–M4. La fabricación lee el **catálogo** (receta) × **qty de cabeceras FINAL** del proyecto.

Si el comercial **personaliza** el KIT (quita un componente en `KitInstanceModal`), la receta de catálogo y la instancia **divergen**. Hay que decidir:

- Fabricación usa **receta de catálogo** (ignora extras/quitas del presupuesto), o
- Fabricación usa **líneas reales del bundle** y explota solo los hijos que sigan siendo intermedios.

Lo honesto para planta es la **instancia del presupuesto** (lo que se va a entregar), no la plantilla. Eso implica guardar en el bundle suficiente para re-explotar (hoy los componentes intermedios estarían como líneas `catalog_item_id` y se puede explotar desde ahí).

### 5.5 Finanzas (M1–M4)

**No cambiar** el motor ni las bases del proyecto por la explosión.

Documentar en UI de fabricación: “Totales de materiales ≠ totales de lista / módulos financieros”. El KIT sigue cotizándose por precio de cabecera y `tipo` de cabecera.

### 5.6 PDF / export

- PDF **cliente / gerencia**: sin intermedios, sin BOM de planta (salvo un PDF nuevo “Lista de materiales”).
- Nuevo export producción: Excel/PDF con árbol + tabla consolidada de hojas + totales ACTIVO/CONSUMIBLE.
- CSV presupuesto: no mezclar columnas de explosión con la lista comercial.

### 5.7 Roles y pantallas

| Rol | Catálogo intermedios | Pestaña Fabricación | Agregar PF al presupuesto |
|-----|----------------------|---------------------|---------------------------|
| SUPERUSER / ADMIN / SEMIADMIN | CRUD + Lego | Sí | Sí |
| COMERCIAL | No listados | No (o solo lectura del consolidado, sin nombres de receta — a definir) | Sí, solo FINAL |
| VIEWER | No | No | No |

“Ejecutivo” no es un rol: tratarlo como COMERCIAL. Si más adelante existe un perfil planta, sería un rol nuevo (`PRODUCCION`) o un flag; **no está en el alcance mínimo**.

### 5.8 UI Lego (catálogo)

Sustituye (o envuelve) el editor plano al crear/editar INTERMEDIATE y FINAL.

- Un **bloque** = ítem ensamblado (nombre, código, qty respecto al padre).
- **Dentro:** hijos; si el hijo es intermedio, otro bloque anidable.
- Hojas: chips ACTIVO / CONSUMIBLE (colores ya usados en presupuesto).
- Acciones: agregar hoja, agregar intermedio existente, crear intermedio in-situ (opcional, fase 2).
- Preview de explosión y totales hoja **en el mismo modal**.

No es el layout del workspace de presupuesto (catálogo + líneas + finanzas). Es un canvas/modal de receta.

### 5.9 Tests que habría que ampliar

- Motor puro `explodeBom(items, deps, rootId, qty)` (Vitest, como `finance-engine`).
- Anti-ciclo + tope de profundidad + “final no cuelga de final”.
- Cascada de precios (cambiar hoja → ancestros).
- `GET /catalog` COMERCIAL sin categoría intermedia.
- Totales de explosión ≠ `totalsFromRows` del presupuesto.
- No romper `kitBudgetRows` ni restore de revisiones.

---

## 6. Alcance propuesto

### 6.1 Dentro (MVP)

1. `kit_kind` (o equivalente) + categoría **Productos intermedios**.
2. Visibilidad: intermedios fuera del catálogo de cotización (COMERCIAL/VIEWER).
3. Recalc de precio **en cascada** y reglas de grafo (ciclo, profundidad, final/intermedio).
4. Motor `explodeBom` en `shared/` (sin I/O).
5. UI Lego en catálogo (crear/editar receta) + preview de explosión.
6. En el proyecto: pestaña o vista **Lista de materiales / Fabricación** a partir de los PF del presupuesto × qty, explotando receta (definir si plantilla o instancia).
7. Totales de hojas ACTIVO vs CONSUMIBLE en esa vista.
8. Export Excel de esa lista (y opcionalmente del árbol).
9. Tests del motor y de visibilidad.
10. Documentar en guía de usuario: intermedio ≠ partida de venta.

### 6.2 Fuera del MVP (explícito)

- Cambiar M1–M4 o totales de lista por explosión.
- Mostrar intermedios en PDF comercial.
- Rol `EJECUTIVO` / `PRODUCCION` nuevo.
- Sincronizar BOM con Odoo (mrp.bom).
- MRP, stock, órdenes de fabricación, merma real de planta.
- Excel de catálogo redondo ida/vuelta con BOM (puede ser fase 1.1).
- Personalización Lego **dentro del presupuesto** (el modal KIT actual sigue plano).
- Intermedios vendibles caso a caso (salvo el flag `visible_in_quote` si se incluye sencillo).
- Costeo por merma/scrap distinto del `cpMerma` financiero.

### 6.3 Decisiones que hay que cerrar antes de codear

1. **Instancia vs plantilla** para la lista de planta (recomendado: instancia del presupuesto).
2. ¿COMERCIAL ve la pestaña Fabricación (solo consolidado de hojas, sin nombres de intermedio)?
3. ¿Un FINAL puede incluir otro FINAL? (recomendado: no).
4. ¿Tope de profundidad 8 es suficiente?
5. ¿Los intermedios inactivos se explotan igual (versión histórica) o se bloquea el PF?

---

## 7. Fases sugeridas (cuando se implemente)

No están en el sprint actual; son un corte de trabajo futuro.

| Fase | Entrega | Riesgo para lo existente |
|------|---------|---------------------------|
| **F0** Motor + migración `kit_kind` + recálculo cascada + filtros de catálogo | Nadie cotiza distinto; ADMIN ya puede cargar recetas anidadas | Bajo si el presupuesto sigue usando solo FINAL y un nivel en el bundle |
| **F1** UI Lego en catálogo + preview explosión | Recetas usables | Nulo en cotización |
| **F2** Vista Fabricación del proyecto + Excel | Planta tiene guía | Nulo en M1–M4 si no se tocan totales |
| **F3** (opcional) Bundle de presupuesto con hojas explotadas **solo** en PDF interno | Cuidado con gerencia vs cliente | Medio |

F0 debe incluir la regla: agregar al presupuesto un ítem INTERMEDIATE → **400** (`NOT_QUOTABLE`), para que nadie lo cuele por API.

---

## 8. Riesgos

- **Doble conteo visual:** si el presupuesto lista PRODUCTO_UNO como componente **y** la fabricación lista sus hojas, gerencia puede sumar las dos vistas. Hay que etiquetar “materiales de planta” vs “lista de venta”.
- **Precio desfasado** sin cascada: TRES más barato/caro que la suma de hojas.
- **Personalización del KIT** en presupuesto vs receta de catálogo (lista de planta “mentirosa”).
- **Performance:** explosión N×M en proyectos con muchos PF; el motor debe agrupar por `catalog_item_id` y memoizar subárboles.
- **Permisos:** un comercial que reciba el Excel de catálogo **completo** hoy ya ve PF; habrá que filtrar export de catálogo por rol o el intermedio se filtra igual.

---

## 9. Conclusión

El KIT actual es un **producto final vendible de un nivel**, pensado para cotizar (cabecera + componentes, precio en la cabecera, finanzas por `tipo` de cabecera).

El requerimiento es un **BOM multinivel de fabricación** con nodos que **no se venden**. Encaja como **capa nueva** (categoría intermedia + explosión + UI Lego + vista de planta), no como un parche al flatten del presupuesto.

Si se implementara “a lo bruto” (colgar PF dentro de PF y dejar el bundle de un nivel), el comercial vería intermedios, el precio de ancestros se quedaría viejo, y planta no tendría la lista consolidada de activos/consumibles.

**No implementar encima de M1–M4 ni sustituir la lista de cotización por el BOM explotado.**
)
</parameter>
</invoke>