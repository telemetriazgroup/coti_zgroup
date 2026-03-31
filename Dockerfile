# ─── Stage 1: dependencias + build del SPA React (Vite → client/dist) ───
FROM node:20-alpine AS builder

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build
RUN npm prune --omit=dev

# ─── Stage 2: solo runtime (Express + client/dist + node_modules prod) ───
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
# Puppeteer / Chromium (PDF) — el binario real en Alpine suele ser /usr/lib/chromium/chromium
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont font-noto-emoji \
 && if [ -x /usr/lib/chromium/chromium ]; then \
      ln -sf /usr/lib/chromium/chromium /usr/bin/chromium; \
      ln -sf /usr/lib/chromium/chromium /usr/bin/chromium-browser; \
    fi
ENV PUPPETEER_EXECUTABLE_PATH=/usr/lib/chromium/chromium

RUN addgroup -S zgroup && adduser -S zgroup -G zgroup

COPY --from=builder --chown=zgroup:zgroup /app/package.json ./package.json
COPY --from=builder --chown=zgroup:zgroup /app/node_modules ./node_modules
COPY --from=builder --chown=zgroup:zgroup /app/server ./server
COPY --from=builder --chown=zgroup:zgroup /app/shared ./shared
COPY --from=builder --chown=zgroup:zgroup /app/client/dist ./client/dist

USER zgroup

EXPOSE 3000

# Seed idempotente + API que sirve /api y el SPA desde client/dist
CMD ["sh", "-c", "node server/db/seed.js && node server/index.js"]
