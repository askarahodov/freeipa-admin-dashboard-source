import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { assessPackageJsonChange, buildE2ETestPlan } from "../../scripts/auth-e2e-scope.mjs";

const policy = await readFile(new URL("../../docs/TESTING_POLICY.md", import.meta.url), "utf8");
const requiredChecks = await readFile(new URL("../../docs/development/REQUIRED_CHECKS.md", import.meta.url), "utf8");
const agents = await readFile(new URL("../../AGENTS.md", import.meta.url), "utf8");

const cases = [
  { name: "docs", paths: ["docs/guide/README.md"], categories: [], full: false },
  { name: "UI", paths: ["app/icons.tsx"], categories: ["ui"], full: false },
  { name: "auth/RBAC", paths: ["src/auth/portal-request-context.ts"], categories: ["auth", "rbac"], full: false },
  { name: "settings", paths: ["settings-service.ts"], categories: ["settings"], full: false },
  { name: "FreeIPA", paths: ["src/freeipa/freeipa-user-query.ts"], categories: ["freeipa"], full: false },
  { name: "storage/recovery schema", paths: ["db/portal-migrations.ts"], categories: [], full: false, contracts: true },
  { name: "fixture runtime", paths: ["fixtures/compose/e2e.yaml"], categories: ["auth", "rbac", "freeipa", "xyops", "settings", "ui"], full: true },
  { name: "policy/workflow", paths: ["scripts/auth-e2e-scope.mjs"], categories: ["auth", "rbac", "freeipa", "xyops", "settings", "ui"], full: true },
  { name: "unknown runtime", paths: ["worker/new-runtime-boundary.ts"], categories: ["auth", "rbac", "freeipa", "xyops", "settings", "ui"], full: true },
];

for (const fixture of cases) {
  test(`table-driven routing: ${fixture.name}`, () => {
    const plan = buildE2ETestPlan(fixture.paths);
    assert.deepEqual(plan.categories, fixture.categories);
    assert.equal(plan.full, fixture.full);
    if (fixture.contracts) assert.ok(plan.contractTests.length > 0);
    assert.ok(plan.requiredJobs.includes("Required CI"));
    assert.ok(plan.requiredJobs.includes("Scoped E2E / routing contract"));
  });
}

test("mixed changes union affected categories without expanding to full suite", () => {
  const plan = buildE2ETestPlan(["src/auth/portal-permissions.ts", "xyops-client.ts"]);
  assert.deepEqual(plan.categories, ["rbac", "xyops"]);
  assert.equal(plan.full, false);
});

test("top-level feature components route to functional suites plus UI", () => {
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
});

test("ordinary npm test script maintenance does not imply full browser regression", () => {
  const base = { scripts: { test: "node scripts/run-node-tests.mjs" }, private: true };
  const head = { scripts: { test: "node scripts/run-node-tests-v2.mjs" }, private: true };
  const assessment = assessPackageJsonChange(base, head);
  assert.equal(assessment.full, false);
  assert.equal(buildE2ETestPlan(["package.json"], { packageAssessment: assessment }).full, false);
});

test("dependency and unknown package script changes remain conservative", () => {
  const base = { scripts: { test: "node a.mjs" }, dependencies: { react: "1" } };
  assert.equal(assessPackageJsonChange(base, { ...base, dependencies: { react: "2" } }).full, true);
  assert.equal(assessPackageJsonChange(base, { ...base, scripts: { ...base.scripts, deploy: "node deploy.mjs" } }).full, true);
});

test("test-only changes route to the category owned by that test without generic full fallback", () => {
  assert.deepEqual(buildE2ETestPlan(["e2e/specs/rbac/rbac-user.spec.mjs"]).categories, ["rbac"]);
  assert.deepEqual(buildE2ETestPlan(["e2e/specs/ui/ui-quality.spec.mjs"]).categories, ["ui"]);
  assert.equal(buildE2ETestPlan(["tests/operations/dependency-health-contracts.test.mjs"]).full, false);
});

test("policy documents canonical planner, merge-base diff semantics and conservative fallback", () => {
  assert.match(policy, /canonical.*scripts\/auth-e2e-scope\.mjs/isu);
  assert.match(policy, /merge-base/iu);
  assert.match(policy, /rename.*delete/isu);
  assert.match(policy, /package\.json/iu);
  assert.match(policy, /(?:unclassified|unknown).*runtime/iu);
  assert.match(requiredChecks, /canonical plan/iu);
  assert.doesNotMatch(requiredChecks, /compose\.e2e\.yaml|\.env\.e2e\.example/u);
});

test("repository agent instructions make testing policy mandatory", () => {
  assert.match(agents, /docs\/TESTING_POLICY\.md/u);
  assert.match(agents, /changed files/iu);
  assert.match(agents, /affected.*categor/iu);
});
