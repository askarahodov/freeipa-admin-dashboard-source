import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildE2ETestPlan, categoriesForPath, shouldRunAuthE2E } from "../scripts/auth-e2e-scope.mjs";

const workflow = await readFile(new URL("../.github/workflows/e2e-auth.yml", import.meta.url), "utf8");
const ciWorkflow = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");

test("documentation-only changes do not trigger browser E2E", () => {
  assert.equal(shouldRunAuthE2E(["docs/README.md", "docs/OPERATIONS_EXPLORER.md"]), false);
});

test("ordinary UI changes run UI coverage but not unrelated RBAC or integrations", () => {
  const plan = buildE2ETestPlan(["app/icons.tsx"]);
  assert.deepEqual(plan.categories, ["ui"]);
  assert.deepEqual(plan.browserSpecs, ["specs/ui-quality.spec.mjs"]);
});

test("authentication changes select authentication coverage", () => {
  assert.deepEqual(categoriesForPath("local-auth.ts"), ["auth"]);
  assert.deepEqual(buildE2ETestPlan(["app/login/page.tsx"]).browserSpecs, ["specs/auth.spec.mjs", "specs/ui-quality.spec.mjs"]);
});

test("RBAC changes select only RBAC coverage", () => {
  const plan = buildE2ETestPlan(["portal-permissions.ts"]);
  assert.deepEqual(plan.categories, ["rbac"]);
  assert.deepEqual(plan.browserSpecs, ["specs/rbac-user.spec.mjs", "specs/role-restrictions.spec.mjs"]);
});

test("integration domains route to their own browser suites", () => {
  assert.deepEqual(buildE2ETestPlan(["freeipa-client.ts"]).categories, ["freeipa"]);
  assert.deepEqual(buildE2ETestPlan(["xyops-client.ts"]).categories, ["xyops"]);
  assert.deepEqual(buildE2ETestPlan(["settings-service.ts"]).categories, ["settings"]);
});

test("schema work runs schema contracts without unrelated browser suites", () => {
  const plan = buildE2ETestPlan(["db/portal-migrations.ts"]);
  assert.deepEqual(plan.categories, ["settings"]);
  assert.ok(plan.contractTests.some((path) => path.includes("portal-schema-migrations")));
  assert.ok(!plan.browserSpecs.includes("specs/rbac-user.spec.mjs"));
});

test("E2E infrastructure changes deliberately run full coverage", () => {
  const plan = buildE2ETestPlan(["compose.e2e.yaml"]);
  assert.deepEqual(plan.categories, ["auth", "rbac", "freeipa", "xyops", "settings", "ui"]);
  assert.equal(plan.browserSpecs.length, 8);
});

test("workflow keeps a stable pull-request check and scopes only expensive coverage", () => {
  const pullRequestBlock = workflow.match(/pull_request:\s*\n([\s\S]*?)(?=\n  [a-zA-Z_]+:|\npermissions:)/u)?.[1] ?? "";
  assert.doesNotMatch(pullRequestBlock, /\bpaths:/u);
  assert.match(workflow, /Determine affected test categories/u);
  assert.match(workflow, /browser_specs/u);
  assert.match(workflow, /contract_tests/u);
  assert.match(workflow, /E2E_SPECS/u);
  assert.match(workflow, /--full/u);
});

test("scheduled, manual and main runs retain full regression coverage", () => {
  assert.match(workflow, /workflow_dispatch:/u);
  assert.match(workflow, /schedule:/u);
  assert.match(workflow, /push:\s*\n\s+branches:\s*\[main\]/u);
  assert.match(workflow, /--full/u);
});

test("E2E concurrency cancels obsolete PR runs but not main, manual, or scheduled runs", () => {
  assert.match(workflow, /concurrency:/u);
  assert.match(workflow, /cancel-in-progress:.*pull_request/u);
});

test("main CI still exposes its stable aggregate required check", () => {
  assert.match(ciWorkflow, /\n  required:\n/u);
  assert.match(ciWorkflow, /name:\s*Required CI/u);
});
