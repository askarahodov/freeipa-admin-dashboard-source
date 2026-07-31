#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="${E2E_ENV_FILE:-.env.e2e}"
COMPOSE_FILE="${E2E_COMPOSE_FILE:-compose.e2e.yaml}"
ARTIFACT_ROOT="${E2E_ARTIFACT_DIR:-artifacts/e2e}"
BASE_URL="${E2E_BASE_URL:-http://127.0.0.1:3001}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "E2E environment file is missing: $ENV_FILE" >&2
  echo "Create it with: cp .env.e2e.example .env.e2e" >&2
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

mkdir -p "$ARTIFACT_ROOT/playwright-report" "$ARTIFACT_ROOT/test-results"

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

collect_startup_diagnostics() {
  {
    echo
    echo "=== dashboard startup diagnostics ==="
    echo "--- health response ---"
    curl --silent --show-error --include --max-time 5 "$BASE_URL/api/integrations/health" || true
  } >>"$ARTIFACT_ROOT/compose.log" 2>&1
}

cleanup() {
  compose logs --no-color >"$ARTIFACT_ROOT/compose.log" 2>&1 || true
  if [[ "${ready:-false}" != "true" ]]; then
    collect_startup_diagnostics || true
  fi
  if [[ "${E2E_KEEP_RUNNING:-false}" != "true" ]]; then
    compose down -v --remove-orphans >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

compose down -v --remove-orphans >/dev/null 2>&1 || true
compose up -d --build dashboard

ready=false
for _ in $(seq 1 90); do
  if curl --fail --silent --show-error --max-time 3 "$BASE_URL/api/integrations/health" >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 2
done

if [[ "$ready" != "true" ]]; then
  echo "Dashboard did not become healthy at $BASE_URL" >&2
  compose ps >&2 || true
  exit 1
fi

compose build playwright
compose run --rm playwright
