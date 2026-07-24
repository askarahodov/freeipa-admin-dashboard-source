#!/usr/bin/env bash
set -u

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="${LOCAL_TEST_ENV_FILE:-.env.test}"
COMPOSE_FILE="${LOCAL_TEST_COMPOSE_FILE:-compose.test.yaml}"
ARTIFACT_ROOT="${LOCAL_TEST_ARTIFACT_DIR:-artifacts/local-integration}"
mkdir -p "$ARTIFACT_ROOT"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Test environment file is missing: $ENV_FILE" >&2
  echo "Create it with: cp .env.test.example .env.test" >&2
  exit 2
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required" >&2
  exit 2
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "docker compose plugin is required" >&2
  exit 2
fi

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

cleanup() {
  compose logs --no-color >"$ARTIFACT_ROOT/compose.log" 2>&1 || true
  if [[ "${LOCAL_TEST_KEEP_RUNNING:-false}" != "true" ]]; then
    compose down --remove-orphans >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

compose up -d --build

base_url="${LOCAL_TEST_BASE_URL:-http://127.0.0.1:3001}"
ready=false
for _ in $(seq 1 60); do
  if curl --fail --silent --show-error --max-time 3 "$base_url/api/integrations/health" >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 2
done

if [[ "$ready" != "true" ]]; then
  echo "Dashboard did not become healthy at $base_url" >&2
  compose ps >&2 || true
  exit 1
fi

LOCAL_TEST_ENV_FILE="$ENV_FILE" node scripts/local-integration-smoke.mjs
