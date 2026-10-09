#!/usr/bin/env bash
# Disposable image verification only. Never attach existing NAS volumes here.
set -euo pipefail
image="${1:?image required}"
platform="${2:?platform required}"
case "$platform" in linux/amd64|linux/arm64) ;; *) exit 2 ;; esac
smoke_id="measureman-smoke-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}-${platform##*/}"
app="${smoke_id}-app"
worker="${smoke_id}-worker"
volume="${smoke_id}-data"
script_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
cleanup() {
  if [ "$?" -ne 0 ]; then
    docker logs --tail 100 "$app" 2>/dev/null || true
    docker logs --tail 100 "$worker" 2>/dev/null || true
  fi
  docker rm -f "$app" "$worker" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
}
# Refuse collisions so cleanup can only remove resources owned by this run.
for container in "$app" "$worker"; do
  if docker container inspect "$container" >/dev/null 2>&1; then echo "Smoke container already exists" >&2; exit 2; fi
done
if docker volume inspect "$volume" >/dev/null 2>&1; then echo "Smoke volume already exists" >&2; exit 2; fi
trap cleanup EXIT
docker pull --platform "$platform" "$image"
docker volume create "$volume" >/dev/null
secret="$(openssl rand -hex 32)"
# Reproduce the old web-only database: an existing file without job tables.
docker run --rm --platform "$platform" --mount "type=volume,src=$volume,dst=/data" \
  --entrypoint node "$image" -e 'const{DatabaseSync}=require("node:sqlite");const db=new DatabaseSync("/data/runtime/db/operations.sqlite3");db.exec("CREATE TABLE smoke_preserved(value TEXT); INSERT INTO smoke_preserved VALUES (\u0027keep\u0027)");db.close();'
docker run -d --platform "$platform" --name "$app" \
  --mount "type=volume,src=$volume,dst=/data" \
  -e "SECRET_KEY=$secret" -e APP_ENV=production -e AUTH_SECURE_COOKIE=false \
  -e NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000 \
  --health-interval=2s --health-start-period=2s --health-timeout=10s --health-retries=120 \
  "$image" >/dev/null
wait_healthy() {
  for ((attempt=0; attempt<120; attempt++)); do
    status="$(docker inspect --format '{{.State.Status}} {{.State.Health.Status}}' "$app")"
    if [ "$status" = 'running healthy' ]; then return; fi
    if [[ "$status" == exited* || "$status" == *unhealthy ]]; then break; fi
    sleep 2
  done
  echo "Image did not become healthy on $platform" >&2
  return 1
}
wait_healthy
docker exec -i "$app" node --input-type=module - fresh < "$script_dir/smoke-runtime.mjs"
docker run -d --platform "$platform" --name "$worker" \
  --mount "type=volume,src=$volume,dst=/data" -e "SECRET_KEY=$secret" \
  -e NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000 --no-healthcheck \
  --entrypoint node "$image" /app/worker/worker/data-worker.js >/dev/null
docker exec -i "$app" node --input-type=module - worker < "$script_dir/smoke-runtime.mjs"
docker restart "$app" >/dev/null
wait_healthy
docker exec -i "$app" node --input-type=module - resume < "$script_dir/smoke-runtime.mjs"
echo "NAS image checks passed: $platform"
