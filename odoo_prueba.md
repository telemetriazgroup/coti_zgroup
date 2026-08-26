# Prueba local Odoo Community 17 → envío a Odoo.sh

Laboratorio **Community** (Docker) para validar el módulo `zgroup_partner_ext` **antes** de subirlo al Git de Odoo.sh.

No es el ERP de ZGROUP (ese es **Enterprise** en `zgroup.odoo.com`). Aquí solo comprobamos: el addon instala, crea el campo y el índice, y XML-RPC los ve. Eso es suficiente para la fase 1 de Cotizaciones.

| Qué | Valor |
|---|---|
| UI local | http://localhost:8070 |
| Base | `zgroup_dev` |
| Master (gestor de BD) | `zgroup_local_master` |
| Login inicial | `admin` / `admin` |
| Código a probar | `odoo_addons/zgroup_partner_ext/` (este repo) |
| Destino cuando pase | Git `github.com/aldomengoni/zgroup` → branch nuevo → Odoo.sh Development |

Detalle de pistas A/B y dumps: `fases_odoo_sh.md`. Mapa local vs nube: `odoo_sh.md`.

---

## 1. Objetivo del cambio (qué estamos metiendo en Odoo y por qué)

Cotizaciones ya **lee** Contactos de production por XML-RPC (etapa 0). Faltan dos piezas **dentro de Odoo**, que la app no puede crear por API de forma limpia:

| Pieza | Para qué | Si no está |
|---|---|---|
| Campo `x_ztrack_uid` (Char, UNIQUE, `copy=False`) | Idempotencia cuando Cotizaciones **cree** un contacto (etapa 5). Si el `create` hace timeout, se busca este UUID: si ya existe, no se duplica. | Reintentar a ciegas **duplica** `res.partner` (facturas, albaranes colgados). |
| Índice `res_partner_write_date_idx` sobre `write_date` | Pull incremental cada 15 min: “contactos cambiados desde X”. Odoo **no** indexa `write_date` por defecto. | Con +10k fichas, seq scan en cada sync; satura workers y pone lenta la UI de Contactos. |

El módulo **no**:

- hereda `create` / `write`;
- llama HTTP a Cotizaciones;
- toca facturación, EDI ni localización PE;
- instala nada más que `base`.

Por eso Community alcanza para esta prueba. Restaurar un dump de Odoo.sh **aquí no se puede** (esa BD exige Enterprise + addons PE).

Nombre técnico: `zgroup_partner_ext`. Nombre en Apps: **ZGROUP Partner Ext**.

---

## 2. El código que va a Odoo.sh (solo esta carpeta)

Copiar **tal cual** al **root de addons** del repo `aldomengoni/zgroup` (junto a `l10n_pe_*`, `account_*`, etc.), no dentro de `coti_zgroup`.

```
zgroup_partner_ext/
  __init__.py
  __manifest__.py
  models/
    __init__.py
    res_partner.py
```

### `__manifest__.py`

```python
# -*- coding: utf-8 -*-
{
    'name': 'ZGROUP Partner Ext',
    'version': '17.0.1.0.0',
    'category': 'Hidden',
    'summary': 'UID externo e índice write_date en res.partner (integración Cotizaciones)',
    'author': 'ZGROUP',
    'license': 'LGPL-3',
    'depends': ['base'],
    'data': [],
    'installable': True,
    'application': False,
    'auto_install': False,
}
```

`version` 17.0.x: Odoo.sh 17 **ignora** un manifiesto 15.0 / 18.0.

### `models/res_partner.py` (el cambio de verdad)

```python
from odoo import fields, models, tools

class ResPartner(models.Model):
    _inherit = 'res.partner'

    x_ztrack_uid = fields.Char(
        string='UID Ztrack',
        index=True,
        copy=False,
        help='Clave de idempotencia de Cotizaciones ZGROUP. No editar a mano.',
    )

    _sql_constraints = [
        ('x_ztrack_uid_uniq', 'unique(x_ztrack_uid)', 'UID externo duplicado (x_ztrack_uid)'),
    ]

    def init(self):
        tools.create_index(
            self._cr,
            'res_partner_write_date_idx',
            self._table,
            ['write_date'],
        )
```

Los `__init__.py` solo importan `models` y `res_partner`.

**No** subir a Odoo.sh: `docker-compose` de `odoo_prueba/`, dumps, `.env`, ni este repo Node.

---

## 3. Levantar Community (laboratorio)

Desde la raíz de `coti_zgroup`:

```bash
cd odoo_prueba
docker compose up -d db
```

Crear la base e instalar el módulo (una vez):

```bash
docker compose run --rm odoo odoo \
  -d zgroup_dev \
  -i base,zgroup_partner_ext \
  --without-demo=all \
  --stop-after-init
```

Arrancar la UI:

```bash
docker compose up -d odoo
```

Abrir http://localhost:8070 → base `zgroup_dev` → `admin` / `admin`.

Si el módulo ya estaba y cambiaste Python:

```bash
docker compose run --rm odoo odoo -d zgroup_dev -u zgroup_partner_ext --stop-after-init
docker compose up -d odoo
```

Parar:

```bash
docker compose down     # conserva volúmenes
docker compose down -v  # borra la BD de prueba
```

### Cómo saber que la prueba fue exitosa

En Odoo (modo desarrollador): Apps → quitar filtro Aplicaciones → existe **ZGROUP Partner Ext** instalado.

En Postgres del laboratorio:

```bash
docker compose exec db psql -U odoo -d zgroup_dev -c \
  "SELECT name FROM ir_model_fields WHERE model='res.partner' AND name='x_ztrack_uid';"
docker compose exec db psql -U odoo -d zgroup_dev -c \
  "SELECT indexname FROM pg_indexes WHERE tablename='res_partner' AND indexname='res_partner_write_date_idx';"
```

Probe desde Cotizaciones **sin pisar production**. Crea `odoo_prueba/.env.probe` (no commitear):

```bash
ODOO_URL=http://localhost:8070
ODOO_DB=zgroup_dev
ODOO_USER=admin
ODOO_API_KEY=admin
ODOO_TIMEOUT_MS=20000
ODOO_SYNC_ENABLED=0
```

En Community recién creado, el “API key” del CLI suele ser la **contraseña** `admin` hasta que generes una clave en Preferencias → Seguridad.

```bash
cd /home/telemetriazgroup/Proyectos/coti_zgroup
set -a && source odoo_prueba/.env.probe && set +a
npm run odoo:probe
npm run odoo:probe:stage1
```

`stage1` verde = el laboratorio cumplió. **Ahí** se envía a Odoo.sh, no antes.

---

## 4. Cómo te “conectas” a Odoo.sh para enviar el cambio

Hay **dos canales**. No se sube el código por la UI de Odoo.sh (botón Editor es un VS Code remoto; no es el flujo de este módulo).

```
[ este repo ]  odoo_addons/zgroup_partner_ext
        │  copiar carpeta
        ▼
[ GitHub ]  aldomengoni/zgroup   rama 17.0-zgroup-partner-ext
        │  git push (SSH)
        ▼
[ Odoo.sh ]  detecta el push → BUILD
        │  si verde: Connect → Apps → Instalar
        ▼
  Development (prueba en la nube Enterprise)
        │  merge
        ▼
  Staging → Production
```

### 4.1 Conexión Git (enviar código)

Odoo.sh **es** el repo `github.com/aldomengoni/zgroup`. Un `git push` a una rama **es** enviar el cambio a Odoo.sh.

1. SSH (una vez):

```bash
ssh -T git@github.com
```

Debe reconocer tu usuario. Si falla: GitHub → Settings → SSH keys.

2. Clone **aparte** de Cotizaciones (el ERP no se mezcla con Node):

```bash
mkdir -p ~/Proyectos/odoo
cd ~/Proyectos/odoo
git clone --recurse-submodules --branch production git@github.com:aldomengoni/zgroup.git
cd zgroup
```

Si `production` no existe, usa la rama 17.0 que en Odoo.sh está **verde** en Production (`main`, etc.). **No** uses `test-upgrade` (tests failed, 423 commits ahead).

3. Branch nuevo + copiar **solo** el módulo ya probado:

```bash
git checkout -b 17.0-zgroup-partner-ext
cp -a /home/telemetriazgroup/Proyectos/coti_zgroup/odoo_addons/zgroup_partner_ext \
      ./zgroup_partner_ext
git add zgroup_partner_ext
git status    # debe listar solo esos 4 archivos
git commit -m "Add zgroup_partner_ext (UID Cotizaciones + index write_date)"
git push -u origin 17.0-zgroup-partner-ext
```

4. En el panel Odoo.sh (`aldomengoni/zgroup`):

   - La rama aparece en **Development**.
   - Espera el **build** (History). Tiene que quedar verde.
   - **Connect** abre **ese** Odoo (Enterprise, URL tipo `*.odoo.com` del branch), no production.

El clone que el propio Odoo.sh muestra:

```bash
git clone --recurse-submodules --branch test-upgrade git@github.com:aldomengoni/zgroup.git
```

Eso es para **bajar** lo que hay. Para **enviar** este módulo usa el branch nuevo, no `test-upgrade`.

### 4.2 Conexión a la instancia (instalar el módulo)

El push **no instala** el addon. Odoo.sh solo deja el código en el addons-path del build.

1. **Connect** en el branch Development.
2. Modo desarrollador → Apps → quitar filtro Aplicaciones → **Actualizar lista**.
3. Instalar **ZGROUP Partner Ext**.
4. Usuario de integración **de ese branch** + API key nueva (no la de production).
5. Probe:

```bash
ODOO_URL=<URL del Connect de ese branch>
ODOO_DB=<nombre que muestre esa instancia>
ODOO_USER=...
ODOO_API_KEY=...
npm run odoo:probe:stage1
```

### 4.3 De Development a production

| Paso | Dónde | Qué |
|---|---|---|
| 1 | GitHub / Odoo.sh | PR o merge `17.0-zgroup-partner-ext` → staging 17.0 **verde** (no `test-upgrade` sucio) |
| 2 | Staging Connect | Instalar o actualizar módulo; probe `stage1` |
| 3 | Production | Merge a `production`, **build verde**, instalar en Apps, probe lectura |

Nunca el primer install en production. Nunca `git push` directo a `production` “para ver si parsea”.

---

## 5. Qué no hace esta prueba Community

| Limitación | Consecuencia |
|---|---|
| No es Enterprise | No instales `l10n_pe_*` / EDI de ZGROUP aquí |
| No hay dump de Odoo.sh | No vas a ver los 10k contactos reales |
| Puerto 8070 | No choca con Cotizaciones (`:3000`) ni Postgres host `5433` |
| Crons a 0 | No manda correo |
| Production `.env` | El probe debe usar `.env.probe`; si no, sigues pegándole a `zgroup.odoo.com` |

Cuando haga falta Enterprise + dump: `fases_odoo_sh.md` fases 2, 3B y 6.

---

## 6. Checklist corto

- [ ] `docker compose` en `odoo_prueba/` arriba; UI en :8070
- [ ] `zgroup_partner_ext` instalado; campo + índice en SQL
- [ ] `npm run odoo:probe:stage1` verde contra **localhost:8070**
- [ ] Clone `aldomengoni/zgroup` por SSH; branch `17.0-zgroup-partner-ext`
- [ ] Push **solo** la carpeta `zgroup_partner_ext`
- [ ] Odoo.sh Development build verde → Connect → Instalar → probe contra esa URL
- [ ] Staging y luego production
