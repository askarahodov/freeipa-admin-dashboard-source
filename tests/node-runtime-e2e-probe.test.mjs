import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const launcher = readFileSync(new URL("../scripts/start-node-e2e-runtime.mjs", import.meta.url), "utf8");
const dockerfile = readFileSync(new URL("../e2e/Dockerfile.node-runtime", import.meta.url), "utf8");
const compose = readFileSync(new URL("../compose.e2e.node-probe.yaml", import.meta.url), "utf8");
const runner = readFileSync(new URL("../scripts/run-auth-e2e.sh", import.meta.url), "utf8");
const legacyCompose = readFileSync(new URL("../compose.e2e.yaml", import.meta.url), "utf8");

const requiredLauncherSymbols = [
  "createRuntimeApplication",
  "createRuntimeDatabase",
  "openNodeSqliteDriver",
  "configureSqliteRuntimeDatabase",
  "createD1SqliteAdapter",
  "ensurePortalSchema",
  "startNodeWorkerHost",
];

const probeSpecs = [
  "specs/auth.spec.mjs",
  "specs/rbac-user.spec.mjs",
  "specs/role-restrictions.spec.mjs",
  "specs/xyops-lifecycle.spec.mjs",
];

test("standalone Node E2E launcher composes canonical runtime primitives without Wrangler", () => {
  for (const symbol of requiredLauncherSymbols) {
    assert.match(launcher, new RegExp(`\\b${symbol}\\b`, "u"), `launcher must use ${symbol}`);
  }
  assert.doesNotMatch(launcher, /wrangler|miniflare/u);
  assert.match(launcher, /PORTAL_DATA_DIR[^\n]*\/data/u);
  assert.match(launcher, /PORTAL_DATABASE_PATH[^\n]*\/data\/portal\.sqlite/u);
});

test("diagnostic Docker runtime serves through the Node launcher and owns disposable SQLite data", () => {
  assert.match(dockerfile, /FROM\s+node:22-bookworm-slim/u);
  assert.match(dockerfile, /npm\s+ci/u);
  assert.match(dockerfile, /npm\s+run\s+build/u);
  assert.match(dockerfile, /USER\s+dashboard/u);
  assert.match(dockerfile, /CMD\s+\["node",\s*"--experimental-strip-types",\s*"scripts\/start-node-e2e-runtime\.mjs"\]/u);
  assert.doesNotMatch(dockerfile, /wrangler\s+dev|miniflare/u);

  assert.match(compose, /dockerfile:\s*e2e\/Dockerfile\.node-runtime/u);
  assert.match(compose, /PORTAL_DATA_DIR:\s*\/data/u);
  assert.match(compose, /PORTAL_DATABASE_PATH:\s*\/data\/portal\.sqlite/u);
  assert.match(compose, /dashboard-e2e-node-data:\/data/u);
});

test("probe runs the exact mutation-heavy browser subset and leaves the legacy compose topology intact", () => {
  for (const spec of probeSpecs) {
    assert.match(compose, new RegExp(spec.replaceAll(".", "\\."), "u"), `missing probe spec ${spec}`);
  }
  assert.equal((compose.match(/specs\/[\w.-]+\.spec\.mjs/gu) ?? []).length, probeSpecs.length);
  assert.match(runner, /COMPOSE_FILE="\$\{E2E_COMPOSE_FILE:-compose\.e2e\.node-probe\.yaml\}"/u);

  assert.match(legacyCompose, /volumes:\n\s+- dashboard-e2e-data:\/app\/\.wrangler/u);
  assert.doesNotMatch(legacyCompose, /Dockerfile\.node-runtime|dashboard-e2e-node-data/u);
});
