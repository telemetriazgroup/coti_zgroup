# Plan de implementación — Contactos Odoo 17 en Cotizaciones ZGROUP

Documento de trabajo para integrar el módulo **Contactos** de Odoo 17 (`res.partner`) en este sistema, de modo que al **crear o editar un proyecto** el campo **Cliente** se vincule a un contacto de Odoo.

Fuente de reglas técnicas: `implicancias_odoo_17.md`.
Estado actual del producto: Node.js 20 + Express + **PostgreSQL 15** + Redis + React. No hay Mongo ni FastAPI.

---

## 0. Alcance y no-alcance

### En alcance (este plan)

- Consumir `res.partner` (empresas + personas) por XML-RPC.
- Cachear contactos **en PostgreSQL** (nunca leer Odoo en el request HTTP del usuario).
- Sincronización periódica (15 min) + botón «Actualizar contactos».
- En **Nuevo proyecto / Editar proyecto**, el `ClientPicker` busca y selecciona contactos sincronizados (prioridad: etiqueta **Cliente**).
- Vincular `projects.client_id` → fila local de `clients` que apunta a un `odoo_id`.
- Validar la conexión, permisos, whitelist de campos y el primer pull antes de tocar la UI de cotizaciones.

### Fuera de alcance (fases posteriores, no este documento)

- Sincronizar **cotizaciones / pedidos de venta** de Odoo (el campo `projects.odoo_ref` sigue siendo texto libre: número de cotización, no el id del contacto).
- Webhooks Odoo → app.
- Fotos (`image_1920`) ni campos binarios.
- Reemplazar el CRM local de un día para otro sin migración.

### Distinción crítica de campos

| Campo | Significado | No confundir con |
|---|---|---|
| `projects.odoo_ref` | Referencia de **cotización** en Odoo (texto libre hoy) | Id de `res.partner` |
| `clients.odoo_id` | Id entero de **contacto** `res.partner` | Número de cotización |
| `clients.id` | UUID local; es lo que guarda `projects.client_id` | |

---

## 1. Decisiones de arquitectura (adaptadas a este repo)

`implicancias_odoo_17.md` propone Mongo + FastAPI. **En este proyecto se traduce así:**

| Decisión del análisis | Cómo se implementa aquí |
|---|---|
| Caché local, app nunca llama a Odoo en request | Tablas PostgreSQL + workers. Las rutas `/api/clients` y `/api/projects` leen solo Postgres. |
| Pull cada 15 min por `write_date` | Job BullMQ (Redis ya existe para PDF) o `setInterval` con lock. |
| Botón «Actualizar contactos» | Dispara **el mismo** job incremental, con lock + debounce 60 s. |
| Alta/edición hacia Odoo | Outbox en Postgres + worker de subida. **Fase 5**; las fases 0–4 son solo lectura. |
| No complicar Odoo | Un módulo custom mínimo (`x_ztrack_uid` + índice `write_date`). Cero overrides de `create`/`write`. |
| Mongo `contactos_odoo` / `outbox` / `sync_estado` | Equivalentes SQL (ver etapa 2). Redis solo para lock/debounce/circuit breaker. |

**Regla dura (igual que el análisis):** si Odoo está caído, en actualización o apagado, Cotizaciones sigue funcionando con datos de hasta ~15 minutos de antigüedad.

```
  Odoo 17  res.partner
       │ XML-RPC + API key
       ▼
  Worker pull (15 min / botón)
       │ upsert idempotente por odoo_id
       ▼
  PostgreSQL
    odoo_partners   ← caché completa
    clients         ← proyección CRM (lo que usa el proyecto)
    odoo_sync_state
    odoo_outbox     ← solo desde fase 5
       │
       ▼
  Express  GET /api/clients  ·  ClientPicker  ·  POST /api/projects
```

---

## 2. Mapeo de datos Odoo → Cotizaciones

### 2.1 Whitelist de campos (congelar en código)

Inventariar una vez con `fields_get` y **no** pedir `*`. Base:

```
id, name, display_name, complete_name, ref, active, company_type, is_company,
parent_id, type, function, title, vat, l10n_latam_identification_type_id,
street, street2, city, state_id, country_id, zip,
phone, mobile, email, website, comment, lang, tz,
category_id, user_id, customer_rank, supplier_rank,
create_date, write_date
```

Perú (`l10n_pe`, si está instalado): `l10n_pe_district` y tipo de documento. **`vat` puede lanzar `ValidationError`** al escribir (fase 5).

Normalización XML-RPC (rompe mapeos si no se prevé):

| Situación | Odoo devuelve | Guardar en PG como |
|---|---|---|
| Vacío | `False` | `NULL` |
| Many2one | `[id, "Nombre"]` | `id` + `nombre` en columnas aparte |
| Many2many (`category_id`) | `[id, …]` | `INTEGER[]` o tabla puente |
| Datetime | `"2026-08-18 14:03:22"` naive UTC | `TIMESTAMPTZ` |

Comparar vacío **explícitamente contra `False`**, no con `if (!valor)`.

### 2.2 Proyección a `clients` (lo que ve el comercial)

El Kanban de Odoo mezcla **empresas** (edificio) y **personas** (contacto hijo con `parent_id`). En cotizaciones el cliente del proyecto es, en la práctica, la **empresa** (razón social + RUC).

| `clients` hoy | Origen Odoo | Notas |
|---|---|---|
| `razon_social` | `name` de la empresa (`is_company` / `company_type=company`) | Si el usuario elige un contacto hijo, guardar la **empresa padre** como cliente y el hijo como contacto. |
| `ruc` | `vat` | Quitar espacios; no forzar 11 dígitos si Odoo trae DNI/CE. |
| `contacto_nombre` | `name` del hijo `type=contact` elegido, o el comercial (`user_id`) | Preferir el contacto seleccionado en el picker. |
| `contacto_email` | `email` del hijo o de la empresa | |
| `contacto_telefono` | `mobile` o `phone` | |
| `direccion` | `street` + `street2` | |
| `ciudad` | `city` (+ distrito PE si existe) | |
| `notas` | `comment` (opcional) | No copiar comentarios internos largos sin recorte. |
| `active` | `active` | Archivado en Odoo → no seleccionable. |

**Filtro de negocio para el picker de proyectos:**

1. Prioridad: etiqueta **Cliente** (`category_id` / `res.partner.category`).
2. Respaldo: `customer_rank > 0` si las etiquetas no están consistentes.
3. Excluir: `active = false`, `borrado_en_odoo`, y (por defecto) **Proveedor** puro (`supplier_rank > 0` y `customer_rank = 0` sin tag Cliente).
4. Mostrar jerarquía: `CALLUPE & ANTARA…` (empresa) y debajo `Harold Flores` (contacto) como opción que **vincula la empresa** y rellena el contacto.

IDs de etiquetas Cliente / Proveedor / Contacto **no se hardcodean**: se resuelven una vez (`search` en `res.partner.category` por `name`) y se guardan en `odoo_sync_state` o env.

### 2.3 Clientes locales preexistentes

Hay filas en `clients` creadas a mano o por Excel, **sin** `odoo_id`. Política:

1. Match automático **solo** si RUC (11 dígitos) coincide 1:1 con `vat` de una empresa activa.
2. Si hay 0 o >1 coincidencias → dejar sin vincular; listar en un informe de reconciliación (SUPERUSER).
3. Nunca pisar `razon_social` local en el primer match; a partir de vinculado, **Odoo manda** en pull (fase 4).

---

## 3. Plan por etapas

Cada etapa tiene **criterio de salida** (no pasar a la siguiente sin cumplirlo) y **validación de conexión** explícita.

---

### Etapa 0 — Acceso, inventario y contrato de campos

**Objetivo:** poder hablar con Odoo sin tocar Cotizaciones.

**Acciones Odoo**

1. Usuario dedicado `integracion.ztrack` (interno), **no** cuenta de una persona.
2. API Key en *Preferencias → Seguridad → Nuevas claves API*. Usar la key **en lugar del password**.
3. Grupo mínimo: *Contactos / Responsable*.
4. Confirmar Community vs Enterprise (licencia del usuario interno).
5. Anotar URL (`https://…`), base de datos, y si hay reverse proxy: abrir **solo** `/xmlrpc/2/*` desde la IP del servidor de Cotizaciones.

**Acciones Cotizaciones (sin UI)**

1. Variables en `.env` / `deploy/docker-compose.env.example` (nunca commitear secretos):

   ```
   ODOO_URL=
   ODOO_DB=
   ODOO_USER=integracion.ztrack
   ODOO_API_KEY=
   ODOO_TIMEOUT_MS=20000
   ODOO_SYNC_ENABLED=0
   ```

2. Cliente XML-RPC Node (`xmlrpc` o equivalente) con:
   - timeouts,
   - 1–2 conexiones **secuenciales** (no saturar `--workers` de Odoo),
   - circuit breaker (tras N fallos, 10 min de pausa).

3. Script one-shot `server/scripts/odoo-probe.js` (o similar):
   - `common.version` / `authenticate` → `uid`
   - `res.partner` `fields_get` → volcar JSON de campos a un archivo de inventario (no a git si es enorme; sí un resumen).
   - `search_read` de **1** partner con whitelist.
   - `res.partner.category` `search_read` para etiquetas Cliente / Proveedor / Contacto.

**Validación de conexión (obligatoria)**

| Prueba | Resultado esperado | Si falla |
|---|---|---|
| HTTPS + certificado | TLS válido | No seguir con HTTP en producción |
| `authenticate` | `uid` entero | Usuario, DB o key incorrectos |
| `AccessError` al leer partner | No debe ocurrir | Faltan grupos |
| `fields_get` incluye `vat`, `category_id`, `parent_id`, `write_date` | Sí | Localización distinta; ajustar whitelist |
| `False` vs `null` en un partner sin email | Se normaliza a `NULL` | Arreglar parser antes del upsert |
| Tiempo de 1 `search_read` limit 1 | < 2 s típico | Red / workers; no subir paralelismo |

**Criterio de salida:** inventario de campos firmado (whitelist congelada) + script de probe verde en el entorno real (staging). `ODOO_SYNC_ENABLED` sigue en `0`.

**Código listo en repo (falta ejecutar el probe contra Odoo real):**

| Pieza | Ubicación |
|---|---|
| Whitelist congelada | `server/lib/odoo/partnerFields.js` |
| Codec XML-RPC + Fault | `server/lib/odoo/xmlrpcCodec.js` |
| Config / HTTPS / subpath | `server/lib/odoo/config.js` |
| Circuit breaker 5 fallos / 10 min | `server/lib/odoo/circuitBreaker.js` |
| Cliente HTTP 1 llamada a la vez + timeout | `server/lib/odoo/xmlrpcClient.js` |
| `False` → `null`, many2one, fechas UTC | `server/lib/odoo/normalizePartner.js` |
| Probe | `npm run odoo:probe` → `server/scripts/odoo-probe.js` |
| Inventario (gitignored) | `tmp/odoo-partner-fields.json`, `tmp/odoo-probe-report.json` |
| Tests | `tests/odoo/*.test.js` |

Operación: crear usuario `integracion.ztrack` + API key en Odoo, rellenar `.env`, correr `npm run odoo:probe`. No activar `ODOO_SYNC_ENABLED`.

---

### Etapa 1 — Módulo mínimo en Odoo (sin lógica de negocio)

**Objetivo:** idempotencia futura y pull barato. No heredar `create`/`write`. No HTTP desde Odoo.

Módulo custom (nombre tentativo `zgroup_partner_ext`):

- Campo `x_ztrack_uid` `Char`, `index=True`, `copy=False`, SQL `UNIQUE`.
- Índice `res_partner_write_date_idx` sobre `write_date` (Odoo **no** lo indexa por defecto; con >10k contactos el pull incremental se vuelve seq scan).

**Validación**

- Instalar en una BD de prueba, no producción primero.
- `search` por `x_ztrack_uid` de un UUID inventado → 0 registros.
- `EXPLAIN` (o tiempo) de `search_read` con `write_date >= …` sobre el volumen real (~10k+).
- Confirmar que **no** hay acciones automatizadas con `requests.post` hacia Cotizaciones.

**Criterio de salida:** módulo instalado en **staging**; índice presente; core de `res.partner` intacto.

Documentación de espera de accesos Odoo.sh, importancia de la prueba y trabajo en paralelo: **`fase1_odoo.md`**.

**Código del módulo (este repo):** `odoo_addons/zgroup_partner_ext/`

| Archivo | Rol |
|---|---|
| `__manifest__.py` | Módulo 17.0, depende solo de `base` |
| `models/res_partner.py` | `x_ztrack_uid` Char unique + `init()` índice `res_partner_write_date_idx` |

No hereda `create`/`write`. No hace HTTP.

### Cómo instalarlo (Odoo.sh — zgroup.odoo.com)

Esta instancia es **Odoo.sh / producción**. El módulo **no se instala desde Cotizaciones**; hay que copiarlo al repositorio Git de Odoo.sh.

1. En el proyecto Git de Odoo.sh, copiar la carpeta `zgroup_partner_ext` (tal cual) a la raíz de addons (junto a otros módulos custom).
2. **Primero un branch staging / dev**, nunca `production` como primer intento.
3. Esperar el build de Odoo.sh.
4. Apps → quitar filtro «Aplicaciones» → **Actualizar lista de aplicaciones** → buscar **ZGROUP Partner Ext** → Instalar.
5. Confirmar a mano: Ajustes → Técnico → Modelos → `res.partner` → campo `x_ztrack_uid`.
6. Confirmar que **no** hay acciones automatizadas de Contactos con código Python que haga `requests.post` a Cotizaciones.
7. Validar desde este repo:

```bash
npm run odoo:probe:stage1
```

Debe verse `campo x_ztrack_uid` y `search x_ztrack_uid UUID inventado: 0 filas`.

**No** instalar primero en producción. Tras staging OK, merge al branch de producción de Odoo.sh.

El índice `write_date` no se ve por XML-RPC; si el lote de 300 tarda >3 s, revisar en el PostgreSQL de Odoo (`\d res_partner` / `res_partner_write_date_idx`).

---

### Etapa 2 — Modelo local en PostgreSQL

**Objetivo:** persistir la caché sin Mongo y sin romper `clients` / `projects` actuales.

Migración nueva (p. ej. `023_odoo_partners.sql`):

**Tabla `odoo_partners`** (caché cruda + normalizada)

- `odoo_id INTEGER PRIMARY KEY`
- `x_ztrack_uid UUID UNIQUE` (sparse / NULL hasta fase 5)
- `raw JSONB NOT NULL` (respuesta Odoo; evita re-sync cuando mañana se necesite un campo)
- Columnas de búsqueda: `name`, `display_name`, `vat`, `email`, `phone`, `mobile`, `city`, `is_company`, `parent_odoo_id`, `type`, `active`, `customer_rank`, `supplier_rank`, `category_ids INTEGER[]`
- `odoo_write_date TIMESTAMPTZ NOT NULL`
- `last_pushed_write_date TIMESTAMPTZ` (eco, fase 5)
- `sync_status VARCHAR`: `sincronizado | pendiente | conflicto | borrado_en_odoo`
- `updated_at TIMESTAMPTZ`
- Índices: `vat`, `name` (`pg_trgm` si la búsqueda lo pide), `parent_odoo_id`, `write_date`, GIN `category_ids`

**Tabla `odoo_sync_state`**

- `_id` / `model` PK (`res.partner`)
- `watermark TIMESTAMPTZ`
- `last_run_at`, `last_ok_at`, `duration_ms`
- `created_n`, `updated_n`, `error_n`, `last_error`
- `category_cliente_id`, `category_proveedor_id`, `category_contacto_id` (enteros Odoo)

**Tabla `odoo_sync_locks`** (o usar Redis `SET lock NX EX 300`)

- Lock `sync_partners` con `expires_at`. El botón y el cron **no** pueden correr a la vez.

**Extender `clients`**

- `odoo_id INTEGER UNIQUE` (NULL = cliente solo local)
- `odoo_parent_id INTEGER` (empresa padre si se eligió un contacto)
- `odoo_contact_id INTEGER` (persona seleccionada, opcional)
- `sync_origin VARCHAR`: `local | odoo | linked`
- `odoo_write_date TIMESTAMPTZ`

**No** borrar físicamente `clients` si Odoo elimina el partner: marcar `sync_status` / `active=false` y bloquear selección. `projects.client_id` sigue válido (históricos).

**Validación**

- Migración idempotente (`IF NOT EXISTS`) como el resto de `server/db/migrations/`.
- Seed / demo actual sigue creando cliente local **sin** `odoo_id`.
- Backup / `systemExport` (SUPERUSER): decidir si `odoo_partners` entra en el JSON de backup (recomendado: sí, para no rehacer full pull).

**Criterio de salida:** schema aplicado al arrancar la API (`023_odoo_partners.sql`); CRM actual sin regresiones (`sync_origin=local`, `odoo_id` NULL); backup SUPERUSER incluye `odoo_partners`.

**Hecho en repo (etapa 2):**

| Pieza | Ubicación |
|---|---|
| Migración | `server/db/migrations/023_odoo_partners.sql` |
| Schema de referencia | `server/db/schema.sql` |
| Constantes / mapeo | `server/lib/odoo/syncStatus.js` |
| API clientes | `mapClient` expone `odooId`, `syncOrigin` (picker aún no cambia) |
| Backup | `systemExport.js` exporta/importa caché Odoo |

Etiquetas por defecto en `odoo_sync_state`: Cliente=3, Proveedor=4, Contacto=5 (inventario etapa 0). El pull (etapa 3) puede actualizarlas.

**No incluido aún:** worker de bajada, endpoints `/api/odoo/sync/*`, cambios en `ClientPicker`. `ODOO_SYNC_ENABLED=0`.

---

### Etapa 3 — Cliente RPC + workers de bajada (sin UI de cotización)

**Objetivo:** llenar `odoo_partners`. La UI de proyectos **aún no cambia**.

**Implementación**

1. `server/lib/odoo/xmlrpcClient.js` — `authenticate` + `execute_kw`.
2. `server/lib/odoo/normalizePartner.js` — `False` → `null`, many2one, fechas UTC.
3. `server/lib/odoo/pullPartners.js`:
   - Dominio: `[('write_date', '>=', watermark - 120s)]`
   - `search_read`, lotes de 300, `order: write_date asc, id asc`
   - Context: `active_test: False`, `bin_size: True`, `lang: es_PE`
   - Watermark **nuevo** = `max(write_date)` del lote, **no** `NOW()` local
   - Upsert por `odoo_id` (idempotente; el solape de 2 min solo reescribe)
   - Concurrencia: 1 llamada a la vez
4. Job:
   - Primera corrida: watermark `1970-01-01` (full incremental por páginas; con 10k registros ≈ 35 lotes)
   - Luego cada 15 min
   - Reutilizar Redis/BullMQ como el worker PDF (`server/index.js` ya arranca workers)
5. Reconciliación de **borrados**: job diario de madrugada, `search` de todos los ids (`active_test: False`), marcar faltantes `borrado_en_odoo`. No `DELETE`.
6. Endpoint interno (SUPERUSER):
   - `POST /api/odoo/sync/partners` → encola el **mismo** job, debounce 60 s, lock 5 min
   - `GET /api/odoo/sync/health` → watermark, antigüedad, errores, circuit breaker

**Validación de conexión (pull)**

| Prueba | Cómo | OK si |
|---|---|---|
| Probe sigue verde con `ODOO_SYNC_ENABLED=1` | health + logs | authenticate ok |
| Primer full pull | logs: lotes, duración, conteo | `COUNT(*)` `odoo_partners` ≈ `search_count` Odoo (± archivados) |
| Idempotencia | correr el job 2 veces seguidas | 2ª corrida: 0 creados, solo actualizados/solape |
| Watermark | inspeccionar `odoo_sync_state` | no usa reloj de Node; avanza con `write_date` Odoo |
| Archivado | archivar un partner en Odoo, esperar pull | `active=false` local; no desaparece la fila |
| Borrado | (staging) unlink un partner, esperar job diario | `borrado_en_odoo`; clientes/proyectos no rotos |
| Lock | clic triple + cron | una sola corrida |
| Circuit breaker | URL inválida temporal | deja de martillar; health en rojo |
| Carga Odoo | durante el pull, usar Contactos en Odoo | UI Odoo usable (no 20 RPC paralelos) |
| Parser | partner con `email=False`, `parent_id=False` | columnas NULL, no string `"False"` |

**Criterio de salida:** caché poblada (botón SUPERUSER o `npm run odoo:sync`); health en `/superusuario`; CRM y presupuestos intactos. El picker usa la caché desde etapa 4.

**Hecho en repo (etapa 3):**

| Pieza | Ubicación |
|---|---|
| Pull + watermark + solape 2 min | `server/lib/odoo/pullPartners.js` |
| Lock PG + debounce 60 s | `syncLock.js` + `pullHelpers.js` |
| Cron 15 min si `ODOO_SYNC_ENABLED=1` | `server/workers/odooSync.worker.js` |
| API SUPERUSER | `GET/POST /api/odoo/sync/*` |
| UI | Panel Contactos Odoo en `SuperuserPage` |
| CLI primera carga | `npm run odoo:sync` (no exige el cron) |

El POST **no espera** el pull (evita timeout HTTP). Consulte `GET /health`. Primera carga ~10k ≈ 35 lotes; programar fuera de punta si Odoo va lento (índice `write_date` aún falta: etapa 1).

---

### Etapa 4 — Vincular CRM y picker de proyecto (lectura)

**Objetivo de producto:** al crear/editar proyecto, **Cliente** se elige desde contactos Odoo (caché), no desde una lista local desconectada.

**Backend**

1. Tras cada pull, **proyectar** empresas elegibles a `clients`:
   - Upsert por `odoo_id`
   - Actualizar razón social, RUC, dirección, ciudad, `active`
   - No borrar clientes locales sin `odoo_id`
2. Job de **link** RUC 1:1 para huérfanos locales (informe de ambiguos).
3. `GET /api/clients`:
   - Seguir sirviendo `clients` (el picker no debe pegarle a Odoo)
   - Incluir `odooId`, `isCompany`, `parentName`, tags, `syncOrigin`
   - Búsqueda: razón social, RUC, nombre de contacto hijo, email, ciudad
   - Con +10k filas: **no** mandar el catálogo entero al browser. Endpoint paginado / typeahead `?q=&limit=30` (el `ClientPicker` actual carga toda la lista: hay que cambiarlo).
4. Crear cliente **solo local** (Excel / «+ Crear cliente») permanece, con `sync_origin=local`. En UI, marcar «No está en Odoo» hasta fase 5.

**Frontend**

1. `ClientPicker` (usado en `ProjectsPage` y `ProjectBudgetPage`):
   - Buscar contra API (debounce 200–300 ms, mismo patrón que catálogo).
   - Mostrar empresa en negrita; contactos hijos indentados (`parent_id`).
   - Tags visuales: Cliente / Proveedor / Contacto (solo lectura).
   - Al elegir un **contacto hijo**: `client_id` = empresa (o crear proyección de la empresa) + guardar `odoo_contact_id` para email/teléfono.
   - Al elegir **empresa**: `client_id` de esa empresa; contacto vacío o primer hijo.
   - Ocultar `borrado_en_odoo` y `active=false`.
   - Si sync health > 45 min: aviso discreto «Contactos Odoo desactualizados».
2. Página Clientes: badge «Odoo», RUC, última sync; no editar a ciegas campos que Odoo manda (o dejarlos read-only hasta fase 5).
3. SUPERUSER: botón «Actualizar contactos» + panel de health (puede vivir en Dashboard superusuario o Clientes).

**Validación funcional (cotizaciones)**

| Caso | Esperado |
|---|---|
| Nuevo proyecto, buscar «CALLUPE» | Aparece la empresa; seleccionar setea `client_id` |
| Nuevo proyecto, buscar persona «Harold» | Aparece bajo la empresa; el proyecto queda vinculado a la **empresa** |
| Cliente sin tag Cliente pero `customer_rank>0` | Visible (respaldo); documentar |
| Proveedor puro | No sale en picker de proyecto (sí puede listarse en admin) |
| Odoo caído | Picker sigue con caché; crear proyecto no espera RPC |
| Cliente local histórico | Sigue seleccionable; badge «local» |
| PDF / listado proyectos | Sigue usando `client_razon_social` local (ya proyectado) |
| VIEWER | No usa el picker; no ve CRM |

**Hecho en repo (etapa 4):**

| Pieza | Ubicación |
|---|---|
| Proyección empresas elegibles → `clients` | `server/lib/odoo/projectClients.js` (tras cada pull y `POST /api/odoo/sync/project-clients`) |
| Link RUC 1:1 + informe de ambiguos | mismo módulo; `GET /api/odoo/sync/clients-link` |
| Typeahead picker | `GET /api/clients/picker?q=&limit=30` + `POST /api/clients/from-odoo` |
| ClientPicker | debounce 250 ms; empresa negrita / hijo indentado; sin XML-RPC |
| CRM | badge Odoo / local; campos Odoo read-only |

El POST de proyecto **no** llama a Odoo. Si la proyección aún no corrió, `from-odoo` crea la fila `clients` al elegir.

**Criterio de salida:** un comercial crea un proyecto eligiendo un contacto Odoo; `projects.client_id` apunta a `clients.odoo_id` correcto; cero llamadas XML-RPC en ese POST.

---

### Etapa 4.1 — Ficha Odoo (lectura) e integración en el cotizador

**Objetivo:** el módulo Clientes se parece a la ficha de Contactos de Odoo 17 y esos datos (RUC, dirección, contacto hijo) aparecen en presupuesto y PDF. Sin escritura a Odoo.

**Reglas**

- Ver ficha: todos los roles que ya entran a Clientes.
- Crear cliente **local**: solo **SUPERUSER**.
- Editar / archivar / eliminar: habilitado en etapa 5 (outbox hacia staging).
- Picker de proyecto: no crea locales (salvo SUPERUSER).

**Hecho en repo**

| Pieza | Ubicación |
|---|---|
| Ficha desde `odoo_partners.raw` + hijos | `GET /api/clients/:id` → `ficha` (`partnerCard.js`) |
| UI tipo Odoo | `ClientOdooFicha.jsx` + `ClientsPage` (lista + panel) |
| Cotizador | `mapProject` incluye RUC, dirección, contacto; tira en presupuesto; PDF gerencia/cabecera |

---

### Etapa 5 — Escritura hacia Odoo (opcional, bidireccional)

Activar solo cuando el negocio necesite **alta de clientes desde Cotizaciones** hacia Odoo. Hasta entonces, «+ Crear cliente» puede quedar local o deshabilitarse con mensaje «Créelo en Odoo y pulse Actualizar contactos».

**Patrón (del análisis)**

- No llamar a Odoo en el POST del usuario → fila en `odoo_outbox` (`create` / `write`), UUID `x_ztrack_uid`.
- Worker: `search` por `x_ztrack_uid` → si existe, recuperar `id` (timeout previo); si no, `create`.
- Tras `create`/`write` exitoso, leer `write_date` y guardar `last_pushed_write_date`. El pull **ignora eco** si `write_date <= last_pushed_wd`.
- Conflictos: **Odoo manda**. Si `write_date` remoto ≠ el conocido, marcar `conflicto` y mostrar ambos valores. Nunca merge campo a campo.
- Validaciones espejo **antes** de encolar: `name`, RUC (`l10n_pe`), `state_id` coherente con país, `category_id` con comandos `[(6, 0, ids)]`.
- Mapear `Fault`: `ValidationError` → mensaje de datos; `AccessError` → alerta permisos; `MissingError` → borrado; nunca traceback al comercial.

**Validación**

- Timeout simulado en `create`: reintento no duplica partner (clave `x_ztrack_uid`).
- Editar en app y en Odoo a la vez → conflicto visible, no dirección Frankenstein.
- Pull posterior no revierte el push (eco).

**Criterio de salida:** round-trip create/edit estable en staging; outbox con reintentos y backoff.

**Hecho en repo (prueba en staging, no production)**

| Pieza | Ubicación |
|---|---|
| Tabla `odoo_outbox` + `clients.x_ztrack_uid` | `027_odoo_outbox.sql`, `schema.sql` |
| Validación RUC PE / vals create-write | `partnerValidate.js` |
| Worker outbox (`search` UUID → `create`; conflicto gana Odoo) | `pushPartners.js` + `odooSync.worker.js` (outbox corre con cron OFF) |
| POST/PUT clientes encola, no llama XML-RPC en el request | `server/routes/clients.js` |
| UI crear/editar + estado outbox | `ClientsPage.jsx`, `ClientOdooFicha.jsx` |

**Cómo probar en staging**

1. En el `.env` de Cotizaciones (Docker), poner `ODOO_URL` / `ODOO_DB` / `ODOO_API_KEY` del **Connect** de staging (`*.dev.odoo.com`), no `zgroup.odoo.com`.
2. `ODOO_SYNC_ENABLED=0` (el outbox igual procesa cada 5 s). Contra `zgroup.odoo.com` el POST/PUT responde `ODOO_WRITE_BLOCKED` a propósito.
3. Rebuild: `docker compose build app && docker compose up -d app`.
4. Crear un cliente de prueba (RUC válido o vacío) → debe aparecer en Contactos de staging con `x_ztrack_uid`.
5. Editar razón social → se refleja en Odoo. Si alguien editó el mismo contacto en Odoo antes, el outbox marca `conflicto` y gana Odoo.
6. Reintento de create con el mismo UUID no duplica (el worker hace `search` primero).

No dejar el `.env` apuntando a staging después de la prueba si el día a día del picker debe seguir leyendo production.

---

### Etapa 6 — Producción, monitoreo y operación

**Health** (extender `GET /api/health` o endpoint SUPERUSER):

- Antigüedad del watermark y de `last_ok_at`
- Tamaño de outbox (fase 5)
- Conteos `conflicto` / `borrado_en_odoo`
- Duración y errores de la última corrida
- Estado del circuit breaker

**Alertas**

- Última sync OK > 45 min
- Outbox con > 5 intentos
- Cualquier `AccessError` (key o grupos cambiaron)

**Red**

- HTTPS; restringir `/xmlrpc/*` por IP en el reverse proxy de Odoo
- Timeouts explícitos
- Reconciliación full **fuera de horario** (volumen >10k)

**Runbook corto**

1. Fallo de key → rotar API key, actualizar `.env`, verificar probe.
2. Sync atrasada → ver lock, circuit breaker, workers Odoo, logs del job.
3. Cliente que «no aparece» → ¿tag Cliente? ¿archivado? ¿watermark? ¿filtro proveedor? ¿q typeahead?

**Criterio de salida:** checklist de `implicancias_odoo_17.md` §11 cubierto, con las casillas Mongo/FastAPI reemplazadas por PG/Express.

---

## 4. Archivos previstos (orientativo)

No implementar en este documento; guía para el desarrollo:

| Área | Archivos |
|---|---|
| Migración | `server/db/migrations/023_odoo_partners.sql` (+ `schema.sql`) |
| RPC / pull | `server/lib/odoo/xmlrpcClient.js`, `normalizePartner.js`, `pullPartners.js`, `projectToClient.js` |
| Jobs | `server/workers/odooSync.worker.js` (BullMQ) + arranque en `server/index.js` |
| Rutas | `server/routes/odooSync.js` (SUPERUSER) + ajustes `server/routes/clients.js` |
| UI | `client/src/components/ClientPicker.jsx`, `ClientsPage.jsx`, `ProjectsPage.jsx` |
| Config | `.env.example`, `deploy/docker-compose.env.example` |
| Probe | `server/scripts/odoo-probe.js` |
| Tests | tests de normalización (`False`→null), upsert, proyección, picker API |

---

## 5. Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
|---|---|---|
| 10k+ partners en el picker actual (lista completa) | UI lenta / timeout | Typeahead paginado desde etapa 4 |
| RUC duplicado local vs Odoo | Upsert rompe UNIQUE informal | Match 1:1 + cola de revisión |
| Confundir `odoo_ref` del proyecto con `odoo_id` del contacto | Cotización mal referenciada | No reutilizar `odoo_ref`; columnas nuevas |
| Pull en horario pico satura Odoo | Usuarios de Contactos lentos | Lotes 300, 1 RPC, full reconcile de madrugada |
| Introducir Mongo «porque el análisis lo dice» | Dos bases, backups rotos | **Prohibido**; todo en Postgres |
| Llamar Odoo desde `POST /api/projects` | Alta de proyecto falla si Odoo cae | Regla dura: solo caché |
| Etiquetas distintas en producción (`Clientes` vs `Cliente`) | Picker vacío | Resolver categorías en etapa 0 y guardar ids |
| `vat` inválido en fase 5 | Outbox en error eterno | Validar RUC PE en formulario; no reintentar ValidationError sin cambio de payload |

---

## 6. Orden de trabajo recomendado (resumen ejecutivo)

```
0  Probe + whitelist + env          → conexión validada
1  Módulo Odoo x_ztrack_uid+índice  → pull viable a escala
2  Tablas PG + columnas clients     → sin romper CRM
3  Worker pull + health SUPERUSER   → caché llena, UI igual
4  ClientPicker typeahead + vínculo proyecto  → objetivo de negocio
5  Outbox push (si se aprueba)      → altas desde la app
6  Alertas + runbook producción
```

**Primera entrega usable para cotizaciones = fin de etapa 4.**
Las etapas 0–3 son bloqueantes: sin conexión validada y sin caché, no se engancha el selector de cliente.

---

## 7. Checklist cruzado con `implicancias_odoo_17.md` §11

- [ ] Crear usuario de integración en Odoo + API key *(ops, no código)*
- [x] Cliente RPC con timeouts, reintentos y circuit breaker *(etapa 0: código; falta probe verde)*
- [x] `fields_get` y whitelist congelada en código (`partnerFields.js`); inventario real al correr el probe
- [x] Instalar módulo mínimo (`x_ztrack_uid` + índice en `write_date`) — etapa 1 *(código en `odoo_addons/zgroup_partner_ext`; instalado en staging Odoo.sh; falta production)*
- [x] Tablas `odoo_partners`, `odoo_sync_state`, `odoo_sync_locks` + columnas en `clients` — etapa 2
- [x] Tabla `odoo_outbox` — etapa 5
- [x] Worker de bajada: watermark + solape 2 min + paginación + upsert por `odoo_id`
- [x] Lock y debounce del botón manual
- [x] Worker de subida (etapa 5): outbox, UUID, eco
- [x] Job diario de reconciliación de borrados
- [x] Validaciones espejo en formulario (etapa 5)
- [x] Mapeo de `Fault` a mensajes legibles
- [x] Endpoint de salud + alertas
- [x] **Extra de este producto:** `ClientPicker` no llama a Odoo; `projects.client_id` vinculado a `clients.odoo_id`; typeahead con >10k contactos
