import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildE2ETestPlan } from "../../scripts/auth-e2e-scope.mjs";

const policy = await readFile(new URL("../../docs/TESTING_POLICY.md", import.meta.url), "utf8");
const agents = await readFile(new URL("../../AGENTS.md", import.meta.url), "utf8");

test("mixed changes union affected categories without expanding to full suite", () => {
  const plan = buildE2ETestPlan(["src/auth/portal-permissions.ts", "xyops-client.ts"]);
  assert.deepEqual(plan.categories, ["rbac", "xyops"]);
  assert.deepEqual(plan.browserSpecs, [
    "specs/rbac/rbac-user.spec.mjs",
    "specs/rbac/role-restrictions.spec.mjs",
    "specs/xyops/xyops-lifecycle.spec.mjs",
  ]);
});

test("top-level feature components route to their functional suites plus ui", () => {
  assert.deepEqual(buildE2ETestPlan(["app/FreeIpaUserBrowser.tsx"]).categories, ["freeipa", "ui"]);
  assert.deepEqual(buildE2ETestPlan(["app/OperationExplorer.tsx"]).categories, ["xyops", "ui"]);
  assert.deepEqual(buildE2ETestPlan(["app/SettingsLifecycleWizard.tsx"]).categories, ["settings", "ui"]);
});

test("database-only changes select schema contracts without browser categories", () => {
  const plan = buildE2ETestPlan(["db/portal-migrations.ts"]);
  assert.deepEqual(plan.categories, []);
  assert.deepEqual(plan.browserSpecs, []);
  assert.ok(plan.contractTests.includes("tests/storage/portal-schema-migrations.test.mjs"));
  assert.ok(plan.contractTests.includes("tests/runtime/local-diagnostics-schema.test.mjs"));
  assert.equal(plan.contractTests.includes("tests/local-diagnostics-schema.test.mjs"), false);
});

test("root Dockerfile remains a full E2E runtime risk", () => {
  const plan = buildE2ETestPlan(["Dockerfile"]);
  assert.deepEqual(plan.categories, ["auth", "rbac", "freeipa", "xyops", "settings", "ui"]);
});

test("test-only changes route to the category owned by that test", () => {
  assert.deepEqual(buildE2ETestPlan(["e2e/specs/rbac/rbac-user.spec.mjs"]).categories, ["rbac"]);
  assert.deepEqual(buildE2ETestPlan(["e2e/specs/ui/ui-quality.spec.mjs"]).categories, ["ui"]);
});

test("domain directories do not create false browser categories for unrelated test filenames", () => {
  const dependencyHealthPlan = buildE2ETestPlan([
    "tests/operations/dependency-health-contracts.test.mjs",
    "tests/operations/dependency-health-routing-contract.test.mjs",
  ]);
  assert.deepEqual(dependencyHealthPlan.categories, []);
  assert.deepEqual(dependencyHealthPlan.browserSpecs, []);

  assert.deepEqual(
    buildE2ETestPlan(["tests/operations/operation-runs.test.mjs"]).categories,
    ["xyops"],
  );
});

test("policy tells agents to select tests by changed risk boundary", () => {
  assert.match(policy, /risk-based/iu);
  assert.match(policy, /auth.*rbac.*freeipa.*xyops.*settings.*ui/isu);
  assert.match(policy, /full regression/iu);
  assert.match(policy, /do not.*unrelated/isu);
});

test("repository agent instructions make testing policy mandatory", () => {
  assert.match(agents, /docs\/TESTING_POLICY\.md/u);
  assert.match(agents, /changed files/iu);
  assert.match(agents, /affected.*categor/iu);
});
