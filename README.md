# ZGROUP — Cotizaciones Técnicas

Sistema web de cotizaciones técnicas para refrigeración industrial (ZGROUP, Perú). **Backend:** Node.js + Express + PostgreSQL. **Frontend:** React 18 + Vite, con paleta y tipografías fijas en `.cursorrules` (misma línea visual que el HTML de referencia).

## Referencia de interfaz y lógica financiera

El prototipo **`zgroup-cotizaciones-v10-final.html`** (raíz del repo) es la referencia visual y funcional para:

- **UI:** tema oscuro, variables CSS (`--cyan`, `--card`, etc.), header con selector de proyecto, zona catálogo / presupuesto / módulos financieros (M1–M4), tipografías Rajdhani + JetBrains Mono + Inter.
- **Lógica financiera:** los acordeones M1–M4 y totales deberán alinearse con ese comportamiento cuando se implemente **`shared/finance-engine.js`** (Sprint 4) y su integración en el cliente React.

El producto objetivo **mantiene la interfaz y la lógica del módulo financiero** según ese HTML y `MODULES.md` / `modulo financiero.md`, migrando a API REST, BD y roles.

## Contexto de arquitectura (`.cursorrules`)

| Área | Contenido |
|------|-----------|
| API | Respuestas `{ success, data }` o `{ success, error: { code, message } }` |
| Auth | JWT en `Authorization: Bearer`, refresh en cookie `httpOnly` `sameSite=strict` |
| Roles | `ADMIN`, `COMERCIAL`, `VIEWER` |
| BD | `snake_case`; proyectos con soft delete; auditoría append-only (sprints posteriores) |

Documentación ampliada: `ZGROUP_ANALYSIS.md`, `SPRINT_PLAN.md`.

## Requisitos

Elige **una** de estas formas de trabajar:

| Forma | Necesitas |
|-------|-----------|
| **Docker** (recomendado para levantar todo) | Docker Engine 24+ y Docker Compose v2 |
| **Solo Node** | Node.js 18+ (recomendado 20) y PostgreSQL 15+ con extensión `uuid-ossp` |

### Desarrollo local (recomendado): API + Vite

En una terminal, con PostgreSQL accesible y `.env` configurado:

```bash
npm install
npm run dev
```

Esto levanta **Express en el puerto 3000** y **Vite en el puerto 5173**. Abre la app en **[http://localhost:5173](http://localhost:5173)** (las peticiones a `/api` se proxifican al backend). Rutas internas: **`#/login`**, **`#/dashboard`**.

**Producción / solo backend:** `npm run build` genera `client/dist`; `NODE_ENV=production npm start` sirve la API y el SPA desde el mismo servidor (puerto `PORT`, por defecto 3000).

---

## Puesta en marcha con Docker

El archivo `docker-compose.yml` levanta la **API Node**, **PostgreSQL 15**, **Redis** y **MinIO** (S3-compatible, para sprints futuros). La app solo depende de Postgres en el Sprint 0.

### 1. Variables opcionales

Puedes crear un `.env` en la raíz del proyecto para sobreescribir secretos (si no existe, Compose usa valores por defecto seguros solo para desarrollo):

```bash
cp .env.example .env
```

Recomendado en cualquier entorno compartido o producción: define `DB_PASSWORD`, `JWT_ACCESS_SECRET` y `JWT_REFRESH_SECRET` en ese `.env` (Compose los inyecta en el servicio `app`).

Si **3000**, **5433** u **6382** están ocupados, cambia solo los puertos publicados en el host (la red interna de Docker no cambia):

```bash
APP_HOST_PORT=3001 POSTGRES_HOST_PORT=5434 REDIS_HOST_PORT=6389 docker compose up -d
```

Si cambias `APP_HOST_PORT`, ajusta también **`FRONTEND_URL`** al mismo origen que uses en el navegador (CORS y cookies), por ejemplo `FRONTEND_URL=http://localhost:3001`.

Recuerda usar el mismo `POSTGRES_HOST_PORT` como `DB_PORT` en tu `.env` cuando conectes a Postgres desde el host (tests, cliente SQL, etc.).

### 2. Construir e iniciar

```bash
cd coti_zgroup
docker compose build
docker compose up -d
```

La primera vez, el contenedor `app` ejecuta el **seed** (usuarios demo + catálogo) y arranca el servidor. El esquema SQL se aplica al iniciar (`initSchema()`).

### Acceso por IP (HTTP) o sin dominio

Si entras con **`http://<tu-ip>:3000`** (sin dominio), configura en `.env` / Docker:

- **`FRONTEND_URL=http://<tu-ip>:3000`** (exactamente la URL del navegador; CORS y cookies).
- **`RELAX_HELMET_HTTP=1`**: desactiva cabeceras COOP/COEP de Helmet que en HTTP sobre IP suelen mostrar avisos o ignorarse (no sustituyen HTTPS; en producción conviene **TLS** detrás de nginx/Caddy).

Opcional: **`ALLOWED_ORIGINS`** (coma) si necesitas más de un origen; **`TRUST_PROXY=1`** si hay proxy inverso.

Los errores **`ERR_SSL_PROTOCOL_ERROR`** en `/assets/...` suelen aparecer si el navegador intenta **`https://`** contra un servidor que solo habla **HTTP**. El build de Vite usa **`base: './'`** (rutas relativas) para que CSS/JS pidan el mismo esquema que la página (`http://` si entras por HTTP).

**Si sigue fallando:** el servidor ahora envía **`Origin-Agent-Cluster: ?0`** y el `index.html` del SPA va **sin caché** (`no-store`) para que no quede un HTML viejo con rutas erróneas. Tras desplegar, haz **recarga forzada** (Ctrl+Shift+R) o borra **datos del sitio** para esa IP (Configuración → Privacidad → solo ese origen) para limpiar el aviso de cluster y cualquier intento previo de **HTTPS**. Prueba incógnito o desactiva **“Usar siempre conexiones seguras”** en Chrome. Entra con **`http://IP:3000`** explícito.

Si los errores muestran aún **`https://.../assets/`**, el navegador sigue usando una **versión antigua** del `index.html` en caché o Chrome intenta HTTPS primero: borra caché del sitio y vuelve a construir la imagen (`docker compose build --no-cache app`).

El aviso de **origen no fiable** con COOP es coherente con HTTP no cifrado; la solución estable es servir la app con **HTTPS** (proxy + certificado).

### 3. Comprobar

- Aplicación (SPA React): [http://localhost:3000](http://localhost:3000)  
- Login en hash: `http://localhost:3000/#/login`  
- Credenciales por defecto (si no cambiaste `ADMIN_*` / seed): `admin@zgroup.pe` / `ZGroup2025!` y `comercial@zgroup.pe` / `ZGroup2025!`  
- API health: [http://localhost:3000/api/health](http://localhost:3000/api/health)  
- PostgreSQL expuesto en el host: `localhost:5433` por defecto (usuario `zgroup_user`, base `zgroup_cotizaciones`) — variable `POSTGRES_HOST_PORT` en compose si necesitas otro puerto  
- Redis expuesto en el host: `localhost:6382` por defecto — variable `REDIS_HOST_PORT` en compose  
- MinIO API S3 en el host: `localhost:9010` y consola web: [http://localhost:9011](http://localhost:9011) por defecto — variables `MINIO_API_HOST_PORT` / `MINIO_CONSOLE_HOST_PORT` en compose si necesitas otros puertos (evita choque con otro servicio en `:9000`) (usuario/clave por defecto `minioadmin` / `minioadmin` si no defines `MINIO_*`)

### 4. Comandos útiles (Docker)

| Comando | Descripción |
|---------|-------------|
| `docker compose logs -f app` | Logs del servidor Node |
| `docker compose exec app node server/db/seed.js` | Volver a ejecutar seed (idempotente) |
| `docker compose down` | Parar y eliminar contenedores (los volúmenes de datos persisten) |
| `docker compose down -v` | Parar y **borrar** volúmenes (BD vacía en el próximo `up`) |

### Error: `password authentication failed for user "zgroup_user"` y `zgroup_app exited with code 1`

**Qué significa:** Node intenta abrir sesión en PostgreSQL con `DB_PASSWORD`, pero el servidor Postgres rechaza esa clave (código `28P01`).

**Causa habitual:** el volumen **`postgres_data` ya se creó antes** con otra contraseña. Postgres solo aplica `POSTGRES_PASSWORD` en la **primera** inicialización de la carpeta de datos; si luego cambias `DB_PASSWORD` en `.env`, la app usa la nueva clave pero la BD sigue con la antigua.

**Cómo corregir (elige una):**

1. **Misma contraseña que cuando creaste el volumen**  
   Pon en `.env` el mismo `DB_PASSWORD` que usaste cuando levantaste Postgres por primera vez. Reinicia: `docker compose up -d`.

2. **Empezar de cero con la contraseña nueva** (borra datos de Postgres)  
   ```bash
   docker compose down -v
   docker compose up -d
   ```  
   Vuelve a aplicar el seed si hace falta. **`-v`** elimina el volumen `postgres_data` (y los demás volúmenes nombrados en compose).

3. **Cambiar la clave en Postgres sin borrar el volumen** (si recuerdas la contraseña antigua)  
   Conéctate con `psql` usando la contraseña que sí funciona y ejecuta:  
   `ALTER USER zgroup_user WITH PASSWORD 'tu_nueva_clave';`  
   Luego usa esa misma en `DB_PASSWORD` en `.env`.

**Importante:** `app` y `postgres` deben compartir **exactamente** el mismo `DB_PASSWORD` (Compose ya usa `${DB_PASSWORD:-zgroup_dev_password}` en ambos servicios). Si no defines `.env`, ambos usan el valor por defecto; el fallo aparece cuando el volumen quedó con una clave distinta a la que tienes ahora en `.env`.

### 5. Desarrollo con código montado desde el host

En `docker-compose.yml` hay un bloque comentado bajo el servicio `app`. Si descomentas:

```yaml
volumes:
  - ./:/app
```

tendrás el código del host dentro del contenedor. En ese caso **instala dependencias en el host** antes del primer arranque (`npm install`), porque el montaje sustituye `/app` del contenedor (incluido `node_modules` de la imagen).

El montaje **también sustituye `client/dist`**: la imagen de producción incluye el SPA compilado; con volumen, debes ejecutar **`npm run build`** en el host cuando cambies el frontend, o trabajar con **`npm run dev`** en el host (Vite en **:5173**) y apuntar el proxy al API en el host/puerto expuesto, sin depender del `dist` dentro del contenedor.

**Imagen de producción:** el `Dockerfile` es multi-etapa: en la construcción se ejecuta `npm run build` (Vite → `client/dist`); la imagen final solo copia `server/`, `client/dist` y `node_modules` de producción (ver `.dockerignore` para el contexto de build).

---

## Puesta en marcha sin Docker (Sprint 0)

### 1. Clonar y dependencias

```bash
cd coti_zgroup
npm install
```

### 2. Base de datos

Crea usuario y base (ejemplo con `psql` como superusuario):

```sql
CREATE USER zgroup_user WITH PASSWORD 'tu_password_seguro';
CREATE DATABASE zgroup_cotizaciones OWNER zgroup_user;
```

Opcional: `GRANT ALL PRIVILEGES ON DATABASE zgroup_cotizaciones TO zgroup_user;`

### 3. Variables de entorno

```bash
cp .env.example .env
```

Edita `.env` y define al menos:

- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`
- `JWT_ACCESS_SECRET` y `JWT_REFRESH_SECRET` (cadenas largas y aleatorias en producción)
- `FRONTEND_URL=http://localhost:3000` (o el puerto que uses)
- `COOKIE_SECURE=false` en local; `true` solo con HTTPS

### 4. Schema y datos iniciales

Al arrancar el servidor se ejecuta **`initSchema()`**, que aplica `server/db/schema.sql`.

Si es la primera vez, ejecuta:

```bash
npm run seed
```

Esto crea:

- Usuario **admin** (por defecto `admin@zgroup.pe` / `ZGroup2025!`) y **comercial** demo (`comercial@zgroup.pe` / `ZGroup2025!`)
- Categorías e ítems de catálogo (55 ítems), alineados con el plan Sprint 2+

Puedes sobrescribir credenciales del admin con `ADMIN_EMAIL` y `ADMIN_PASSWORD` en `.env` antes del seed.

### 5. Servidor

```bash
npm run dev
```

Abre `http://localhost:3000` (o el puerto en `PORT`).

**Producción:**

```bash
npm start
```

## Pruebas (Sprint 0)

Requieren **PostgreSQL accesible**, `.env` configurado y **seed ejecutado** al menos una vez.

**Con la base levantada solo con Docker** (Postgres en el host `localhost:5433` por defecto), puedes ejecutar la suite **en el host** apuntando al mismo puerto:

```bash
cp .env.example .env
# DB_HOST=localhost, DB_PORT=5433, DB_PASSWORD igual que en docker-compose (p. ej. zgroup_dev_password)
# y los mismos JWT_* que use el contenedor si quieres consistencia
npm install
npm run seed
npm test
```

**Sin Docker**, con Postgres local:

```bash
npm run seed   # si aún no hay usuarios demo
npm test
```

Las pruebas en `tests/sprint0/sprint0.test.js` cubren: health, `/api/auth/login` (validación, credenciales incorrectas, éxito), `/api/auth/refresh` sin cookie, `/api/users` sin token, **403** para COMERCIAL en listado de usuarios, **200** para ADMIN, y logout en sesión con cookie.

En `NODE_ENV=test` el rate limit de login está desactivado para no interferir con la suite.

## Comandos útiles

| Comando | Descripción |
|---------|-------------|
| `docker compose up -d` | Levantar stack (ver sección Docker) |
| `docker compose build` | Reconstruir imagen `app` |
| `npm run dev` | API (nodemon) + Vite en :5173 |
| `npm run dev:api` | Solo Express :3000 |
| `npm run dev:client` | Solo Vite :5173 |
| `npm run build` | Compila React → `client/dist` |
| `npm start` | Express + SPA (tras `build`, `NODE_ENV=production`) |
| `npm run seed` | Poblar BD (admin, comercial, catálogo) |
| `npm test` | Vitest — tests Sprint 0 |
| `npm run test:watch` | Vitest en modo watch |

## Mapa del repositorio (Sprint 0)

| Ruta | Rol |
|------|-----|
| `server/index.js` | Arranque: `initSchema + listen` |
| `server/app.js` | Aplicación Express (rutas, estáticos, errores) |
| `server/config/db.js` | Pool PostgreSQL y `initSchema` |
| `server/db/schema.sql` | DDL completo (usuarios, empleados, catálogo, proyectos futuros, etc.) |
| `server/db/seed.js` | Datos iniciales |
| `server/routes/auth.js` | Login, refresh, logout, `/me` |
| `server/routes/users.js` | CRUD usuarios (ADMIN) |
| `server/middleware/auth.js` | `requireAuth`, `requireRole`, JWT |
| `client/` | React + Vite (`LoginPage`, `AppShell`, estilos) |
| `client/src/lib/api.js` | Fetch con refresh de token |
| `client/src/context/AuthContext.jsx` | Sesión y logout |
| `vite.config.mjs` | Build y proxy `/api` → `:3000` en desarrollo |
| `zgroup-cotizaciones-v10-final.html` | Referencia UI + finanzas (no es el servidor) |

## Roadmap por sprint (`SPRINT_PLAN.md`)

Resumen de lo que falta para **cumplir el plan completo** manteniendo la UI y el motor financiero de referencia:

| Sprint | Objetivo | Notas para ejecución futura |
|--------|----------|-----------------------------|
| **0** | Fundación, auth, roles, shell React | `npm run dev` (Vite :5173) + `npm test` + QA login/logout |
| **1** | Empleados, clientes, proyectos, auditoría | Rutas API + vistas `#/employees`, `#/clients`, `#/projects` |
| **2** | Catálogo administrable (ADMIN) | CRUD categorías/ítems; Redis/cache opcional según plan |
| **3** | Presupuesto por proyecto | `project_items`, paneles catálogo + tabla ítems |
| **4** | M1–M4 financieros | **`shared/finance-engine.js`** puro + tests; parámetros JSONB + UI como el HTML |
| **5** | Planos (S3/MinIO) | Upload, versiones, permisos VIEWER |
| **6** | PDF + panel gerencial M5 | Cola Bull/Puppeteer según plan |
| **7** | E2E, Docker, hardening, deploy | Compose, SSL, health, manual de usuario |

**Dependencias:** los sprints 3–4 dependen de 0–2; el motor financiero debe **regresar igual al HTML** mediante tests (objetivo ≥95% en engine, según plan).

## Checklist manual Sprint 0

- [ ] Login correcto → entra al workspace (`#/dashboard`) según rol.
- [ ] Login incorrecto → mensaje tipo “Credenciales incorrectas”.
- [ ] Tras expiración de access token, el cliente puede refrescar vía `api.js` (cookie + `/api/auth/refresh`).
- [ ] Logout limpia sesión y vuelve a login.
- [ ] Usuario COMERCIAL no puede listar `/api/users` (403).
- [ ] Rate limit en login: 5 intentos / 15 min por IP en **no** test (probar con contraseñas erróneas repetidas).

## Próximo paso (Sprint 1)

Implementar rutas y vistas de empleados, clientes y proyectos según `SPRINT_PLAN.md`, reutilizando patrones de `users.js` y el shell React (`AppShell`) sin romper la paleta ni la navegación por hash.

---

*Plan detallado: [`SPRINT_PLAN.md`](./SPRINT_PLAN.md). Análisis de negocio: [`ZGROUP_ANALYSIS.md`](./ZGROUP_ANALYSIS.md).*
