#!/bin/sh
set -e

# Apply committed migrations if any exist; otherwise create the schema directly
# (first boot before any migration has been committed).
if [ -d prisma/migrations ] && [ -n "$(ls -A prisma/migrations 2>/dev/null)" ]; then
  echo "[entrypoint] prisma migrate deploy..."
  npx prisma migrate deploy
else
  echo "[entrypoint] no migrations found — prisma db push..."
  npx prisma db push --skip-generate
fi

echo "[entrypoint] starting Fastify on :${PORT:-3000}..."
exec node dist/server.js
