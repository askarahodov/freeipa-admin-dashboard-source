import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildE2ETestPlan } from "../scripts/auth-e2e-scope.mjs";

const policy = await readFile(new URL("../docs/TESTING_POLICY.md", import.meta.url), "utf8");
const agents = await readFile(new URL("../AGENTS.md", import.meta.url), "utf8");

test("mixed changes union affected categories without expanding to full suite", () => {
  const plan = buildE2ETestPlan(["portal-permissions.ts", "xyops-client.ts"]);
  assert.deepEqual(plan.categories, ["rbac", "xyops"]);
  assert.deepEqual(plan.browserSpecs, [
    "specs/rbac-user.spec.mjs",
    "specs/role-restrictions.spec.mjs",
    "specs/xyops-lifecycle.spec.mjs",
  ]);
});

test("test-only changes route to the category owned by that test", () => {
  assert.deepEqual(buildE2ETestPlan(["e2e/specs/rbac-user.spec.mjs"]).categories, ["rbac"]);
  assert.deepEqual(buildE2ETestPlan(["e2e/specs/ui-quality.spec.mjs"]).categories, ["ui"]);
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
