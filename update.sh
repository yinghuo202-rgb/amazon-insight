#!/bin/sh
set -eu

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

TAG="${1:-${IMAGE_TAG:-latest}}"
export IMAGE_TAG="$TAG"

DATA_DIR="${DATA_PATH:-./data/app}"
RUNTIME_DIR="${RUNTIME_PATH:-./data/runtime}"
BACKUP_DIR="${BACKUP_PATH:-./backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"

# Pull first so a transient registry or network failure never leaves the app stopped.
docker compose pull app
docker compose stop app >/dev/null 2>&1 || true

if [ "${BACKUP_BEFORE_UPDATE:-true}" = "true" ]; then
  mkdir -p "$BACKUP_DIR"
  for db_path in "$DATA_DIR/selection.db" "$RUNTIME_DIR/db/operations.sqlite3"; do
    if [ -f "$db_path" ]; then
      base="$(basename "$db_path")"
      cp "$db_path" "$BACKUP_DIR/$base.$STAMP"
      [ -f "$db_path-wal" ] && cp "$db_path-wal" "$BACKUP_DIR/$base.$STAMP-wal"
      [ -f "$db_path-shm" ] && cp "$db_path-shm" "$BACKUP_DIR/$base.$STAMP-shm"
    fi
  done
fi

docker compose up -d --no-deps app
docker image prune -f
docker compose ps
