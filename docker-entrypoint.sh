#!/bin/sh
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${APP_ENV:=production}"
: "${AUTH_SESSION_TTL_DAYS:=14}"

mkdir -p /data/runtime/reports /data/uploads /data/snapshots
if [ -d /data/imported-reports ] && ! find /data/runtime/reports -maxdepth 1 -name '*.json' -print -quit | grep -q .; then
  echo "Seeding runtime reports from /data/imported-reports"
  cp -p /data/imported-reports/*.json /data/runtime/reports/ 2>/dev/null || true
fi

if [ ! -f /data/runtime/db/operations.sqlite3 ]; then
  echo "Initializing store operations database"
  /opt/store-ops-venv/bin/python -m store_ops --config /opt/store-ops/config/project.json init >/dev/null
fi

if [ "$APP_ENV" = "production" ] && [ -z "${SECRET_KEY:-}" ]; then
  echo "SECRET_KEY is required when APP_ENV=production" >&2
  exit 1
fi

if [ "${DATABASE_MIGRATE_ON_START:-true}" = "true" ]; then
  /opt/prisma-cli/node_modules/.bin/prisma db push --schema /app/prisma/schema.prisma --skip-generate
fi

exec "$@"
