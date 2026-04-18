#!/bin/sh
# Ejecutado al arrancar la imagen de producción (Dockerfile CMD).
# No puede correr en `docker build`: PostgreSQL no existe aún; Compose espera DB sana antes de levantar app.
set -e
echo "[docker-entrypoint] Seed idempotente: schema, usuarios demo, catálogo base + ítems HTML v12 (EST/FRI/ACC/PTA)..."
node server/db/seed.js
echo "[docker-entrypoint] Iniciando API..."
exec node server/index.js
