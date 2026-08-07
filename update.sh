#!/bin/sh
set -eu

TAG="${1:-${IMAGE_TAG:-latest}}"
export IMAGE_TAG="$TAG"

DATA_DIR="${DATA_PATH:-./data/app}"
BACKUP_DIR="${BACKUP_PATH:-./backups}"
docker compose stop app >/dev/null 2>&1 || true
if [ "${BACKUP_BEFORE_UPDATE:-true}" = "true" ] && [ -f "$DATA_DIR/selection.db" ]; then
  mkdir -p "$BACKUP_DIR"
  cp "$DATA_DIR/selection.db" "$BACKUP_DIR/selection.db.$(date +%Y%m%d-%H%M%S)"
fi

docker compose pull app
docker compose up -d --no-deps app
docker image prune -f
docker compose ps
