# OmniMark — production image (multi-tenant Next.js standalone + Prisma)
# Build context: repo root. Run via docker-compose.yml (app + postgres).

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund

FROM node:24-alpine AS build
WORKDIR /app
# prisma.config.ts resolves DATABASE_URL at load time (no DB connection needed
# for generate/build; the real URL is injected at runtime by compose).
ENV NEXT_TELEMETRY_DISABLED=1 \
    DATABASE_URL=postgresql://build:build@localhost:5432/build \
    APP_URL=http://localhost:3000 \
    OMNI_ENCRYPTION_KEYS='{"1":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="}' \
    OMNI_TOKEN_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
    CRON_SECRET=buildplaceholder0000000000000000000000
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

FROM node:24-alpine AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/.next/standalone ./
# Full node_modules: standalone tracing omits devDependencies, but the boot
# command runs `prisma migrate deploy` (needs the CLI) and the server needs
# its traced deps — one complete tree keeps both honest.
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
COPY --from=build --chown=app:app /app/prisma ./prisma
COPY --from=build --chown=app:app /app/prisma.config.ts ./
# src tree for the seed workflow (`npm run db:seed` = tsx prisma/seed.ts) —
# the server itself runs entirely from the traced standalone output.
COPY --from=build --chown=app:app /app/src ./src
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/api/v1/health | grep -q '"status":"ok"' || exit 1
# First boot: migrate, then serve (seed explicitly: docker compose exec app npm run db:seed)
CMD ["sh", "-c", "npx prisma migrate deploy && node server.js"]
