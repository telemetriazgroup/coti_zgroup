# Fases Odoo.sh — guía paso a paso (local Enterprise + Cotizaciones)

Este documento es el **manual operativo**. Explica *qué hacer*, *en qué orden*, *por qué* y *qué se rompe* si se salta un paso.

El mapa estratégico (local vs nube, riesgos) está en `odoo_sh.md`. El módulo a instalar está descrito en `fase1_odoo.md`. Aquí se ejecuta.

**Objetivo de este ciclo:** poder probar cambios de Odoo (sobre todo `zgroup_partner_ext`) en una máquina local con **Odoo 17 Enterprise** lo más parecido a Odoo.sh, y recién después subirlos a un branch de Development / Staging.

```
Fase 0  Accesos y decisión de pista
Fase 1  Clonar Git de addons ZGROUP
Fase 2  Obtener fuentes Community + Enterprise 17.0
Fase 3  Levantar Odoo 17 Enterprise en local (vacío)
Fase 4  Meter el módulo zgroup_partner_ext e instalarlo
Fase 5  Probe XML-RPC desde Cotizaciones (localhost)
Fase 6  (Opcional) Restaurar dump de staging + filestore
Fase 7  Push a Odoo.sh Development → build → instalar
Fase 8  Staging con datos reales
Fase 9  Production (solo cierre)
```

Cada fase tiene: **por qué**, **requisitos**, **pasos**, **cómo saber que terminó**, **si falla**.

---

## Dos pistas (léelo antes de invertir un día)

Odoo.sh de ZGROUP es **17.0 Enterprise**. El Git `aldomengoni/zgroup` **no incluye** el core de Odoo ni los addons de pago. Solo los custom.

| Pista | Qué es | Cuándo usarla | Limitación |
|---|---|---|---|
| **A — Community vacío** | Imagen `odoo:17.0` de Docker (Community) + `zgroup_partner_ext` | Mañana: ¿el módulo instala y XML-RPC ve `x_ztrack_uid`? | **No** puedes restaurar un dump de Odoo.sh. **No** puedes instalar `l10n_pe` Enterprise / EDI. |
| **B — Enterprise local** | `odoo/odoo` 17.0 + `odoo/enterprise` 17.0 + addons ZGROUP | Probar el ERP como en la nube, o restaurar un backup | Necesitas **acceso Git al repo privado `odoo/enterprise`** (partner / contrato). Más RAM, más frágil. |

`zgroup_partner_ext` depende solo de `base`. La **pista A alcanza para cerrar la fase 1 de Cotizaciones**. La **pista B** hace falta si:

- quieres abrir Contactos con la misma UI/módulos que producción;
- vas a restaurar un backup de Odoo.sh;
- el cambio toca contabilidad, retenciones, EDI, tipos de cambio (`account_*`, `dv_l10n_pe_*`, `l10n_pe_*`).

Este documento detalla **la pista B** (Enterprise) y marca dónde A es atajo válido.

---

## Por qué no basta “probarlo en la interfaz de Odoo.sh”

| En Odoo.sh | Problema |
|---|---|
| Cada push dispara un **build** (minutos) | Un typo Python = otro ciclo |
| `test-upgrade` ya tiene **Test: Failed** | No es un laboratorio limpio |
| Production está **verde y con datos reales** | Un módulo mal instalado afecta SUNAT, facturas, usuarios |
| El editor web es VS Code remoto | Sirve para mirar, no para un ciclo git + debugger cómodo |

Local acorta el ciclo *editar → reiniciar → XML-RPC*. Odoo.sh sigue siendo el **visto bueno** (mismo Enterprise, mismos workers, mismos tests).

---

# Fase 0 — Accesos y decisión de pista

### Por qué

Sin SSH al Git de addons no hay código que montar. Sin acceso a `odoo/enterprise` no hay pista B. Decidir A vs B ahora evita instalar Community, restaurar un dump y descubrir a las 18:00 que faltan 80 módulos de pago.

### Requisitos

- Cuenta en el panel **Odoo.sh** del proyecto `zgroup` (`aldomengoni/zgroup`). Ya la tienes.
- Clave **SSH** en GitHub asociada al usuario que ve el repo privado.
- Permiso de **push** a ramas nuevas (Development). No hace falta push a `production`.
- Decisión de pista (A o B) anotada.
- Para pista B: que el partner Odoo (Aldo / contrato ZGROUP) te dé acceso a `github.com/odoo/enterprise` rama `17.0`, **o** un zip/tarball Enterprise 17.0 con licencia válida.

### Pasos

1. En la máquina:

```bash
ssh -T git@github.com
```

Debe responder con tu usuario. Si pide password, la clave no está cargada (`ssh-add`) o no está en GitHub → Settings → SSH and GPG keys.

2. En Odoo.sh, anota (Settings / History):

   - Versión: **17.0** (no 15, no 18).
   - Branch de producción: `production`.
   - Staging actual: `test-upgrade` (tests en rojo; **no** es la base de trabajo nuevo).

3. Pregunta al partner, por escrito:

   - ¿Tenemos acceso Git a `odoo/enterprise` 17.0?
   - Si no: ¿pueden pasarnos el árbol Enterprise 17.0 que usa Odoo.sh (mismo commit aproximado)?
   - ¿Código de suscripción Enterprise para bases **de prueba** (no el de production)?

4. Elige pista:

   - **Hoy, solo módulo Cotizaciones** → A, y deja B para cuando llegue `enterprise`.
   - **Dump o módulos PE** → no sigas a Fase 3 hasta tener Enterprise.

### Criterio de salida

- [ ] SSH a GitHub funciona.
- [ ] Sabes si esta semana es pista A o B.
- [ ] Nadie va a pushear a `production` “para probar”.

### Si falla

| Síntoma | Causa típica |
|---|---|
| `Permission denied (publickey)` | Clave no en el agente o no en GitHub |
| Ves el repo en la web y `git clone` 403 | Tu usuario GitHub no está en el org/colaboradores de `aldomengoni/zgroup` |
| Partner no da `enterprise` | Quédate en pista A; no restaures dumps |

---

# Fase 1 — Clonar el Git de addons ZGROUP

### Por qué

Ahí viven `l10n_pe_*`, `account_*`, `dv_l10n_pe_*`, etc. Sin este árbol, un Odoo Enterprise **vacío** no se parece a ZGROUP. El clone **no arranca Odoo**: solo es el tercer `addons-path`.

### Requisitos

- Fase 0 OK.
- Disco: el repo es Python + XML/HTML; suele ser cientos de MB, no decenas de GB (eso es el dump).
- Directorio **fuera** de `coti_zgroup`.

### Pasos

```bash
mkdir -p ~/Proyectos/odoo
cd ~/Proyectos/odoo

# Solo para MIRAR qué hay en staging sucio:
git clone --recurse-submodules --branch test-upgrade git@github.com:aldomengoni/zgroup.git zgroup-test-upgrade

# Base de TRABAJO (alineada a lo que corre en prod). Prueba production; si no existe, main:
git clone --recurse-submodules --branch production git@github.com:aldomengoni/zgroup.git zgroup
cd zgroup
git status
git log -8 --oneline
git submodule update --init --recursive
```

Si `production` no clonea, lista ramas:

```bash
git branch -a
```

Usa la rama 17.0 que Odoo.sh marca verde en Production. **No** uses ramas `15.0-*`.

Inventario:

```bash
find . -name '__manifest__.py' | sed 's|/__manifest__.py||' | sort
```

Comprueba que **no** está `zgroup_partner_ext` (aún no se ha subido). Eso confirma que Fase 4 es necesaria.

### Criterio de salida

- [ ] `~/Proyectos/odoo/zgroup` existe, submódulos resueltos.
- [ ] Sabes qué branch es “igual que prod”.
- [ ] `test-upgrade` queda como referencia, no como `HEAD` de trabajo.

### Si falla

| Síntoma | Qué hacer |
|---|---|
| Addons que no aparecen | Re-clonar con `--recurse-submodules` |
| Mix 15 y 17 en el mismo working copy | Borra y clona de nuevo la rama 17 |
| Repo enorme por dumps commiteados | No es normal; no hagas `git add` de `.sql` / filestore |

---

# Fase 2 — Fuentes Community + Enterprise 17.0

### Por qué

Odoo Enterprise **no es un Odoo distinto**. Es:

1. El servidor Community (`odoo-bin`, `odoo/odoo`).
2. Una carpeta extra de addons de pago (`enterprise/`).
3. `--addons-path` con **enterprise primero**, luego `odoo/addons`, luego custom ZGROUP.

La imagen Docker Hub `odoo:17.0` es **Community**. No trae `web_enterprise`, `account_accountant`, localizaciones de pago, etc. Un dump de Odoo.sh **no arranca** sobre esa imagen: al subir, Odoo busca módulos instalados en la BD que no están en disco → crash o “module not found”.

### Requisitos

- Git.
- Python **3.10** (Odoo 17; 3.12 suele doler).
- PostgreSQL **15** (Odoo.sh 17 usa 15; 16 suele funcionar; 14 no es ideal).
- Acceso a:
  - `github.com/odoo/odoo` rama `17.0` (público).
  - `github.com/odoo/enterprise` rama `17.0` (**privado**).

Documentación oficial: [Source install Odoo 17](https://www.odoo.com/documentation/17.0/administration/on_premise/source.html).

### Pasos — obtener el código

```bash
cd ~/Proyectos/odoo

git clone --branch 17.0 --single-branch --depth 1 https://github.com/odoo/odoo.git odoo17

# Privado: te tienen que haber invitado
git clone --branch 17.0 --single-branch git@github.com:odoo/enterprise.git enterprise17
```

Si `enterprise` da 404: **no hay acceso**. No lo “encuentras” en internet de forma legal. Opciones:

1. Partner te invita al repo.
2. Partner te entrega un tarball `enterprise-17.0.tar.gz` de su contrato.
3. Te quedas en pista A (Community) y no restauras dumps.

**No** copies el árbol Enterprise desde el contenedor de Odoo.sh “porque está ahí” y lo subas a un Git público. Es código con licencia.

Pin de versión: Odoo.sh no siempre está en el último commit de `17.0`. Si al restaurar un dump ves errores raros de vista/módulo, iguala el commit (Settings del proyecto Odoo.sh muestra la revisión). Para el módulo `zgroup_partner_ext` el pin exacto casi nunca importa.

### Desafíos y limitaciones de cargar Enterprise en local

| Desafío | Detalle | Impacto real |
|---|---|---|
| **Repo privado** | `odoo/enterprise` no se clona sin invitación | Bloquea pista B |
| **Licencia / expiry** | La BD Enterprise pide contrato; en local caduca o pide código | Puedes desarrollar; a veces aparece banner “database expired” |
| **No es Odoo.sh** | Sin el PaaS: 0 workers iguales, sin mail catcher, sin tests del build, sin backups automáticos | “Funciona en local” ≠ “build verde” |
| **Docker oficial = Community** | `docker pull odoo:17` no es Enterprise | Hay que montar fuentes a mano o una imagen propia |
| **Orden de addons-path** | Enterprise **antes** que Community | Si se invierte, carga `web` Community y rompe el backend Enterprise |
| **Dump vs módulos** | La BD espera **exactamente** los módulos instalados en la nube | Falta un `dv_l10n_pe_*` → no arranca |
| **Filestore** | Adjuntos, XML SUNAT, PDF. Puede ser más grande que la BD | Contactos funciona sin él; facturas/EDI no |
| **Crons** | EDI, correo, conciliación bancaria | En local **apagarlos** o reenvías XML / spameas |
| **RAM / CPU** | Dump mediano: 8 GB RAM; grande + filestore: 16 GB+ | El portátil se congela en `--update=all` |
| **wkhtmltopdf** | PDFs de informes | Irrelevante para Contactos / XML-RPC |
| **Python 3.12** | Odoo 17 no está pensado para 3.12 | Usa 3.10 (deadsnakes / pyenv / venv) |
| **Sistema operativo** | Dependencias C: `libpq`, `libldap`, `libjpeg`, `libsass` | `pip install -r requirements.txt` falla sin headers |
| **Locale Postgres** | Dump de Odoo.sh suele ser `en_US.UTF-8` / `C` | Restore con locale distinto a veces peta en índices |
| **Usuarios del dump** | Passwords y API keys **siguen valiendo** | No publiques el puerto 8069 |
| **SUNAT / mail** | Servidores reales en `ir.config_parameter` | Cambia URLs o desactiva connectors |
| **Ramas 15.0** | Siguen en el proyecto Odoo.sh | Un dump 17 en código 15 (o al revés) es irreparable |
| **Tests Odoo.sh** | `test-upgrade` ya falla | Local no ejecuta esa suite salvo que la lances a mano |

### Limitación de producto (importante para Cotizaciones)

Incluso con Enterprise local **perfecto**, no estás obligado a usarlo para la fase 1. El módulo es `depends: ['base']`. Si B se atrasa una semana, **pista A cierra el campo y el índice**. B entra cuando haya que pelear con `res.partner` lleno de campos PE (`vat`, `l10n_latam_identification_type_id`, etc.) o con un dump de 10k contactos.

### Criterio de salida

- [ ] Carpetas `odoo17/` y (pista B) `enterprise17/` en `~/Proyectos/odoo`.
- [ ] `ls enterprise17/web_enterprise` existe (sanity check).
- [ ] Python 3.10 y Postgres 15 instalados o en Docker.

---

# Fase 3 — Levantar Odoo 17 Enterprise en local (base vacía)

### Por qué

Una base **vacía** Enterprise valida: arranque, login, Apps, addons-path. Si esto no funciona, un dump va a ser infierno. Aquí **no** se instala todavía la pila PE completa (tarda y pide datos de compañía).

### Requisitos de máquina

- 4 CPU / **8 GB RAM** mínimo (16 GB si luego hay dump).
- ~20 GB libres (fuentes + venv + BD vacía).
- Docker **o** Postgres nativo 15 + venv.

Abajo: **fuente + venv** (la forma documentada por Odoo para Enterprise). Docker solo Community no replica B.

### Pasos — PostgreSQL

```bash
# Ubuntu / Debian
sudo apt install postgresql postgresql-contrib
sudo -u postgres createuser -s "$USER"
createdb postgres   # si no existe el rol
```

Odoo crea las BD él mismo vía el database manager; el usuario de tu sesión debe poder `CREATE DATABASE`.

### Pasos — dependencias Python (host)

```bash
cd ~/Proyectos/odoo/odoo17
python3.10 -m venv ~/Proyectos/odoo/venv17
source ~/Proyectos/odoo/venv17/bin/activate
pip install -U pip wheel
pip install -r requirements.txt
```

Si `psycopg2` o `python-ldap` fallan:

```bash
sudo apt install libpq-dev libldap2-dev libsasl2-dev libjpeg-dev zlib1g-dev libxml2-dev libxslt1-dev
```

En Ubuntu reciente el paquete de sistema `python3-odoo` **no** sustituye esto: mezcla versiones.

### Pasos — `odoo.conf` local

Crea `~/Proyectos/odoo/odoo17-local.conf` (**no** lo subas a git con passwords):

```ini
[options]
addons_path = /home/TU_USER/Proyectos/odoo/enterprise17,/home/TU_USER/Proyectos/odoo/odoo17/addons,/home/TU_USER/Proyectos/odoo/zgroup
admin_passwd = CAMBIAR_MASTER_LOCAL
db_host = False
db_port = False
db_user = TU_USER
db_password = False
http_port = 8069
without_demo = True
max_cron_threads = 0
workers = 0
logfile = False
```

Por qué cada línea:

| Opción | Por qué |
|---|---|
| `addons_path` enterprise **primero** | Carga `web_enterprise` en vez de `web` Community |
| `zgroup` al final | Tus custom pisan nombres si coinciden (no deberían) |
| `without_demo = True` | No ensucia Contactos con partners demo |
| `max_cron_threads = 0` | Ni mail ni EDI ni crons a SUNAT |
| `workers = 0` | Modo desarrollo (reload, pdb). En Odoo.sh hay workers |
| `admin_passwd` | Master del `/web/database/manager`. Distinto al de production |

### Pasos — arrancar

```bash
source ~/Proyectos/odoo/venv17/bin/activate
cd ~/Proyectos/odoo/odoo17
python3 odoo-bin -c ~/Proyectos/odoo/odoo17-local.conf
```

Navegador: `http://localhost:8069`

1. Crear base `zgroup_ent_dev`.
2. Idioma: español. País: Perú (aunque no instales `l10n_pe` aún).
3. Login `admin` + la clave que pusiste al crear la BD.
4. Deberías ver el backend **Enterprise** (menú Apps con diseño de pago, no el Community puro).

### Pista A (atajo, si aún no hay `enterprise`)

`docker-compose` con `image: odoo:17.0`, montar solo `zgroup` + `zgroup_partner_ext`, base vacía. Sirve para Fase 4–5 del módulo mínimo. **No** uses esa instancia para Fase 6 (dump).

### Criterio de salida

- [ ] Login en `localhost:8069` con look Enterprise (pista B) o Community (pista A).
- [ ] Apps abre. Aún no hace falta instalar localización PE.
- [ ] Los crons no están corriendo (`max_cron_threads = 0`).

### Si falla

| Síntoma | Causa |
|---|---|
| UI Community habiendo clonado enterprise | `addons_path` mal ordenado o path mal escrito |
| `Module not found: web_enterprise` | No clonaste `enterprise` o el path no apunta al root correcto (debe contener carpetas-módulo, no un nivel de más) |
| Puerto 8069 ocupado | Otra instancia; cambia `http_port` |
| `Database expired` | Licencia local; pide al partner un código de prueba o trabaja en el grace period |
| `Permission denied` Postgres | El user de Linux no es owner de Postgres |

---

# Fase 4 — Instalar `zgroup_partner_ext`

### Por qué

Cotizaciones no puede crear el campo por XML-RPC de forma segura (UNIQUE + índice `write_date`). Studio no es equivalente: no versiona, no garantiza el UNIQUE ni el índice. El addon ya está escrito en **este** repo (`odoo_addons/zgroup_partner_ext/`). Hay que **copiarlo** al árbol ZGROUP local e instalarlo en Apps.

Sin esta fase:

- el pull incremental (etapa 3 de Cotizaciones) hace seq scan en `res_partner`;
- la escritura (etapa 5) puede **duplicar** contactos si un `create` hace timeout.

### Requisitos

- Fase 3 OK.
- Este repo `coti_zgroup` con `odoo_addons/zgroup_partner_ext/`.

### Pasos

```bash
cp -a /home/telemetriazgroup/Proyectos/coti_zgroup/odoo_addons/zgroup_partner_ext \
      ~/Proyectos/odoo/zgroup/zgroup_partner_ext

test -f ~/Proyectos/odoo/zgroup/zgroup_partner_ext/__manifest__.py
```

Reinicia Odoo (Ctrl+C y vuelve a `odoo-bin`) **o** si ya corría con `--dev=reload`, a veces no detecta un módulo nuevo: reinicio limpio.

En la UI:

1. Activa **modo desarrollador** (Ajustes → abajo).
2. Apps → quitar el filtro «Aplicaciones».
3. Menú ⋮ → **Actualizar lista de aplicaciones**.
4. Buscar **ZGROUP Partner Ext** (`zgroup_partner_ext`).
5. **Instalar**.

Comprobación técnica (psql):

```sql
-- campo
SELECT name, ttype FROM ir_model_fields
 WHERE model = 'res.partner' AND name = 'x_ztrack_uid';

-- índice write_date
SELECT indexname FROM pg_indexes
 WHERE tablename = 'res_partner' AND indexname = 'res_partner_write_date_idx';

-- unique
SELECT conname FROM pg_constraint
 WHERE conname LIKE '%x_ztrack_uid%';
```

En Odoo: Técnico → Modelos → `res.partner` → campo `x_ztrack_uid`. No hace falta ponerlo en la ficha de Contactos.

### Criterio de salida

- [ ] Módulo `installed`.
- [ ] Campo + UNIQUE + índice existen.
- [ ] Instalar no tocó `create`/`write` (no hay overrides en el código; no añadas).

### Si falla

| Síntoma | Causa |
|---|---|
| No aparece en Apps | `addons_path` no incluye `~/Proyectos/odoo/zgroup` o no reiniciaste |
| Aparece y falla al instalar | Error Python en `res_partner.py`; mira el log de `odoo-bin` |
| Índice no existe | `init()` no corrió; reinstalación `-u zgroup_partner_ext` |

Upgrade a mano:

```bash
python3 odoo-bin -c ~/Proyectos/odoo/odoo17-local.conf -d zgroup_ent_dev -u zgroup_partner_ext --stop-after-init
```

---

# Fase 5 — Probe XML-RPC desde Cotizaciones (localhost)

### Por qué

La app no usa la sesión web. Usa `/xmlrpc/2/common` y `/xmlrpc/2/object` con **API key**. Si el módulo “se ve en Apps” pero XML-RPC no lista el campo, Cotizaciones no sirve. Esta fase cierra el circuito **sin tocar production**.

### Requisitos

- Odoo local en 8069.
- `zgroup_partner_ext` instalado.
- Este repo con `npm run odoo:probe:stage1`.

### Pasos

1. En Odoo local: crea usuario interno `integracion.local` (o similar), grupo Contactos. **No** uses el admin de todos los días.
2. Preferencias de ese usuario → Seguridad → **Nueva clave API**. Cópiala una vez.
3. En `coti_zgroup`, **no** pises el `.env` de production. Crea `.env.odoo.local` (gitignored):

```bash
ODOO_URL=http://localhost:8069
ODOO_DB=zgroup_ent_dev
ODOO_USER=integracion.local
ODOO_API_KEY=pegar_clave
ODOO_TIMEOUT_MS=20000
ODOO_SYNC_ENABLED=0
```

4. Lanza el probe cargando esas vars (ejemplo):

```bash
cd /home/telemetriazgroup/Proyectos/coti_zgroup
set -a && source .env.odoo.local && set +a
npm run odoo:probe
npm run odoo:probe:stage1
```

`odoo:probe` debe autenticar y listar campos de `res.partner`.  
`odoo:probe:stage1` **debe pasar**: módulo instalado, campo `x_ztrack_uid`, search de UUID inventado = 0 filas, lote `write_date` razonable.

### Criterio de salida

- [ ] `stage1` verde contra localhost.
- [ ] `.env` de production **intocado**.
- [ ] `ODOO_SYNC_ENABLED=0` (no dispares el worker de pull contra local salvo que quieras).

### Si falla

| Síntoma | Causa |
|---|---|
| `AccessDenied` | Usuario/clave/BD mal; API key no es el password de login |
| Módulo ausente en probe | Probe sigue leyendo production: no cargaste `.env.odoo.local` |
| Timeout | Odoo no está en 8069 o firewall |
| XML-RPC 404 | `ODOO_URL` con path de más o HTTPS contra HTTP |

---

# Fase 6 — (Opcional) Dump de staging + filestore

### Por qué

Una base vacía no tiene 10k `res.partner`, ni los campos extra de `l10n_pe`, ni los bugs de datos reales (RUC `False`, etiquetas, archivados). El dump sirve para:

- medir de verdad el índice `write_date`;
- ver si el módulo instala **encima** de una BD ya madura;
- depurar un contacto concreto que falla en el picker.

**No** es el primer paso. Sin Fases 2–3, el restore ni arranca.

### Requisitos

- Pista **B** (Enterprise) con **los mismos custom** que el branch del backup (`~/Proyectos/odoo/zgroup` alineado a esa rama).
- Disco: reserva **2–3×** el tamaño del zip (BD + filestore + restore temporal).
- Backup bajado de Odoo.sh → branch **staging** (preferible) o production tratado como **copia muerta**.

### Pasos — descargar

En Odoo.sh, branch staging (o el que vayas a copiar):

1. Pestaña **Backups**.
2. Create backup si hace falta.
3. Download: purpose **Testing**, **with filestore**.
4. Guarda el zip **fuera del git** (p. ej. `~/Proyectos/odoo/backups/`, y esa carpeta en `.gitignore` si está cerca del repo).

El zip típico trae `dump.sql` (o `.dump`) + `filestore/` + a veces `manifest.json`.

### Pasos — restaurar BD

Para el nombre usa uno **nuevo** (`zgroup_stg_local`), nunca el de production.

```bash
createdb zgroup_stg_local
# Si es SQL plano:
psql -d zgroup_stg_local -f dump.sql
# Si es custom format:
pg_restore --no-owner --role="$USER" -d zgroup_stg_local dump.dump
```

Errores de `role odoo does not exist` se evitan con `--no-owner`.

### Pasos — filestore

Odoo busca:

```text
~/.local/share/Odoo/filestore/<NOMBRE_BD>
```

El nombre de carpeta debe coincidir con la BD (`zgroup_stg_local`):

```bash
mkdir -p ~/.local/share/Odoo/filestore/zgroup_stg_local
cp -a filestore/. ~/.local/share/Odoo/filestore/zgroup_stg_local/
```

(Si el zip ya trae el UUID interno de Odoo.sh, a veces hay que copiar el contenido de esa carpeta, no anidar otra.)

### Pasos — apagar el mundo exterior

**Antes** de arrancar Odoo contra este dump:

```sql
UPDATE ir_cron SET active = false;
```

Y en `odoo.conf` sigue `max_cron_threads = 0`.

Opcional, para no pegarle a SMTP/SUNAT aunque alguien active un cron:

- Revisa `ir.mail_server` (dejar vacío o dummy).
- Parámetros de sistema de EDI / OSE: no apuntes a producción.

Arranque:

```bash
python3 odoo-bin -c ~/Proyectos/odoo/odoo17-local.conf -d zgroup_stg_local --max-cron-threads=0
```

Si pide upgrade de módulos:

```bash
python3 odoo-bin -c ~/Proyectos/odoo/odoo17-local.conf -d zgroup_stg_local -u zgroup_partner_ext --stop-after-init
```

Luego instala `zgroup_partner_ext` si el dump aún no lo tenía (Fase 4 sobre esta BD).

### Lo que el dump **no** te da

- Los workers y el mail catcher de Odoo.sh.
- Certificados / IPs allowlist.
- Derecho a **subir esa BD otra vez** a production.
- Un entorno legal para emitir comprobantes.

### Criterio de salida

- [ ] Login local con un usuario del dump (cámbiale el mail si vas a probar reset).
- [ ] Contactos lista partners reales.
- [ ] Crons off. Ningún XML salió a SUNAT.
- [ ] `stage1` contra `ODOO_DB=zgroup_stg_local`.

### Si falla

| Síntoma | Causa |
|---|---|
| `Module X not found` al arrancar | Addons-path no incluye el custom que production tenía instalado; o estás en Community |
| Arranca pero sin logos/PDF | Filestore mal copiado o nombre de carpeta ≠ nombre BD |
| `out of memory` en restore | dump grande; sube RAM / restore en máquina más gorda |
| Login infinito | `web_enterprise` no carga (path) |

---

# Fase 7 — Push a Odoo.sh Development

### Por qué

Local no corre los tests del PaaS ni el mismo `odoo` pin. Un branch nuevo en Odoo.sh crea un **Development** aislado: puedes instalar el módulo con un build, sin tocar staging sucio ni production.

### Requisitos

- `zgroup_partner_ext` probado en Fase 5 (local).
- Push permitido.
- **No** mezclar con `test-upgrade`.

### Pasos

```bash
cd ~/Proyectos/odoo/zgroup
git checkout production   # o la rama 17 verde
git pull
git checkout -b 17.0-zgroup-partner-ext

# el módulo ya copiado en Fase 4
git add zgroup_partner_ext
git status   # solo esa carpeta
git commit -m "Add zgroup_partner_ext (UID Cotizaciones + index write_date)"
git push -u origin 17.0-zgroup-partner-ext
```

En Odoo.sh:

1. Aparece el branch en **Development**.
2. Esperar **build verde**. Si falla, lee el log (tests, manifiesto, dependencia).
3. **Connect**.
4. Apps → actualizar lista → instalar **ZGROUP Partner Ext** (el Git **no** instala solo).
5. Usuario de integración **de ese branch** + API key nueva.
6. Probe `stage1` con `ODOO_URL` = URL del Connect (no `zgroup.odoo.com` de production).

### Criterio de salida

- [ ] Build verde.
- [ ] Módulo instalado en ese Development.
- [ ] `odoo:probe:stage1` verde contra esa URL.

### Si falla

| Síntoma | Causa |
|---|---|
| Test failed (como `test-upgrade`) | Un test de otro módulo; no “arregles” production desde aquí. Mira si tu módulo aparece en el traceback |
| Módulo no en Apps | Build no copió la carpeta (path, `__manifest__` inválido, versión ≠ 17.0) |
| Push rejected | Sin permiso write; pide acceso |

---

# Fase 8 — Staging

### Por qué

Development a veces nace **vacío**. Staging es (o debería ser) un clon reciente de production: mismos 10k contactos, mismos módulos PE. Ahí se valida el índice de verdad y que Contactos no se rompe para un usuario de facturación.

Hoy `test-upgrade` **no** es un staging sano (tests failed, 423 commits ahead). Opciones:

- Reparar/recrear un staging desde `production`; o
- Usar el Development de Fase 7 + un backup restaurado **en Odoo.sh** (el propio panel permite copiar BD a un branch).

No improvises merges de `test-upgrade` → `production`.

### Pasos

1. Tener un branch staging 17.0 **verde**.
2. Merge (PR) de `17.0-zgroup-partner-ext` → ese staging.
3. Build verde.
4. Instalar o `-u` el módulo.
5. Probe `stage1` (lote 300 < ~3 s; si tarda, el índice no está).
6. Un usuario no técnico abre Contactos y guarda una ficha: no debe haber traceback.
7. Cotizaciones: **solo** si cambias `.env` a la URL de staging. Nunca el botón «Actualizar contactos» contra production mientras pruebas escritura.

### Criterio de salida

- [ ] Staging verde + módulo instalado + probe OK + UI Contactos OK.

---

# Fase 9 — Production (cierre, no laboratorio)

### Por qué

Ahí están las facturas y SUNAT. El módulo es pequeño (`base` + un campo nullable) y **debería** ser de bajo riesgo, pero el primer install en prod se hace **después** de staging, en una ventana, con probe.

### Pasos

1. PR/merge a `production`.
2. Build verde (obligatorio).
3. Instalar **ZGROUP Partner Ext** en Apps.
4. `npm run odoo:probe:stage1` contra production (lectura).
5. Seguir con `ODOO_SYNC_ENABLED` como esté acordado. **No** activar etapa 5 (create/write) el mismo día “porque el campo ya existe”: el outbox de Cotizaciones es otro trabajo.

### Criterio de salida

- [ ] Módulo `installed` en production.
- [ ] Probe stage1 verde.
- [ ] `fase1_odoo.md` se puede marcar etapa 1 **cerrada**.

---

## Mapa rápido: qué fase desbloquea qué en Cotizaciones

| Fase local/Odoo.sh | Etapa en `implementacion_contactos_odoo.md` |
|---|---|
| 0–1 (accesos + clone) | Nada nuevo en la app; desbloquea instalar addons |
| 4–5 (módulo + probe local) | Prueba de etapa 1 |
| 7–8 (dev/staging) | Etapa 1 **oficial** |
| 9 (production) | Etapa 1 **cerrada** |
| Índice en prod | Pull etapa 3 más barato |
| Campo UNIQUE en prod | Permite diseñar etapa 5 (escritura) sin duplicar |

Las etapas 2–4 de Cotizaciones (caché Postgres, worker pull, picker) **ya pueden vivir** leyendo production sin el módulo; solo son más lentas / inseguras para escribir.

---

## Checklist de “no hacer” (todas las fases)

- Push a `production` para ver si el manifiesto parsea.
- Restaurar dump sobre Community.
- Dejar crons activos en un dump local.
- Usar la API key de production en pruebas de `create`.
- Commitear dump, filestore, `.env`, API keys.
- Heredar `create`/`write` de `res.partner` para llamar a Cotizaciones.
- Mezclar rama 15.0 con 17.0.
- Exponer `8069` a internet.
- Tratar `test-upgrade` como fuente de verdad.

---

## Documentos hermanos

| Archivo | Para qué |
|---|---|
| `odoo_sh.md` | Local vs Odoo.sh, implicancias, clone |
| **Este archivo** | Fases numeradas, Enterprise, dump, porqués |
| `fase1_odoo.md` | Qué hace exactamente el módulo |
| `implementacion_contactos_odoo.md` | Plan de sync en la app |
| `implicancias_odoo_17.md` | XML-RPC, watermark, outbox |
