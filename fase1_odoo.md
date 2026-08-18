# Fase 1 — Módulo mínimo en Odoo (`zgroup_partner_ext`)

Documento operativo de la **etapa 1** del plan `implementacion_contactos_odoo.md`.

**Estado actual**

- Etapa 0: **cumplida** (probe XML-RPC verde contra `zgroup.odoo.com`, Odoo 17 Enterprise).
- Etapa 1: **código listo en este repo**; **no instalado** en Odoo porque aún no hay acceso al proyecto **Odoo.sh** (Git / builds / Apps).
- Cotizaciones **no puede** instalar este módulo por API. Hace falta quien administre el repositorio Git de Odoo.sh.

> «Odoo SSH» en la práctica es **Odoo.sh**: el Git + panel de branches (dev / staging / production), no una sesión Linux al servidor. El XML-RPC que ya funciona **no sustituye** ese acceso.

---

## 1. Por qué esta prueba importa

La etapa 0 demostró: *podemos leer Contactos*. La etapa 1 prepara a Odoo para que esa lectura (y más adelante la escritura) sea **segura y barata** con +10 000 `res.partner`.

Sin el módulo, dos problemas aparecen más adelante:

### 1.1 Pull incremental lento (etapa 3)

Cada 15 minutos Cotizaciones preguntará:

```text
contactos con write_date >= última sync
```

Odoo **no indexa `write_date` por defecto**. Con pocos cientos de fichas da igual; con decenas de miles cada corrida hace un *seq scan* de `res_partner`, satura workers y puede poner lenta la UI de Contactos en horario laboral.

El módulo crea el índice `res_partner_write_date_idx`. Eso es la prueba de rendimiento de la fase 1: el lote `search_read` ordenado por `write_date` debe seguir en cientos de ms, no en varios segundos.

### 1.2 Altas duplicadas hacia Odoo (etapa 5)

Cuando un comercial cree un cliente en Cotizaciones y se suba a Odoo, el `create` XML-RPC puede hacer **timeout**. No se sabe si el contacto se creó. Reintentar a ciegas **duplica** `res.partner`. Limpiar duplicados en producción es caro: quedan colgados de facturas, pedidos y albaranes.

La clave `x_ztrack_uid` (UUID único generado en Cotizaciones) permite:

1. `search` por ese UUID.
2. Si ya existe → se recupera el `id` (el intento anterior sí llegó).
3. Si no existe → `create`.

Sin ese campo **no hay escritura segura**. La etapa 5 queda bloqueada.

### 1.3 Qué no hace el módulo (igual de importante)

| Prohibido | Por qué |
|---|---|
| Heredar `create` / `write` de `res.partner` | Una llamada HTTP dentro de la transacción de Odoo deja al usuario de Contactos esperando; si falla, puede tumbar el guardado. |
| Acciones automatizadas con `requests.post` a Cotizaciones | Mismo problema, peor de depurar. |
| REST custom, Studio «por si acaso», 20 campos extra | Superficie de mantenimiento. Un campo + un índice. |

La regla del análisis (`implicancias_odoo_17.md`): **todo lo demás vive en Cotizaciones**. Odoo solo aporta el campo de idempotencia y el índice.

---

## 2. Qué es exactamente el módulo

Carpeta en este repo (ya escrita, no se toca el core de Odoo):

```
odoo_addons/zgroup_partner_ext/
  __init__.py
  __manifest__.py          # 17.0, depende solo de `base`
  models/
    __init__.py
    res_partner.py         # inherit mínimo
```

| Pieza | Detalle |
|---|---|
| `x_ztrack_uid` | `Char`, `index=True`, `copy=False`, SQL `UNIQUE`. Vacío/NULL en todos los contactos actuales (correcto). |
| `res_partner_write_date_idx` | Índice btree sobre `write_date`, creado en `init()` con `IF NOT EXISTS`. |
| Nombre técnico | `zgroup_partner_ext` |
| Nombre en Apps | **ZGROUP Partner Ext** |

`copy=False`: duplicar un contacto en Odoo **no** copia el UUID (evitaría el UNIQUE a propósito).

---

## 3. Por qué no se puede “hacer la prueba” solo desde Cotizaciones

El probe (`npm run odoo:probe`) usa XML-RPC con API key. Eso alcanza para **leer** `res.partner`.

Instalar un addon exige:

1. Que el código esté en el **addons path** del build de Odoo.sh.
2. Un usuario con Apps (o el deploy del branch) que ejecute **Instalar**.

Sin Git de Odoo.sh no hay addons path. Crear el campo a mano en Studio **no es equivalente**: no crea el UNIQUE ni el índice `write_date` de forma controlada, y se pierde el manifiesto versionado.

Por eso la fase 1 queda **pendiente de accesos**, no de código.

---

## 4. Qué se hará mientras se consiguen los accesos

No nos quedamos parados. El módulo **no bloquea** el trabajo en Cotizaciones de las etapas 2–4 (lectura). Bloquea solo la **escritura** (etapa 5) y el **rendimiento fino** del pull (índice).

### 4.1 Se puede hacer ya (sin Odoo.sh)

| Trabajo | Etapa | Notas |
|---|---|---|
| Tablas `odoo_partners`, `odoo_sync_state`, lock; columnas en `clients` | **2** | 100 % PostgreSQL de Cotizaciones. Incluye columna `x_ztrack_uid` local aunque Odoo aún no tenga el campo. |
| Cliente RPC + worker de **bajada** (watermark, lotes 300, upsert) | **3** | El pull **funciona sin el índice**; en +10k será más lento hasta instalar el módulo. Primera sync full se programa fuera de horario si hace falta. |
| Health SUPERUSER + botón «Actualizar contactos» (mismo job, lock) | **3** | No instala nada en Odoo. |
| `ClientPicker` typeahead contra la **caché local** | **4** | Objetivo de negocio: vincular cliente al crear proyecto. Sigue la regla dura: el POST del proyecto **no** llama a Odoo. |

Etiquetas ya inventariadas en etapa 0 (no hardcodear en otro sitio sin documentar):

- Cliente **id=3**
- Proveedor **id=4**
- Contacto **id=5**

### 4.2 No se hace hasta tener el módulo instalado en staging

| Trabajo | Por qué esperar |
|---|---|
| Etapa 5 — outbox `create`/`write` hacia Odoo | Sin `x_ztrack_uid` un timeout duplica contactos. |
| Declarar etapa 1 **cerrada** | El criterio de salida es módulo instalado + probe `--stage1` verde. |
| Instalar en **production** de Odoo.sh | Primero staging. |
| Pedir índice a un DBA a mano en prod | El `init()` del módulo es el camino reproducible. |

### 4.3 Riesgo aceptado a corto plazo

Si se activa el pull (etapa 3) **antes** del índice:

- Funciona, pero cada corrida puede cargar más al cluster Odoo.sh.
- Mitigación: lotes de 300, **una** conexión RPC, no paralelizar, primera carga de madrugada, `ODOO_SYNC_ENABLED=0` hasta que se decida el momento.

El campo `x_ztrack_uid` vacío en Odoo **no rompe** el pull ni el picker.

---

## 5. Checklist cuando lleguen los accesos Odoo.sh

Entregar a quien tenga el Git / panel:

1. Copiar `odoo_addons/zgroup_partner_ext` **tal cual** al repo de Odoo.sh (carpeta de addons custom).
2. Push a branch **dev/staging**, no a `production` en el primer intento.
3. Esperar el build verde.
4. Apps → quitar filtro «Aplicaciones» → Actualizar lista → **ZGROUP Partner Ext** → Instalar.
5. Técnico → Modelo `res.partner` → existe `x_ztrack_uid`.
6. Revisar que no haya acciones automatizadas de Contactos con `requests.post` hacia Cotizaciones.
7. Desde este repo:

```bash
npm run odoo:probe:stage1
```

**OK si aparece**

- `ir.module.module` … `state=installed`
- `campo x_ztrack_uid` tipo `char`
- `search x_ztrack_uid UUID inventado: 0 filas`
- `search_read write_date lote 300` en tiempo razonable (aviso si > 3 s)

**No OK:** instalar primero en production; heredar `create`/`write`; añadir webhooks.

Tras staging OK: merge al branch de producción de Odoo.sh y repetir el probe (la API key de `.env` apunta hoy a producción: conviene una URL/BD de staging cuando exista).

---

## 6. Cómo se ve el bloqueo hoy

```bash
npm run odoo:probe
```

La etapa 0 sigue verde. Al final debe avisar:

```text
-- etapa 1 (módulo zgroup_partner_ext) --
  ! módulo no está en addons path
  ! campo x_ztrack_uid ausente
```

Eso es **esperado** hasta instalar el addon. No indica que se haya roto la etapa 0.

```bash
npm run odoo:probe:stage1
```

Ese comando **falla a propósito** si falta el campo: es la prueba de cierre de la fase 1.

---

## 7. Resumen para el equipo

| Pregunta | Respuesta |
|---|---|
| ¿Se puede integrar el picker de clientes sin esta fase? | Sí, con caché local (etapas 2–4). La app no escribe en Odoo. |
| ¿Se puede dar por cerrada la integración de Contactos? | No. Falta el módulo para pull eficiente y para altas sin duplicar. |
| ¿El código de Cotizaciones está bloqueado? | No. Siguiente trabajo útil: **etapa 2** (PostgreSQL). |
| ¿Qué hay que pedir a TI / partner Odoo? | Acceso Git Odoo.sh (o que ellos copien `zgroup_partner_ext` a un branch staging e instalen). |
| ¿Hay que darles la API key de Cotizaciones? | No. El módulo no llama a Cotizaciones. Solo el código de esta carpeta. |

**Siguiente paso en este repo (sin esperar Odoo.sh):** etapa 3 (worker de pull) — **hecha**. Primera carga: SUPERUSER → «Actualizar contactos» o `npm run odoo:sync` (Docker: el `.env` de compose debe tener las vars `ODOO_*`). Picker de proyectos = etapa 4. Cron 15 min solo con `ODOO_SYNC_ENABLED=1`.
