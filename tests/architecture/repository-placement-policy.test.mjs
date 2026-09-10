import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  allowedRootCodeFiles,
  classifyRootCodePath,
  inspectRepositoryPlacement,
  readTrackedPaths,
  transitionalRootModules,
  validateRepositoryPlacement,
} from "../../scripts/repository-placement-policy.mjs";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

test("documented root configuration entrypoints remain allowed", () => {
  assert.deepEqual(allowedRootCodeFiles, ["drizzle.config.ts", "next.config.ts", "vite.config.ts"]);
  for (const path of allowedRootCodeFiles) {
    assert.deepEqual(classifyRootCodePath(path), { kind: "allowed-config", path });
  }
});

test("existing root production modules are frozen transitional exceptions", () => {
  assert.deepEqual(Object.keys(transitionalRootModules).sort(), ["audit-log.ts", "login-rate-limit.ts", "storage-quick-check.ts"]);
  for (const path of Object.keys(transitionalRootModules)) {
    const classification = classifyRootCodePath(path);
    assert.equal(classification.kind, "transitional", path);
    assert.match(classification.reason, /#[0-9]+/u, `${path} must name an owning follow-up issue`);
  }
  assert.deepEqual(inspectRepositoryPlacement(Object.keys(transitionalRootModules)), []);
});

test("new root production TypeScript fails with an actionable domain-placement message", () => {
  const issues = inspectRepositoryPlacement(["new-service.ts", "new-page.tsx"]);
  assert.deepEqual(issues.map((issue) => issue.code), ["root-production-module", "root-production-module"]);
  for (const issue of issues) {
    assert.match(issue.message, /must not be added at repository root/u);
    assert.match(issue.message, /src\/, worker\/, app\//u);
  }
  assert.throws(
    () => validateRepositoryPlacement(["new-service.ts"]),
    /Repository placement policy failed:[\s\S]*root-production-module[\s\S]*new-service\.ts/u,
  );
});

test("tracked generated or cache artifacts are rejected without misclassifying source-owned directories", () => {
  const issues = inspectRepositoryPlacement([
    "dist/server.js",
    ".next/cache/build.json",
    "artifacts/e2e/result.zip",
    "apps/admin/.next/server/app.js",
    "packages/ui/node_modules/library/index.js",
    "src/recovery/artifacts/recovery-point.ts",
    "src/work/workflow.ts",
    "e2e/fixtures/generated/test-state.json",
    "fixtures/generated/example-output.json",
  ]);
  assert.deepEqual(issues.map((issue) => issue.path), [
    ".next/cache/build.json",
    "apps/admin/.next/server/app.js",
    "artifacts/e2e/result.zip",
    "dist/server.js",
    "packages/ui/node_modules/library/index.js",
  ]);
  for (const issue of issues) {
    assert.equal(issue.code, "generated-artifact");
    assert.match(issue.message, /Keep generated output untracked or place intentional test data under fixtures\//u);
  }
});

test("engineering policy documents stay out of root and GitHub metadata", () => {
  const issues = inspectRepositoryPlacement([
    "ENGINEERING_POLICY.md",
    ".github/TESTING_POLICY.md",
    "docs/development/TESTING_POLICY.md",
    "README.md",
    "AGENTS.md",
    ".github/pull_request_template.md",
  ]);
  assert.deepEqual(issues.map((issue) => issue.path), [".github/TESTING_POLICY.md", "ENGINEERING_POLICY.md"]);
  for (const issue of issues) {
    assert.equal(issue.code, "misplaced-policy-document");
    assert.match(issue.message, /docs\/development\//u);
  }
});

test("the currently tracked repository satisfies the placement guard", () => {
  const trackedPaths = readTrackedPaths(repositoryRoot);
  assert.ok(trackedPaths.includes("package.json"));
  assert.ok(trackedPaths.includes("src/recovery/artifacts/recovery-point.ts"));
  assert.ok(trackedPaths.includes("tests/architecture/repository-placement-policy.test.mjs"));
  assert.doesNotThrow(() => validateRepositoryPlacement(trackedPaths));
});
