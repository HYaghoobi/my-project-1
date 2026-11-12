#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
PORT="${PORT:-8000}"
IMAGE_NAME="pm-app"
CONTAINER_NAME="pm-app"

docker build -t "$IMAGE_NAME" -f "$ROOT_DIR/Dockerfile" "$ROOT_DIR"

if docker container inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
  docker rm -f "$CONTAINER_NAME" >/dev/null
fi

if [ -f "$ROOT_DIR/.env" ]; then
  docker run --detach --name "$CONTAINER_NAME" \
    --publish "$PORT:8000" \
    --volume pm-data:/app/data \
    --env-file "$ROOT_DIR/.env" \
    --restart unless-stopped \
    "$IMAGE_NAME"
else
  docker run --detach --name "$CONTAINER_NAME" \
    --publish "$PORT:8000" \
    --volume pm-data:/app/data \
    --restart unless-stopped \
    "$IMAGE_NAME"
fi

printf 'Project Manager is available at http://localhost:%s\n' "$PORT"
