# Integración con el módulo Contactos de Odoo 17 (`res.partner`)

Análisis técnico para consumir, cachear y escribir contactos desde una aplicación externa,
con sincronización periódica y flujo bidireccional.

---

## 1. Objetivo y decisiones de arquitectura

| Requisito | Decisión |
|---|---|
| Consumir contactos con todos sus campos | XML-RPC contra `res.partner`, con whitelist explícita de campos |
| Guardarlos en el sistema propio | Caché local en MongoDB, fuente de lectura para toda la app |
| Detectar altas/cambios cada 15 min | Pull incremental por watermark sobre `write_date` |
| Botón "Actualizar contactos" | Dispara el **mismo** job incremental, con lock y debounce |
| Alta y edición desde la app | Patrón outbox + clave de idempotencia externa |
| No complicar Odoo | Un único módulo custom mínimo (1 campo + 1 índice); cero overrides de core |

**Regla dura:** la aplicación nunca llama a Odoo en tiempo de request. Si Odoo está caído,
en actualización o apagado, la app sigue funcionando con datos de hasta 15 minutos de antigüedad.

---

## 2. Qué API expone Odoo 17

Odoo **no tiene REST nativo**. Las vías disponibles:

| Vía | Endpoint | Cuándo usarla |
|---|---|---|
| **XML-RPC** | `/xmlrpc/2/common`, `/xmlrpc/2/object` | La más estable y documentada. **Recomendada.** |
| JSON-RPC | `/jsonrpc` | Mismo motor, payload JSON. Útil desde Node/browser. |
| Web session | `/web/session/authenticate` + `/web/dataset/call_kw` | API interna del cliente web. **Evitar**: cambia entre versiones. |
| REST propio | OCA `base_rest` o controller custom | Solo si necesitas que Odoo *empuje* datos. Añade superficie de mantenimiento. |

Para leer, crear y editar `res.partner`, `execute_kw` sobre XML-RPC cubre el 100% del caso.

### Autenticación

- Crear un usuario dedicado, p. ej. `integracion.ztrack`.
- Generar un **API Key** en *Preferencias → Seguridad de la cuenta → Nuevas claves API*.
- La key se usa **en lugar del password** en `execute_kw`.
- Nunca usar el password real ni la cuenta de una persona: si esa persona cambia su clave
  o deja la empresa, la integración se cae en silencio.

**Permisos mínimos:** usuario interno + grupo *Contactos / Responsable*.

> Nota de licenciamiento: en Odoo **Enterprise** un usuario interno consume licencia.
> En **Community** no tiene costo.

---

## 3. El modelo `res.partner` y la trampa de "todos los campos"

En una instalación con contabilidad, ventas y localización peruana, `res.partner` supera
fácilmente los **150 campos**, incluyendo binarios (`image_1920` es base64 de varios MB por contacto).

Inventario, una sola vez:

```python
campos = models.execute_kw(
    DB, uid, API_KEY, 'res.partner', 'fields_get',
    [], {'attributes': ['string', 'type', 'required', 'relation', 'store']}
)
```

### Whitelist sugerida (congelarla en código)

```
id, name, display_name, complete_name, ref, active, company_type, is_company,
parent_id, type, function, title, vat, l10n_latam_identification_type_id,
street, street2, city, state_id, country_id, zip,
phone, mobile, email, website, comment, lang, tz,
category_id, user_id, customer_rank, supplier_rank,
create_date, write_date
```

### Específico de Perú

Si está instalado `l10n_pe`:

- `l10n_latam_identification_type_id` → DNI / RUC / CE / Pasaporte.
- Posiblemente `l10n_pe_district` (distrito).
- Si hay facturación electrónica, **`vat` tiene validación activa**: un RUC mal formado
  hace fallar el push con `ValidationError`.

### Formato de respuesta (rompe mapeos si no se prevé)

| Situación | Qué devuelve Odoo |
|---|---|
| Campo vacío | `False` — no `null`, no `""` |
| Many2one | `[id, "Nombre"]` o `False` |
| Many2many / One2many | `[id1, id2, ...]` |
| Selection | La clave técnica (`"contact"`, no `"Contacto"`) |
| Datetime | String naive `"2026-08-18 14:03:22"` **en UTC** |

Un `if not valor` confunde `0`, `False` y vacío. Comparar explícitamente contra `False`.

---

## 4. Esquema de conexión

```
                 ┌──────────────────────────────┐
                 │   Odoo 17 · res.partner      │
                 │   XML-RPC con API key        │
                 └───────┬──────────────▲───────┘
                         │              │
              baja cambios              sube cambios
                         │              │
        ┌────────────────▼──┐        ┌──┴─────────────────┐
        │ Worker de bajada  │        │ Worker de subida   │
        │ cada 15 min, por  │        │ cola outbox con    │
        │ write_date        │        │ reintentos         │
        └────────┬──────────┘        └──▲─────────────────┘
                 │                      │
                 ▼                      │
        ┌───────────────────────────────┴──────┐
        │      Caché local en MongoDB          │
        │  contactos · outbox · estado de sync │
        └───────┬────────────────────▲─────────┘
                │                    │
                ▼                    │
        ┌────────────────────────────┴─────────┐
        │   FastAPI · app React / móvil        │
        │   siempre lee del caché              │
        └──────────────────────────────────────┘
```

---

## 5. Bajada incremental (pull)

### Consulta base

```python
import xmlrpc.client

common = xmlrpc.client.ServerProxy(f'{URL}/xmlrpc/2/common')
uid = common.authenticate(DB, USER, API_KEY, {})
models = xmlrpc.client.ServerProxy(f'{URL}/xmlrpc/2/object')

dominio = [('write_date', '>=', watermark)]

lote = models.execute_kw(
    DB, uid, API_KEY, 'res.partner', 'search_read',
    [dominio],
    {
        'fields': CAMPOS,
        'limit': 300,
        'offset': off,
        'order': 'write_date asc, id asc',
        'context': {
            'active_test': False,   # incluye contactos archivados
            'bin_size': True,       # binarios como tamaño, no base64
            'lang': 'es_PE',
        },
    }
)
```

### Puntos críticos

- **`search_read`, no `search` + `read`.** Ahorra la mitad de las llamadas RPC.
- **`active_test: False`** o no verás los archivados. Si un contacto se archiva en Odoo y
  no te enteras, sigue apareciendo activo en la app.
- **`bin_size: True`** hace que los binarios devuelvan el tamaño en texto en vez del base64
  completo. Salvavidas si algún día incluyes `image_1920`.
- **Orden `write_date asc, id asc`** para que la paginación sea estable entre páginas.
- Un registro **recién creado tiene `write_date == create_date`**, así que un solo watermark
  sobre `write_date` trae altas **y** modificaciones. Para distinguir "nuevo" de "editado",
  comprobar si el `odoo_id` ya existe localmente.

### El bug sutil del watermark

Guardar `watermark = ahora()` local **pierde registros**: el reloj de tu servidor difiere del
de Odoo, y una transacción puede escribir `write_date = T` pero hacer commit *después* de tu
consulta.

Solución en tres partes:

1. El nuevo watermark sale de `max(write_date)` **del lote devuelto**, no de tu reloj.
2. Consultar con **solape** de ~2 minutos: `write_date >= watermark - 120s`, usando `>=`.
3. El upsert local debe ser **idempotente** por `odoo_id`, así el solape solo reescribe lo
   mismo y no duplica.

### Los borrados no se ven

Si alguien hace *Eliminar* en Odoo, el registro deja de aparecer y tu caché lo conserva para
siempre. Reconciliación completa **una vez al día, de madrugada**:

```python
ids_odoo = set(models.execute_kw(
    DB, uid, API_KEY, 'res.partner', 'search',
    [[]], {'context': {'active_test': False}}
))
```

Comparar con los `odoo_id` locales y marcar los faltantes como `borrado_en_odoo`.
**No borrar físicamente** si otros documentos propios los referencian: marcar y bloquear
su selección en los formularios.

### Concurrencia: lock y debounce

El botón "Actualizar contactos" dispara el mismo job incremental (nunca un full refetch).
El usuario hará clic tres veces seguidas mientras el cron de 15 minutos también corre.

```python
lock = await db.locks.find_one_and_update(
    {'_id': 'sync_partners', 'expira': {'$lt': ahora}},
    {'$set': {'expira': ahora + timedelta(minutes=5)}},
    upsert=True,
)
```

Además: si la última sync fue hace menos de 60 s, devolver el resultado anterior sin golpear Odoo.

---

## 6. Subida (push) y el problema del eco

Aquí está el ~80% de los dolores de cabeza de una sincronización bidireccional.

### Eco

1. La app escribe en Odoo.
2. Odoo actualiza `write_date`.
3. El siguiente pull se trae ese cambio como si fuera externo.
4. Se aplica sobre el registro propio → posible bucle.

Odoo actualiza `write_date` **aunque escribas exactamente los mismos valores**, así que
comparar contenido no basta.

**Solución:** tras cada `write`/`create` exitoso, leer inmediatamente el `write_date`
resultante y guardarlo en `last_pushed_wd`. En el pull, si el `write_date` entrante es igual
o anterior a ese valor, es eco propio → ignorar.

### Idempotencia en las altas

Si el request a Odoo hace timeout, no sabes si el contacto se creó. Reintentar a ciegas
duplica contactos, y limpiar duplicados de `res.partner` en producción es horrible: quedan
referenciados en facturas, pedidos y albaranes.

Se necesita una clave externa. Módulo mínimo en Odoo (no toca nada del core):

```python
from odoo import models, fields, tools


class ResPartner(models.Model):
    _inherit = 'res.partner'

    x_ztrack_uid = fields.Char('UID Ztrack', index=True, copy=False)

    _sql_constraints = [
        ('x_ztrack_uid_uniq', 'unique(x_ztrack_uid)', 'UID externo duplicado'),
    ]

    def init(self):
        tools.create_index(
            self._cr, 'res_partner_write_date_idx', self._table, ['write_date']
        )
```

Este módulo hace dos cosas:

1. Da la clave de idempotencia.
2. Crea el índice sobre `write_date`, que **Odoo no indexa por defecto**. Sin él, cada pull
   hace un seq scan de la tabla. Con pocos miles de contactos da igual; con decenas de miles
   se nota.

**Flujo de creación:** generar UUID local → `search` por `x_ztrack_uid` → si no existe, `create`;
si existe, ya se creó en el intento anterior y solo se recupera el id.

### Patrón outbox

No llamar a Odoo dentro del request HTTP del usuario. Se guarda la operación en una colección
`outbox` y se responde de inmediato ("guardado, sincronizando"). Un worker la procesa con
backoff exponencial.

Ventajas: si Odoo está caído el usuario no se bloquea, y hay trazabilidad de cada intento.

### Conflictos

Definir política explícita, no dejarla implícita:

- **Odoo manda** (recomendado por simplicidad): la app *propone* cambios. Si al escribir el
  `write_date` en Odoo no coincide con el que se tenía, se marca conflicto y se muestran ambos
  valores al usuario.
- **Nunca** hacer merge automático campo por campo sin avisar: se acaba con direcciones
  Frankenstein.

---

## 7. Validaciones que Odoo va a rechazar

Replicarlas en el formulario, o el usuario llenará todo y el error saldrá 30 segundos después
desde el worker.

| Campo / regla | Detalle |
|---|---|
| `name` | Obligatorio, salvo contactos hijos con `parent_id` y `type` fijado |
| `state_id` | Debe pertenecer al `country_id`. Odoo no siempre lo valida, pero un estado que no corresponde deja el dato inservible para facturación |
| `vat` | Con `base_vat` o `l10n_pe` activos, un RUC inválido lanza `ValidationError` |
| `parent_id` | No puede formar ciclos → error de recursión |
| `type` | Selection: `contact`, `invoice`, `delivery`, `private`, `other` |
| `company_type` | (`person`/`company`) coherente con `is_company`. Escribir uno u otro, no ambos |
| `category_id` | Usa comandos de Odoo: `[(6, 0, [ids])]` reemplaza, `[(4, id)]` añade. Una lista plana falla |

### Manejo de errores

En XML-RPC los errores llegan como `xmlrpc.client.Fault` con el traceback de Odoo en
`faultString`. Mapear al menos:

- `ValidationError` → error de datos, mostrar al usuario.
- `AccessError` → problema de permisos del usuario de integración.
- `MissingError` → el registro fue borrado en Odoo.
- `UserError` → regla de negocio.

Nunca mostrar el traceback crudo al usuario final.

---

## 8. Estructura local sugerida (MongoDB)

```
contactos_odoo
  odoo_id            int      · índice único
  x_ztrack_uid       string   · índice único sparse
  raw                dict     · respuesta cruda de Odoo
  name, vat, email, phone ... · campos normalizados para búsqueda
  odoo_write_date    datetime UTC · índice
  last_pushed_wd     datetime UTC
  estado             sincronizado | pendiente | conflicto | borrado_en_odoo
  actualizado_en     datetime

sync_estado
  _id                'res.partner'
  watermark          datetime UTC
  ultima_corrida     datetime
  duracion, creados, actualizados, errores

outbox
  uid                UUID generado localmente
  op                 create | write
  odoo_id            int | null
  payload            dict
  intentos           int
  proximo_intento    datetime
  estado             pendiente | enviado | fallido | conflicto
  ultimo_error       string
```

Guardar `raw` evita resincronizar cuando en seis meses se necesite un campo que hoy no se normalizó.

---

## 9. Cómo NO complicar Odoo

- **No sobreescribir métodos de `res.partner`.** Nada de heredar `create` o `write` para
  disparar HTTP. Una llamada de red dentro de la transacción de Odoo significa que si tu API
  tarda, el usuario de Odoo se queda esperando; y si falla, puede tumbar el guardado.
- **No usar acciones automatizadas con "Ejecutar código Python" que hagan `requests.post`.**
  Mismo problema, más difícil de depurar. Si algún día se quiere notificación inmediata en vez
  de polling, la vía sana es `queue_job` de OCA (encola y envía fuera de la transacción).
  El polling de 15 minutos es suficiente y no toca Odoo en absoluto.
- **Un solo módulo custom**, que solo añada un campo y un índice. Todo lo demás vive del lado
  de la aplicación.
- **Limitar la concurrencia RPC.** Cada llamada ocupa un worker de Odoo (`--workers=N`).
  Lanzar 20 peticiones paralelas contra un servidor con 4 workers deja a los usuarios de Odoo
  sin atención. Con 1–2 conexiones secuenciales y lotes de 300 registros sobra.
- **Programar la reconciliación completa fuera de horario laboral.**
- **Timeouts explícitos** y **circuit breaker**: tras N fallos seguidos, dejar de intentar
  10 minutos. Sin esto, si Odoo se cae el worker lo bombardea con reintentos justo cuando
  está levantando.
- **HTTPS y red cerrada.** Si Odoo está expuesto a internet, restringir por IP en el reverse
  proxy hacia `/xmlrpc/*`. La API key da acceso completo a todo lo que ese usuario puede ver.

---

## 10. Monitoreo en producción

Endpoint de salud que devuelva:

- `ultima_corrida` y antigüedad del watermark
- Tamaño de la cola `outbox`
- Conteo de registros en estado `conflicto`
- Duración y errores de la última corrida

**Alertas:**

- Última sync exitosa con más de 45 minutos de antigüedad.
- Items en outbox con más de 5 intentos.
- Cualquier `AccessError` (indica que la API key o los permisos cambiaron).

Sin esto, las sincronizaciones se rompen en silencio y uno se entera cuando alguien pregunta
por qué no aparece un cliente creado ayer.

---

## 11. Checklist de implementación

- [ ] Crear usuario de integración en Odoo + API key
- [ ] Ejecutar `fields_get` y congelar la whitelist de campos
- [ ] Instalar módulo mínimo (`x_ztrack_uid` + índice en `write_date`)
- [ ] Cliente RPC con timeouts, reintentos y circuit breaker
- [ ] Colecciones `contactos_odoo`, `sync_estado`, `outbox` con sus índices
- [ ] Worker de bajada: watermark + solape 2 min + paginación + upsert idempotente
- [ ] Lock distribuido y debounce para el botón manual
- [ ] Worker de subida: outbox, idempotencia por UUID, detección de eco
- [ ] Job diario de reconciliación de borrados
- [ ] Validaciones espejo en el formulario de la app
- [ ] Mapeo de errores de Odoo a mensajes legibles
- [ ] Endpoint de salud + alertas