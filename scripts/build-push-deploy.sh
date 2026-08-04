#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

IMAGE_NAME="${IMAGE_NAME:-local-logbook-app}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
PUSH_IMAGE="${PUSH_IMAGE:-false}"
DEPLOY_AFTER_BUILD="${DEPLOY_AFTER_BUILD:-true}"
PUSH_LATEST="${PUSH_LATEST:-true}"

if [[ "$IMAGE_NAME" != local-* ]]; then
  echo "Error: IMAGE_NAME must start with 'local-' (current: $IMAGE_NAME)" >&2
  exit 1
fi

echo "==> Building image: ${IMAGE_NAME}:${IMAGE_TAG}"
(
  cd "$ROOT_DIR"
  docker compose build app
)

if [[ "$PUSH_IMAGE" == "true" ]]; then
  echo "==> Pushing image: ${IMAGE_NAME}:${IMAGE_TAG}"
  docker push "${IMAGE_NAME}:${IMAGE_TAG}"

  if [[ "$PUSH_LATEST" == "true" && "$IMAGE_TAG" != "latest" ]]; then
    echo "==> Tagging and pushing latest"
    docker tag "${IMAGE_NAME}:${IMAGE_TAG}" "${IMAGE_NAME}:latest"
    docker push "${IMAGE_NAME}:latest"
  fi
else
  echo "==> Skipping push (PUSH_IMAGE=${PUSH_IMAGE})"
fi

if [[ "$DEPLOY_AFTER_BUILD" == "true" ]]; then
  echo "==> Deploying container"
  (
    cd "$ROOT_DIR"
    docker compose up -d --force-recreate app
  )
else
  echo "==> Skipping deploy (DEPLOY_AFTER_BUILD=${DEPLOY_AFTER_BUILD})"
fi

echo "==> Done"
