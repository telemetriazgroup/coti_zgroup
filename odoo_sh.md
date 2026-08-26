# Entorno de prueba Odoo.sh en la máquina local

Plan para clonar el Git de **Odoo.sh**, levantar un Odoo 17 de prueba en local y (opcional) restaurar datos, sin tocar producción.

**Repos involucrados (no son el mismo)**

| Repo | Qué es | Para qué |
|---|---|---|
| `github.com/aldomengoni/zgroup` | Addons custom del ERP (Odoo.sh) | Contabilidad PE, EDI, módulos ZGROUP |
| Este repo (`coti_zgroup`) | App Cotizaciones (Node + Postgres) | Consume Contactos por XML-RPC |

El módulo que Cotizaciones necesita instalar en Odoo vive **aquí**: `odoo_addons/zgroup_partner_ext/`. Aún no está en el Git de Odoo.sh (fase 1 pendiente).

Estado visto en el panel (ago 2026):

- **Production** `production` — Odoo **17.0**, verde.
- **Staging** `test-upgrade` — Odoo 17.0, builds con **Test: Failed**.
- Git: `test-upgrade` va **~423 commits ahead** y **16 behind** de `main`.
- Clone que ofrece Odoo.sh:

```bash
git clone --recurse-submodules --branch test-upgrade git@github.com:aldomengoni/zgroup.git
```

---

## 1. Respuesta corta: ¿local o interfaz Odoo.sh?

**Las dos cosas, con roles distintos. No elijas solo una.**

| Dónde | Sirve para | No sirve para |
|---|---|---|
| **Local (Git + Docker)** | Editar addons, instalar `zgroup_partner_ext`, romper/arreglar sin miedo, depurar Python | Reemplazar staging/prod, mail real, workers Odoo.sh, builds oficiales, licencias SaaS |
| **Odoo.sh staging** | Validar el mismo stack que producción (Enterprise 17, addons, datos copia) | Iterar a ciegas en cada typo (el build tarda y hoy `test-upgrade` ya falla tests) |
| **Odoo.sh production** | Operación real | **Probar.** Nunca el primer push de un módulo nuevo |

Flujo recomendado:

```
1. Local: código + (opcional) dump de STAGING
2. Push a un branch de Development o Staging en Odoo.sh
3. Build verde + Apps → Instalar módulo
4. Probe desde Cotizaciones contra ESA URL (no production)
5. Recién entonces merge a production
```

Clonar el Git **sí** es el primer paso. Clonar **no** te deja un Odoo corriendo: el repo no incluye el core de Odoo ni la base de datos.

---

## 2. Implicancias (léelo antes de clonar)

### 2.1 El Git no es el ERP

`aldomengoni/zgroup` es un **árbol de addons** (`l10n_pe_*`, `account_*`, `dv_l10n_pe_*`, etc.). Odoo.sh, detrás, monta:

- Odoo **17 Enterprise** (no Community)
- PostgreSQL gestionado
- filestore (adjuntos, PDF, XML SUNAT)
- workers, cron, correo

En local tienes que armar esas piezas. Si levantas **Community** 17, muchos módulos del repo **no van a instalar** (contabilidad Enterprise, localización PE de pago, EDI).

### 2.2 Licencia Enterprise

Odoo.sh ya licencia el proyecto. Para un Odoo 17 Enterprise **local** hace falta el código `enterprise` (acceso de partner / suscripción). Sin eso:

- Opción A: local **solo para el módulo mínimo** `zgroup_partner_ext` (depende de `base`) sobre Community. Sirve para probar campo + índice, no para facturación PE.
- Opción B: dump + addons sobre una imagen/build Enterprise (réplica más fiel).

Para la fase 1 de Cotizaciones, **A alcanza**. Para probar EDI / retenciones / tipos de cambio, hace falta **B** o staging en Odoo.sh.

### 2.3 Datos = datos reales

Un backup de Odoo trae clientes, RUC, facturas, usuarios, API keys internas. En un portátil:

- Disco cifrado, no subir el dump a chats ni a este repo.
- No apuntar Cotizaciones de **producción** a un Odoo local (ni al revés).
- Usuarios/contraseñas del dump siguen valiendo: cámbialas en local o no expongas el puerto 8069 a internet.

### 2.4 El branch `test-upgrade` está sucio

- Tests **Failed** en Odoo.sh.
- Muchos commits «Add files via upload».
- 16 commits detrás de `main`.

Úsalo para **mirar** qué hay. Para trabajo nuevo, mejor un branch desde `production` o `main` (17.0), p. ej. `17.0-zgroup-partner-ext`, no seguir ensuciando `test-upgrade`.

Hay ramas **15.0** en Development: no las mezcles con 17. Un dump 17 no arranca en 15 y viceversa.

### 2.5 Cotizaciones hoy apunta a production

En `.env` de este proyecto la URL/BD Odoo es la de **producción** (`zgroup.odoo.com`). Eso está bien para **lectura** (probe / pull) con `ODOO_SYNC_ENABLED=0`.

**No** uses esa misma clave para pruebas de escritura (`create`/`write` de contactos) contra production. Cuando haya staging o local, crea **otro** usuario + API key y otro bloque `ODOO_*` (o un `.env.odoo.staging`).

### 2.6 Submódulos

El clone de Odoo.sh lleva `--recurse-submodules`. Si clonas sin eso, faltan addons y el log dirá `Module not found`.

### 2.7 Lo que Odoo.sh hace y local no replica igual

Cron, cola de jobs, captura de mail, HTTPS, workers, tests del build, backups automáticos. Un módulo que “funciona en Docker” puede fallar el test de Odoo.sh (como ya pasa en `test-upgrade`). El criterio de “listo” es **build staging verde**, no solo “me abre en localhost:8069”.

---

## 3. Plan de entorno local (paso a paso)

### Fase 0 — Accesos (ya casi listos)

- [x] Panel Odoo.sh del proyecto `zgroup`
- [ ] SSH a GitHub (`aldomengoni/zgroup`): clave en GitHub y prueba `ssh -T git@github.com`
- [ ] Permiso de **push** a un branch de Development (no hace falta push a `production`)
- [ ] Pestaña **Backups** en Odoo.sh: poder bajar dump de **staging** (preferible) o una copia, no el hábito de bajar production cada día

### Fase 1 — Clonar el Git (solo código)

Directorio **fuera** de `coti_zgroup` (son proyectos distintos):

```bash
mkdir -p ~/Proyectos/odoo
cd ~/Proyectos/odoo
git clone --recurse-submodules --branch test-upgrade git@github.com:aldomengoni/zgroup.git
cd zgroup
git remote -v
git log -5 --oneline
```

Si SSH falla, en GitHub: Settings → SSH keys. El clone HTTPS también vale si el repo te deja.

Inventario rápido:

```bash
ls -1
```

Anota carpetas con `__manifest__.py` (cada una es un addon). Las que empiezan por `l10n_pe` / `dv_l10n_pe` / `account_` son el grueso del ERP; **no** hay que tocarlas para Cotizaciones.

### Fase 2 — Copiar el módulo de Cotizaciones al árbol Odoo (local)

Sin push todavía:

```bash
cp -a /home/telemetriazgroup/Proyectos/coti_zgroup/odoo_addons/zgroup_partner_ext \
      ~/Proyectos/odoo/zgroup/zgroup_partner_ext
```

Comprobar que existe `__manifest__.py` con `'version': '17.0.1.0.0'` y `'depends': ['base']`.

Ese es el único addon que Cotizaciones necesita instalar para la fase 1.

### Fase 3 — Levantar Odoo 17 en Docker (mínimo viable)

Objetivo de esta fase: **probar `zgroup_partner_ext`**, no clonar todo el ERP.

Necesitas:

- Docker + Docker Compose
- Imagen **Odoo 17** (Community basta para este módulo)
- Postgres 15 (Odoo.sh usa 15; 16 suele ir, 14 no es ideal)

Esquema:

```
localhost:8069  →  contenedor odoo:17
                     addons-path = /mnt/extra-addons  (tu clone)
localhost:5432  →  postgres 15, database `zgroup`
```

`docker-compose` ilustrativo (ajustarlo, no copiar a ciegas a production):

```yaml
services:
  db:
    image: postgres:15
    environment:
      POSTGRES_USER: odoo
      POSTGRES_PASSWORD: odoo
      POSTGRES_DB: postgres
    volumes:
      - odoo-db:/var/lib/postgresql/data

  odoo:
    image: odoo:17.0
    depends_on: [db]
    ports:
      - "8069:8069"
    environment:
      HOST: db
      USER: odoo
      PASSWORD: odoo
    volumes:
      - odoo-web:/var/lib/odoo
      - ./zgroup:/mnt/extra-addons
    command: >
      odoo
      --addons-path=/usr/lib/python3/dist-packages/odoo/addons,/mnt/extra-addons
      --db_host=db --db_user=odoo --db_password=odoo
```

Arranque:

1. Crear base nueva `zgroup_dev` desde `http://localhost:8069` (master password del contenedor).
2. Apps → quitar filtro «Aplicaciones» → **Actualizar lista de aplicaciones**.
3. Buscar **ZGROUP Partner Ext** → Instalar.
4. Ajustes → Técnico → Modelos → `res.partner` → campo `x_ztrack_uid`.

Si el módulo no aparece: el volume no montó, o el `addons-path` no incluye `/mnt/extra-addons`.

**No instales** en este Docker vacío toda la pila `l10n_pe_*` salvo que tengas Enterprise + dependencias. Van a pedir módulos de pago y datos de compañía PE.

### Fase 4 — (Opcional) Réplica con datos: dump de Odoo.sh

Solo cuando haga falta ver contactos reales o un bug que no sale en base vacía.

En Odoo.sh → branch **staging** (ideal) o un backup de production **tratado como copia muerta**:

1. Pestaña **Backups** → descargar dump (`.sql` / `.dump`) + **filestore** si hay adjuntos.
2. No commitear esos archivos.
3. Restaurar en el Postgres local (`pg_restore` / `psql`), misma **versión mayor de Odoo (17)**.
4. Copiar filestore a `/var/lib/odoo/filestore/<nombre_bd>`.
5. Arrancar Odoo apuntando a esa BD (`-d nombre`).
6. Actualizar lista de Apps e instalar `zgroup_partner_ext` (upgrade `-u zgroup_partner_ext` si ya estaba el módulo en el dump, que no).

Implicancias del dump:

| Tema | Qué tener en cuenta |
|---|---|
| Tamaño | Production con años de facturación + XML EDI puede ser decenas de GB (BD + filestore) |
| Versión | Dump 17 → Odoo 17. Un restore en 18 o 15 rompe |
| Filestore | Sin él, facturas/adjuntos salen rotos; Contactos suele funcionar igual |
| Cron | En local **desactiva crons** (correo, EDI SUNAT, conciliación). Si no, el portátil “emite” o manda mails |
| Usuarios | Las claves del dump funcionan. No publiques 8069 |
| Producción | El dump local **no se sube** otra vez a Odoo.sh. Es unidireccional: nube → laptop |

Desactivar crons en local (después de restaurar):

```sql
UPDATE ir_cron SET active = false;
```

(O arrancar Odoo con `--max-cron-threads=0`.)

**No** restaurar production y dejar crons de facturación electrónica activos: puedes reenviar XML a SUNAT o spamear clientes.

### Fase 5 — Apuntar Cotizaciones al Odoo de prueba

En este repo, **otro** archivo de entorno (no pisar production):

```bash
# .env.odoo.local  (ejemplo, no commitear secretos)
ODOO_URL=http://localhost:8069
ODOO_DB=zgroup_dev
ODOO_USER=admin
ODOO_API_KEY=   # Preferencias → Seguridad → Nueva clave API en el Odoo LOCAL
ODOO_SYNC_ENABLED=0
ODOO_TIMEOUT_MS=20000
```

Usuario dedicado también en local (no uses tu usuario de todos los días). Probe:

```bash
# cargar esas vars y:
npm run odoo:probe
npm run odoo:probe:stage1
```

Criterio de fase 1 (ya documentado en `fase1_odoo.md`):

- `zgroup_partner_ext` → `state=installed`
- existe campo `x_ztrack_uid`
- `search` de un UUID inventado → 0 filas
- `search_read` por `write_date` lote 300 en tiempo razonable

Cuando el mismo módulo esté en **staging Odoo.sh**, repetir el probe contra la URL de staging (la da el botón **Connect** del branch), con **otra** API key.

### Fase 6 — Subir el módulo a Odoo.sh (cuando local esté OK)

1. En el clone `~/Proyectos/odoo/zgroup`:

```bash
git checkout production   # o main 17.0, el que esté alineado a prod
git pull
git checkout -b 17.0-zgroup-partner-ext
# copiar zgroup_partner_ext al root de addons
git add zgroup_partner_ext
git commit -m "Add zgroup_partner_ext (UID Cotizaciones + index write_date)"
git push -u origin 17.0-zgroup-partner-ext
```

2. En Odoo.sh el push a una rama nueva suele crear un entorno **Development**.
3. Esperar **build verde**. Si falla, no mezclar con `test-upgrade`.
4. **Connect** → Apps → Actualizar lista → instalar **ZGROUP Partner Ext**.
5. Probe `stage1` desde Cotizaciones contra esa URL.
6. Promover a **Staging**, re-probar con dump reciente.
7. Production al final.

Odoo.sh **no instala** el módulo solo porque esté en Git: hay que instalarlo una vez en Apps (o un script de post-deploy; no lo asumas).

---

## 4. Qué pruebas hacer en cada capa

### Local (Community + módulo)

- Instalar / desinstalar `zgroup_partner_ext` sin error.
- Campo `x_ztrack_uid` visible en el modelo (no hace falta ponerlo en la ficha de Contactos).
- Constraint UNIQUE: dos contactos con el mismo UUID deben fallar.
- Índice: `search_read` ordenado por `write_date` (lo mide `odoo:probe:stage1`).
- XML-RPC: authenticate + `fields_get` + `search` desde este repo.

### Staging Odoo.sh (cuando exista el módulo)

- Mismos checks con **datos reales** (miles de `res.partner`).
- El probe no debe pasar de ~3 s el lote 300; si pasa, el índice no se creó.
- La UI de Contactos de un usuario normal sigue igual (el módulo no hereda `create`/`write`).
- Cotizaciones con `ODOO_SYNC_ENABLED=0`: botón SUPERUSER «Actualizar contactos» **solo** si el `.env` apunta a staging.

### Production

- Solo después de staging OK.
- Misma instalación por Apps.
- Probe `stage1` en ventana controlada.
- Escritura (etapa 5) **solo** con Cotizaciones apuntando a staging. Production: cuando el módulo UNIQUE esté instalado allí.

---

## 5. Qué no hacer

- Push directo a `production` / merge de `test-upgrade` “porque ya está ahead”.
- Instalar el módulo primero en production.
- Restaurar dump y dejar **crons EDI / mail** activos.
- Poner en `.env` de Cotizaciones la API key de production y probar `create` de contactos.
- Commitear dumps, filestore, `.env` o API keys.
- Mezclar ramas 15.0 con 17.0.
- Heredar `create`/`write` de `res.partner` “para avisar a Cotizaciones”.
- Exponer `localhost:8069` a internet.

---

## 6. Relación con documentos de este repo

| Documento | Rol |
|---|---|
| `fase1_odoo.md` | Qué hace `zgroup_partner_ext` y el checklist de instalación |
| `implementacion_contactos_odoo.md` | Plan completo de sync (etapas 0–5) |
| `implicancias_odoo_17.md` | XML-RPC, watermark, outbox, por qué un solo módulo |
| `odoo_sh.md` | Cómo clonar Odoo.sh, local vs nube, dumps y riesgos |
| **`fases_odoo_sh.md`** | Paso a paso de cada fase, Enterprise local, desafíos y criterios de salida |
| **`odoo_prueba.md`** | Laboratorio Community Docker + qué código subir y cómo hacer push a Odoo.sh |

---

## 7. Orden práctico esta semana

1. Clonar `aldomengoni/zgroup` (SSH, `--recurse-submodules`). **No** usar `test-upgrade` como base de trabajo nuevo.
2. Docker Odoo 17 + Postgres 15, base **vacía**.
3. Copiar `odoo_addons/zgroup_partner_ext` al addons path local e instalar.
4. `npm run odoo:probe:stage1` contra `http://localhost:8069`.
5. Branch `17.0-zgroup-partner-ext` → push → Development en Odoo.sh → instalar → probe contra esa URL.
6. Dump de staging **solo si** hace falta rendimiento con +10k contactos o un bug de datos.

La interfaz de Odoo.sh sigue siendo obligatoria para el visto bueno (build, Enterprise, datos). Local acorta el ciclo de “¿el módulo instala y el XML-RPC ve el campo?”.


cd ~/Proyectos/coti_zgroup
ODOO_URL='https://TU-BRANCH.dev.odoo.com' \
ODOO_DB='nombre-bd-staging' \
ODOO_USER='tu.usuario.staging' \
ODOO_API_KEY='clave-api-staging' \
ODOO_SYNC_ENABLED=0 \
npm run odoo:probe:stage1


ODOO_URL='https://zgroup-test-upgrade-36601712.dev.odoo.com' \
ODOO_DB='zgroup-test-upgrade-36601712' \
ODOO_USER='ztrack@zgroup.com.pe' \
ODOO_API_KEY='e8fe245ce3b70f69d15bad77883190cd35ffd40f' \
ODOO_SYNC_ENABLED=0 \
npm run odoo:probe:stage1



