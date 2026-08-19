#!/bin/sh
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${APP_ENV:=production}"
: "${AUTH_SESSION_TTL_DAYS:=14}"

mkdir -p /data/runtime/reports /data/uploads /data/snapshots
if [ -d /data/imported-reports ]; then
  # A persistent runtime volume may already contain only part of the report
  # set. Seed each missing file independently so product data pages can be
  # restored without overwriting reports that were refreshed online.
  for source_report in /data/imported-reports/*.json; do
    [ -f "$source_report" ] || continue
    report_name=${source_report##*/}
    target_report="/data/runtime/reports/$report_name"
    if [ ! -f "$target_report" ]; then
      echo "Seeding missing runtime report: $report_name"
      cp -p "$source_report" "$target_report"
    fi
  done
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
