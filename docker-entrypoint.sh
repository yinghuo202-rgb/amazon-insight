#!/bin/sh
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${APP_ENV:=production}"
: "${AUTH_SESSION_TTL_DAYS:=14}"

if [ "$APP_ENV" = "production" ] && [ -z "${SECRET_KEY:-}" ]; then
  echo "SECRET_KEY is required when APP_ENV=production" >&2
  exit 1
fi

if [ "${DATABASE_MIGRATE_ON_START:-true}" = "true" ]; then
  ./node_modules/.bin/prisma db push --skip-generate
fi

exec "$@"
