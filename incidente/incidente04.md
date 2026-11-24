# Incidente 04 — Docker Hub ya no entrega la imagen de MinIO

**Fecha:** 2026-11-24  
**Reportado por:** al levantar el stack con `docker compose up`  
**Rol afectado:** quien despliega o recrea contenedores (local y producción)

## Observación

`docker compose up` se detiene antes de arrancar la aplicación:

```text
Image minio/minio:latest
Error pull access denied for minio/minio, repository does not exist or may require 'docker login'

Image postgres:15-alpine Interrupted
Error response from daemon: No such image: postgres:15-alpine
```

`docker login` no corrige el primer mensaje. Postgres y Redis no están rotos: Compose cancela las descargas en paralelo cuando una imagen falla, y por eso `postgres:15-alpine` queda a medias.

## Causa

MinIO retiró las imágenes comunitarias `minio/minio` y `minio/mc` de Docker Hub. El daemon responde “repository does not exist or may require docker login” aunque el repositorio ya no sea público. `quay.io/minio/minio` tampoco se puede bajar sin cuenta: desde septiembre de 2026 ese repositorio responde 401.

El compose de este proyecto (el mismo de local y de producción) pedía `minio/minio:latest` para guardar los planos técnicos. La aplicación no usa un cliente propio de MinIO: habla la API S3 (`server/config/s3.js`, `server/services/storage.service.js`) contra el bucket `zgroup-plans`.

En un servidor que ya tenía la imagen en caché, los contenedores que estaban corriendo siguen vivos. Un host nuevo, o un `docker compose pull`, falla igual.

## Qué se hizo

1. El servicio sigue llamándose `minio` y el volumen sigue siendo `minio_data`, montado en `/data`. Cambiar el nombre del volumen montaría un disco vacío y los planos dejarían de verse.
2. La imagen pasa a `pgsty/silo:RELEASE.2026-11-12T00-00-00Z`, con el digest del índice multi-arquitectura `sha256:c20d112390b9a9ce8c11b8af95ad35bcaa62f4759663c09c936cd8d2b511f329`. Es un fork compatible: mismo formato en disco, mismas variables `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`, misma API S3 y la misma consola en el puerto 9001.
3. El comando no cambia: `server /data --console-address ":9001"`.
4. El healthcheck deja de usar `curl` y usa `silo healthcheck ready`, que viene en la imagen.
5. No se tocó el código de la aplicación, Postgres ni Redis.

## Datos

| Qué | Dónde | Efecto de este cambio |
| --- | --- | --- |
| Cotizaciones, clientes, kits | volumen `postgres_data` | Ninguno |
| Sesiones / colas | volumen `redis_data` | Ninguno |
| Archivos de planos | volumen `minio_data` | Se reutiliza. Silo lee el directorio que escribió MinIO |
| Ficha del plano (proyecto, nombre, clave S3) | Postgres | Ninguno. Si el archivo faltara, la ficha seguiría y la descarga fallaría |

Las claves del volumen ya creado viven dentro de ese disco. Hay que conservar el `MINIO_ROOT_USER` y el `MINIO_ROOT_PASSWORD` con los que se inicializó. Cambiarlos en `.env` no reescribe un volumen existente y el contenedor puede arrancar con otras credenciales de las que espera la app.

`docker compose down -v` borra `minio_data`, `postgres_data` y `redis_data`. No usarlo para aplicar este cambio.

En la máquina donde el pull de `minio/minio` nunca terminó no hay planos locales que migrar. En producción, si el contenedor llegó a correr, los archivos siguen en el volumen aunque la imagen vieja ya no se pueda volver a descargar.

## Cómo aplicarlo

En el servidor, con el mismo `.env` y sin borrar volúmenes:

```bash
docker compose up -d --no-deps minio
docker compose logs --tail=200 minio
docker compose exec -T minio silo healthcheck ready
docker compose up -d
```

Comprobar un plano que ya existía (abrir o descargar desde el proyecto) y subir uno nuevo. La consola sigue en el puerto del host `MINIO_CONSOLE_HOST_PORT` (9011 por defecto) y la API en `MINIO_API_HOST_PORT` (9010).

## Cómo revisarlo después

- Imagen y digest: servicio `minio` en `docker-compose.yml`.
- Variables que no deben cambiar en un volumen con datos: `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `S3_BUCKET=zgroup-plans`.
- Si más adelante se publicara otra etiqueta `RELEASE.*`, actualizar imagen y digest juntos. No volver a `minio/minio` ni a `latest`.
- Pasar a otro motor (S3 de AWS, Garage, disco local) sí exige copiar el bucket antes. Este incidente no hace esa migración.
