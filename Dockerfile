# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS base
RUN corepack enable && apk add --no-cache wget openssl libc6-compat
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml .npmrc ./
# --ignore-scripts: bypassea el chequeo de "approved builds" de pnpm 11.
# Luego pnpm rebuild fuerza el postinstall de los nativos que SÍ necesitamos.
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts && \
    pnpm rebuild esbuild prisma @prisma/engines @prisma/client unrs-resolver protobufjs

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm prisma generate && pnpm build

FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3001
ENV HOME=/home/app
ENV XDG_CACHE_HOME=/home/app/.cache

# Crear user PRIMERO para que los COPY --chown asignen ownership al copiar
# (evita un chown -R de ~200k archivos que tarda minutos).
RUN addgroup -S app && adduser -S -h /home/app -G app app && \
    mkdir -p /home/app/.cache && \
    chown -R app:app /home/app

COPY --chown=app:app --from=builder /app/node_modules ./node_modules
COPY --chown=app:app --from=builder /app/dist ./dist
COPY --chown=app:app package.json pnpm-lock.yaml .npmrc prisma.config.ts ./
COPY --chown=app:app prisma ./prisma

USER app

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/health || exit 1

# Invoca prisma directo desde node_modules (sin pnpm/corepack en runtime)
CMD ["sh", "-c", "node ./node_modules/prisma/build/index.js migrate deploy && if [ \"$RUN_SEED\" = \"1\" ]; then echo '>> Running seed...'; node ./node_modules/prisma/build/index.js db seed || echo '>> Seed failed (ignored)'; fi && node dist/main.js"]
