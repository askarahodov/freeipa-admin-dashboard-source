import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);

async function exists(path) {
  try {
    await access(new URL(path, rootUrl));
    return true;
  } catch {
    return false;
  }
}

test("non-production Compose and env examples have canonical fixture owners", async () => {
  for (const path of [
    "fixtures/compose/e2e.yaml",
    "fixtures/compose/local-integration.yaml",
    "fixtures/env/e2e.example",
    "fixtures/env/local-integration.example",
  ]) {
    assert.equal(await exists(path), true, `${path} must exist`);
  }

  for (const path of [
    "compose.e2e.yaml",
    "compose.test.yaml",
    ".env.e2e.example",
    ".env.test.example",
  ]) {
    assert.equal(await exists(path), false, `${path} must not return to repository root`);
  }

  assert.equal(await exists("compose.yaml"), true, "production Compose entrypoint stays at repository root");
  assert.equal(await exists(".env.example"), true, "production env example stays at repository root");
});

test("fixture runners keep runtime env precedence while consuming canonical fixtures", async () => {
  const e2eRunner = await readFile(new URL("scripts/run-auth-e2e.sh", rootUrl), "utf8");
  const localRunner = await readFile(new URL("scripts/run-local-integration.sh", rootUrl), "utf8");
  const e2eWorkflow = await readFile(new URL(".github/workflows/e2e-auth.yml", rootUrl), "utf8");

  assert.match(e2eRunner, /ENV_FILE="\$\{E2E_ENV_FILE:-\.env\.e2e\}"/u);
  assert.match(e2eRunner, /COMPOSE_FILE="\$\{E2E_COMPOSE_FILE:-fixtures\/compose\/e2e\.yaml\}"/u);
  assert.match(e2eRunner, /cp fixtures\/env\/e2e\.example \.env\.e2e/u);
  assert.match(e2eWorkflow, /run: cp fixtures\/env\/e2e\.example \.env\.e2e/u);

  assert.match(localRunner, /ENV_FILE="\$\{LOCAL_TEST_ENV_FILE:-\.env\.test\}"/u);
  assert.match(localRunner, /COMPOSE_FILE="\$\{LOCAL_TEST_COMPOSE_FILE:-fixtures\/compose\/local-integration\.yaml\}"/u);
  assert.match(localRunner, /cp fixtures\/env\/local-integration\.example \.env\.test/u);
});

test("relocated Compose fixtures preserve repository-root resources", async () => {
  const e2eCompose = await readFile(new URL("fixtures/compose/e2e.yaml", rootUrl), "utf8");
  const localCompose = await readFile(new URL("fixtures/compose/local-integration.yaml", rootUrl), "utf8");

  assert.match(e2eCompose, /context: \.\.\/\.\./u);
  assert.match(e2eCompose, /\.\.\/\.\.\/\.env\.e2e/u);
  assert.match(e2eCompose, /\.\.\/\.\.\/e2e\/freeipa-mock\.mjs/u);
  assert.match(e2eCompose, /\.\.\/\.\.\/e2e\/xyops-mock\.mjs/u);
  assert.match(e2eCompose, /\.\.\/\.\.\/artifacts\/e2e\/playwright-report/u);
  assert.match(e2eCompose, /dockerfile: e2e\/Dockerfile/u);

  assert.match(localCompose, /context: \.\.\/\.\./u);
  assert.match(localCompose, /\.\.\/\.\.\/\.env\.test/u);
});
