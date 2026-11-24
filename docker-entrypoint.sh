#!/bin/sh
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${APP_ENV:=production}"
: "${AUTH_SESSION_TTL_DAYS:=14}"

if [ "$APP_ENV" = "production" ] && [ -z "${SECRET_KEY:-}" ]; then
  echo "SECRET_KEY is required when APP_ENV=production" >&2
  exit 1
fi

for dir in /data/app /data/runtime; do
  if [ -d "$dir" ] && [ ! -w "$dir" ]; then
    echo "Warning: $dir is not writable by $(id -u):$(id -g). Ensure NAS volume permissions allow uid 1000 (node)." >&2
  fi
done

if [ "${DATABASE_MIGRATE_ON_START:-true}" = "true" ]; then
  PRISMA_BIN="/opt/prisma-cli/node_modules/.bin/prisma"
  if [ ! -x "$PRISMA_BIN" ]; then
    PRISMA_BIN="./node_modules/.bin/prisma"
  fi
  if [ ! -x "$PRISMA_BIN" ]; then
    echo "Prisma CLI not found for schema migration." >&2
    exit 1
  fi
  "$PRISMA_BIN" db push --skip-generate
fi

exec "$@"
