import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ci = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
const e2e = readFileSync(new URL("../../.github/workflows/e2e-auth.yml", import.meta.url), "utf8");
const runner = readFileSync(new URL("../../scripts/run-auth-e2e.sh", import.meta.url), "utf8");

test("runtime and recovery use isolated BuildKit caches with trusted-main-only persistence", () => {
  assert.match(ci, /path:\s*\/tmp\/runtime-buildkit/u);
  assert.match(ci, /path:\s*\/tmp\/recovery-buildkit/u);
  assert.match(ci, /runtime-buildkit-\$\{\{ runner\.os \}\}-\$\{\{ hashFiles\('Dockerfile', 'package-lock\.json'\) \}\}-\$\{\{ github\.sha \}\}/u);
  assert.match(ci, /recovery-buildkit-\$\{\{ runner\.os \}\}-\$\{\{ hashFiles\('Dockerfile', 'package-lock\.json'\) \}\}-\$\{\{ github\.sha \}\}/u);
  assert.match(ci, /docker buildx build --progress=plain --load --target runtime --tag portal-security-scan/u);
  assert.match(ci, /docker buildx build --progress=plain --load --target recovery --tag portal-recovery-ci/u);
  assert.match(ci, /Save runtime BuildKit cache from trusted main[\s\S]{0,180}github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/u);
  assert.match(ci, /Save recovery BuildKit cache from trusted main[\s\S]{0,180}github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/u);
  assert.doesNotMatch(ci, /actions\/cache@v4/u);
});

test("E2E prebuilds dashboard and Playwright from separate trusted-main caches", () => {
  assert.match(e2e, /path:\s*\/tmp\/e2e-dashboard-buildkit/u);
  assert.match(e2e, /path:\s*\/tmp\/e2e-playwright-buildkit/u);
  assert.match(e2e, /docker buildx build --load --tag freeipa-admin-dashboard:e2e/u);
  assert.match(e2e, /docker buildx build --load --file e2e\/Dockerfile --tag freeipa-admin-dashboard-playwright:e2e/u);
  assert.match(e2e, /Save dashboard BuildKit cache from trusted main[\s\S]{0,220}github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/u);
  assert.match(e2e, /Save Playwright BuildKit cache from trusted main[\s\S]{0,220}github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/u);
});

test("prebuilt E2E mode fails closed and local default still builds", () => {
  assert.match(runner, /E2E_PREBUILT_IMAGES="\$\{E2E_PREBUILT_IMAGES:-false\}"/u);
  assert.match(runner, /docker image inspect freeipa-admin-dashboard:e2e/u);
  assert.match(runner, /docker image inspect freeipa-admin-dashboard-playwright:e2e/u);
  assert.match(runner, /compose up -d --no-build dashboard/u);
  assert.match(runner, /else\n  compose up -d --build dashboard/u);
  assert.match(runner, /if \[\[ "\$E2E_PREBUILT_IMAGES" != "true" \]\]; then\n  compose build playwright/u);
  assert.match(e2e, /E2E_PREBUILT_IMAGES:\s*"true"/u);
});
