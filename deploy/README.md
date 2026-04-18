# Despliegue con Docker Compose (puerto 18080 + `/madurador` + `ztrack.app`)

Todo el stack (Node, PostgreSQL, Redis, MinIO) se ejecuta con **Docker Compose**. Apache delante hace SSL y proxy a `http://IP:18080/madurador/`.

---

## Requisitos

- Docker Engine + Docker Compose plugin (`docker compose`)
- Apache 2.4 con SSL y módulos: `proxy`, `proxy_http`, `headers`, `ssl`
- Puertos libres en el host (ajustables en `.env`): **18080** (app), **5433** (Postgres), **6382** (Redis), **9010/9011** (MinIO)

---

## Paso 1 — Código en el servidor

```bash
cd /opt   # o la ruta que uses
git clone <tu-repo> coti_zgroup
cd coti_zgroup
```

---

## Paso 2 — Archivo `.env` en la raíz del proyecto

```bash
cp deploy/docker-compose.env.example .env
nano .env
```

**Obligatorio revisar:**

| Variable | Ejemplo | Uso |
|----------|---------|-----|
| `APP_HOST_PORT` | `18080` | Puerto host → contenedor `app:3000` |
| `VITE_BASE_PATH` | `/madurador/` | **Build** del front (barra final) |
| `PUBLIC_BASE_PATH` | `/madurador` | **Runtime** Node (sin barra final) |
| `FRONTEND_URL` | `https://ztrack.app` | CORS / cookies |
| `COOKIE_SECURE` | `true` | HTTPS |
| `TRUST_PROXY` | `1` | Detrás de Apache |
| `ALLOWED_ORIGINS` | `http://TU_IP:18080` | Pruebas por IP sin dominio |
| `JWT_*` / `DB_PASSWORD` | valores fuertes | Producción |
| `S3_PUBLIC_ENDPOINT` | `http://TU_IP:9010` | Navegador descarga planos (mismo host/puerto que MinIO expuesto) |

`VITE_BASE_PATH` y `PUBLIC_BASE_PATH` deben describir **la misma subruta** (solo difiere la barra final en Vite).

---

## Paso 3 — Construir la imagen

La imagen ejecuta `npm run build` dentro del Dockerfile usando `VITE_BASE_PATH` del `.env`.

```bash
docker compose build --no-cache
```

Si cambias solo `VITE_BASE_PATH` o el código del front, vuelve a ejecutar **`build`** antes del **`up`**.

---

## Paso 4 — Levantar servicios

```bash
docker compose up -d
```

El contenedor `app` ejecuta `seed` y luego el servidor (ver `Dockerfile` `CMD`).

---

## Paso 5 — Comprobar

```bash
docker compose ps
docker compose logs -f app
```

Health (sustituye IP y puerto si cambiaste `APP_HOST_PORT`):

```text
http://161.132.53.51:18080/madurador/api/health
```

Debe devolver JSON con `"publicBasePath":"/madurador"` y `"status":"ok"`.

Login en navegador:

```text
http://161.132.53.51:18080/madurador/#/login
```

---

## Paso 6 — Apache (SSL) hacia Docker

El tráfico llega al **mismo puerto host** donde escucha el mapeo de `app` (p. ej. **18080**). En el `VirtualHost *:443` de `ztrack.app`:

```apache
ProxyPreserveHost On
ProxyRequests Off

ProxyPass        /madurador/ http://161.132.53.51:18080/madurador/
ProxyPassReverse /madurador/ http://161.132.53.51:18080/madurador/

RequestHeader set X-Forwarded-Proto "https"
RequestHeader set X-Forwarded-Port "443"
```

Ejemplo comentado: `deploy/apache-madurador-ztrack.conf.example`

```bash
sudo apache2ctl configtest
sudo systemctl reload apache2
```

**URL pública:**

```text
https://ztrack.app/madurador/#/login
https://ztrack.app/madurador/api/health
```

---

## Comandos útiles

| Acción | Comando |
|--------|---------|
| Ver logs | `docker compose logs -f app` |
| Reiniciar solo app | `docker compose restart app` |
| Parar todo | `docker compose down` |
| Parar y borrar volúmenes DB | `docker compose down -v` (¡borra datos!) |
| Reconstruir tras cambiar front | `docker compose build app && docker compose up -d` |

---

## Errores frecuentes

1. **Assets 404 bajo `/madurador`** — No reconstruiste la imagen con `VITE_BASE_PATH=/madurador/` o `PUBLIC_BASE_PATH` no coincide.
2. **Login / cookies** — `FRONTEND_URL` debe ser `https://ztrack.app`, `COOKIE_SECURE=true`, `TRUST_PROXY=1`, Apache envía `X-Forwarded-Proto: https`.
3. **CORS al abrir por IP** — Añade ese origen en `ALLOWED_ORIGINS`.
4. **Planos / MinIO** — `S3_PUBLIC_ENDPOINT` debe ser una URL que el **navegador** alcance (IP:9010 o dominio dedicado a MinIO), no `http://localhost:9010` desde un PC remoto.
5. **Postgres “password authentication failed”** — La clave en `.env` no coincide con el volumen ya creado: alinea `DB_PASSWORD` o elimina el volumen con cuidado (`down -v`).

---

## Archivos de referencia

| Archivo | Contenido |
|---------|-----------|
| `deploy/docker-compose.env.example` | Plantilla `.env` para Compose + `/madurador` |
| `deploy/apache-madurador-ztrack.conf.example` | Bloque Apache |
| `docker-compose.yml` | Servicios, puertos, build args |
| `Dockerfile` | Build Vite + runtime Node |
| `.env.example` (raíz) | Descripción de todas las variables |

Despliegue **sin** Docker (Node en el host): usar `deploy/env.madurador-18080.example` y `npm run build:madurador` manualmente.
