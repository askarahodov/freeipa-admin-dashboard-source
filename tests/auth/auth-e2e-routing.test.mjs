import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assessPackageJsonChange,
  buildE2ETestPlan,
  categoriesForPath,
  parseChangedInputs,
  shouldRunAuthE2E,
} from "../../scripts/auth-e2e-scope.mjs";

const workflow = await readFile(new URL("../../.github/workflows/e2e-auth.yml", import.meta.url), "utf8");
const ciWorkflow = await readFile(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");

test("documentation-only changes do not trigger browser E2E", () => {
  const plan = buildE2ETestPlan(["docs/README.md", "docs/OPERATIONS_EXPLORER.md"]);
  assert.equal(shouldRunAuthE2E(["docs/README.md", "docs/OPERATIONS_EXPLORER.md"]), false);
  assert.equal(plan.full, false);
  assert.deepEqual(plan.categories, []);
});

test("ordinary UI changes run UI coverage but not unrelated RBAC or integrations", () => {
  const plan = buildE2ETestPlan(["app/icons.tsx"]);
  assert.deepEqual(plan.categories, ["ui"]);
  assert.deepEqual(plan.browserSpecs, ["specs/ui/ui-quality.spec.mjs"]);
});

test("authentication request context selects auth and RBAC consumers", () => {
  assert.deepEqual(categoriesForPath("src/auth/local-auth.ts"), ["auth"]);
  assert.deepEqual(categoriesForPath("src/auth/admin-session-authorization.ts"), ["auth", "rbac"]);
  assert.deepEqual(categoriesForPath("src/auth/portal-request-context.ts"), ["auth", "rbac"]);
  assert.deepEqual(buildE2ETestPlan(["app/login/page.tsx"]).categories, ["auth", "ui"]);
});

test("FreeIPA source directory routes to FreeIPA browser coverage", () => {
  assert.deepEqual(categoriesForPath("src/freeipa/freeipa-user-query.ts"), ["freeipa"]);
  assert.deepEqual(buildE2ETestPlan(["src/freeipa/freeipa-user-query.ts"]).browserSpecs, ["specs/freeipa/freeipa-crud.spec.mjs"]);
});

test("canonical and legacy-sensitive E2E fixture names use only canonical current paths", () => {
  for (const path of ["fixtures/compose/e2e.yaml", "fixtures/env/e2e.example"]) {
    const plan = buildE2ETestPlan([path]);
    assert.equal(plan.full, true, path);
    assert.deepEqual(plan.categories, ["auth", "rbac", "freeipa", "xyops", "settings", "ui"], path);
  }
  assert.equal(buildE2ETestPlan(["compose.e2e.yaml"]).full, false);
  assert.equal(buildE2ETestPlan([".env.e2e.example"]).full, false);
});

test("canonical E2E integration fixtures route to their owners", () => {
  assert.deepEqual(categoriesForPath("e2e/fixtures/freeipa-mock.mjs"), ["freeipa"]);
  assert.deepEqual(categoriesForPath("e2e/fixtures/xyops-mock.mjs"), ["xyops"]);
});

test("schema work runs schema contracts without unrelated browser suites", () => {
  const plan = buildE2ETestPlan(["db/portal-migrations.ts"]);
  assert.deepEqual(plan.categories, []);
  assert.deepEqual(plan.browserSpecs, []);
  assert.ok(plan.contractTests.some((path) => path.includes("portal-schema-migrations")));
});

test("package.json semantic comparison distinguishes ordinary test script from runtime/dependency changes", () => {
  const base = { scripts: { test: "node a.mjs", build: "vite build" }, dependencies: { react: "1" }, private: true };
  const testOnly = { ...base, scripts: { ...base.scripts, test: "node b.mjs" } };
  const runtimeScript = { ...base, scripts: { ...base.scripts, build: "vite build --mode prod" } };
  const dependency = { ...base, dependencies: { react: "2" } };

  assert.equal(assessPackageJsonChange(base, testOnly).full, false);
  assert.equal(assessPackageJsonChange(base, runtimeScript).full, true);
  assert.equal(assessPackageJsonChange(base, dependency).full, true);
  assert.equal(assessPackageJsonChange(null, testOnly).full, true);

  assert.equal(buildE2ETestPlan(["package.json"], { packageAssessment: assessPackageJsonChange(base, testOnly) }).full, false);
  assert.equal(buildE2ETestPlan(["package.json"], { packageAssessment: assessPackageJsonChange(base, runtimeScript) }).full, true);
});

test("rename/delete diff records preserve both old and new paths for routing", () => {
  assert.deepEqual(parseChangedInputs("R100\tsrc/freeipa/old.ts\tsrc/freeipa/freeipa-user-query.ts\nD\tsrc/auth/portal-request-context.ts\n"), [
    { status: "R100", path: "src/freeipa/old.ts" },
    { status: "R100", path: "src/freeipa/freeipa-user-query.ts" },
    { status: "D", path: "src/auth/portal-request-context.ts" },
  ]);
  const plan = buildE2ETestPlan(parseChangedInputs("R100\tsrc/freeipa/old.ts\tsrc/freeipa/freeipa-user-query.ts\nD\tsrc/auth/portal-request-context.ts\n"));
  assert.deepEqual(plan.categories, ["auth", "rbac", "freeipa"]);
});

test("NUL-delimited diff preserves Unicode and newline pathnames and falls back conservatively", () => {
  const unusualPath = "src/café\nnew-boundary.ts";
  const changed = parseChangedInputs(`A\0${unusualPath}\0R100\0src/freeipa/old.ts\0src/freeipa/café.ts\0`);
  assert.deepEqual(changed, [
    { status: "A", path: unusualPath },
    { status: "R100", path: "src/freeipa/old.ts" },
    { status: "R100", path: "src/freeipa/café.ts" },
  ]);
  const plan = buildE2ETestPlan(changed);
  assert.equal(plan.full, true);
  assert.match(plan.fullFallbackReason, /unclassified runtime-sensitive path/u);
});

test("invalid diff input fails closed instead of producing an empty success plan", () => {
  assert.throws(() => parseChangedInputs("WHAT\tsrc/auth/local-auth.ts\n"), /Invalid git diff status/u);
  assert.throws(() => parseChangedInputs("R100\tsrc/a.ts\n"), /Invalid rename\/copy/u);
  assert.throws(() => parseChangedInputs("R100\0src/a.ts\0"), /Invalid NUL-delimited git diff record/u);
});

test("unknown runtime-sensitive paths force conservative full coverage", () => {
  const plan = buildE2ETestPlan(["src/new-domain/runtime-boundary.ts"]);
  assert.equal(plan.full, true);
  assert.match(plan.fullFallbackReason, /unclassified runtime-sensitive path/u);
  assert.deepEqual(plan.categories, ["auth", "rbac", "freeipa", "xyops", "settings", "ui"]);
});

test("canonical spec paths route back to their owning category", () => {
  assert.deepEqual(categoriesForPath("e2e/specs/auth/auth.spec.mjs"), ["auth"]);
  assert.deepEqual(categoriesForPath("e2e/specs/rbac/rbac-user.spec.mjs"), ["rbac"]);
  assert.deepEqual(categoriesForPath("e2e/specs/freeipa/freeipa-crud.spec.mjs"), ["freeipa"]);
  assert.deepEqual(categoriesForPath("e2e/specs/xyops/xyops-lifecycle.spec.mjs"), ["xyops"]);
  assert.deepEqual(categoriesForPath("e2e/specs/settings/admin-session-settings.spec.mjs"), ["settings"]);
  assert.deepEqual(categoriesForPath("e2e/specs/ui/ui-quality.spec.mjs"), ["ui"]);
});

test("workflow derives PR scope from merge-base with lossless paths and emits summary from canonical planner", () => {
  const pullRequestBlock = workflow.match(/pull_request:\s*\n([\s\S]*?)(?=\n  [a-zA-Z_]+:|\npermissions:)/u)?.[1] ?? "";
  assert.doesNotMatch(pullRequestBlock, /\bpaths:/u);
  assert.match(workflow, /git merge-base/u);
  assert.match(workflow, /git diff --name-status -z --find-renames/u);
  assert.match(workflow, /--github-step-summary "\$GITHUB_STEP_SUMMARY"/u);
  assert.match(workflow, /--base-package/u);
  assert.match(workflow, /--head-package/u);
  assert.match(workflow, /Validate planner outputs exist/u);
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
