FROM node:20-alpine

WORKDIR /app

# Instalar dependencias
COPY package*.json ./
RUN npm ci --only=production

# Copiar código fuente
COPY . .

# Crear usuario no-root
RUN addgroup -S zgroup && adduser -S zgroup -G zgroup
RUN chown -R zgroup:zgroup /app
USER zgroup

EXPOSE 3000

# Seed + start
CMD ["sh", "-c", "node server/db/seed.js && node server/index.js"]
