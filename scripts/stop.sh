#!/usr/bin/env sh
set -eu

CONTAINER_NAME="pm-app"

if ! docker container inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
  printf 'Container %s does not exist.\n' "$CONTAINER_NAME"
  exit 0
fi

if [ "$(docker inspect --format '{{.State.Running}}' "$CONTAINER_NAME")" = "true" ]; then
  docker stop "$CONTAINER_NAME"
else
  printf 'Container %s is already stopped.\n' "$CONTAINER_NAME"
fi
