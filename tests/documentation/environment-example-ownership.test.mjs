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

test("environment examples have explicit production, development, and fixture owners", async () => {
  for (const path of [
    ".env.example",
    ".dev.vars.example",
    "config/development/runtime.env.example",
    "fixtures/env/e2e.example",
    "fixtures/env/local-integration.example",
    "fixtures/env/local-auth-acceptance.example",
  ]) {
    assert.equal(await exists(path), true, `${path} must exist`);
  }

  for (const path of [".env.dev.example", ".env.local-auth-acceptance.example"]) {
    assert.equal(await exists(path), false, `${path} must not return to repository root`);
  }
});

test("environment ownership indexes document justified root entrypoints and canonical fixtures", async () => {
  const development = await readFile(new URL("config/development/README.md", rootUrl), "utf8");
  const fixtures = await readFile(new URL("fixtures/README.md", rootUrl), "utf8");

  assert.match(development, /config\/development\/runtime\.env\.example/u);
  assert.match(development, /\.dev\.vars\.example/u);
  assert.match(development, /\.env\.example/u);
  assert.match(fixtures, /fixtures\/env\/local-auth-acceptance\.example/u);
  assert.match(fixtures, /fixtures\/env\/local-integration\.example/u);
});

test("development identity contract consumes the canonical development env example", async () => {
  const secureDefaults = await readFile(new URL("tests/auth/local-auth-secure-default.test.mjs", rootUrl), "utf8");

  assert.match(secureDefaults, /config\/development\/runtime\.env\.example/u);
  assert.doesNotMatch(secureDefaults, /\.env\.dev\.example/u);
});

test("local acceptance runbook consumes canonical non-production fixture paths", async () => {
  const runbook = await readFile(new URL("docs/operations/LOCAL_ACCEPTANCE_TESTS.md", rootUrl), "utf8");

  assert.match(runbook, /cp fixtures\/env\/local-integration\.example \.env\.test/u);
  assert.match(runbook, /-f fixtures\/compose\/local-integration\.yaml config/u);
  assert.match(runbook, /cp fixtures\/env\/local-auth-acceptance\.example \.env\.local-auth-acceptance/u);
  assert.doesNotMatch(runbook, /cp \.env\.test\.example \.env\.test/u);
  assert.doesNotMatch(runbook, /-f compose\.test\.yaml/u);
  assert.doesNotMatch(runbook, /\.env\.local-auth-acceptance\.example/u);
});
