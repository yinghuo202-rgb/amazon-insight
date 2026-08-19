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

# Older releases only parsed Sheet1 and left a five-row research snapshot in
# the persistent volume. If the source workbook is available, transparently
# rebuild that legacy snapshot during upgrade; online overrides are applied by
# the web layer after the report is loaded.
research_source="/data/sources/新品调研表8.13.xlsx"
research_report="/data/runtime/reports/new_product_research.json"
if [ -f "$research_source" ]; then
  research_candidate_count=$(/opt/store-ops-venv/bin/python -c 'import json,sys; p=sys.argv[1];
try:
 print(int(json.load(open(p, encoding="utf-8")).get("summary", {}).get("candidateCount", 0)))
except Exception:
 print(0)' "$research_report" 2>/dev/null || echo 0)
  case "$research_candidate_count" in
    ''|*[!0-9]*) research_candidate_count=0 ;;
  esac
  if [ "$research_candidate_count" -le 5 ]; then
    echo "Rebuilding legacy new-product research report"
    /opt/store-ops-venv/bin/python -m store_ops --config /opt/store-ops/config/project.json build-new-product-research >/dev/null
  fi
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
