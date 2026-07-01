# syntax=docker/dockerfile:1.7
# business-dashboard API — Fastify + Prisma + Postgres.
# bookworm-slim (glibc) avoids Prisma-on-musl engine pitfalls.

FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY . .
# `npm run build` runs `prisma generate && tsc`
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
# Full node_modules carried over: `prisma migrate deploy` needs the Prisma CLI.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./package.json
# Migration baseline helper (run by the entrypoint before `migrate deploy`).
COPY --from=build /app/scripts/db-baseline.mjs ./scripts/db-baseline.mjs
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh
EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
