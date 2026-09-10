import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildRequiredCIPlan, isOrdinaryDocumentationPath } from "../../scripts/ci-required-plan.mjs";
import { verifyRequiredCI } from "../../scripts/ci-required-gate.mjs";

const workflow = await readFile(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
const heavyJobs = ["build", "container-security", "recovery-compose", "test"];

function successResults(overrides = {}) {
  return {
    "discover-tests": "success",
    "docs-consistency": "success",
    "dependency-security": "success",
    build: "success",
    "container-security": "success",
    "recovery-compose": "success",
    test: "success",
    ...overrides,
  };
}

test("ordinary user-facing guide prose is eligible for docs-only fast path", () => {
  for (const path of [
    "docs/guide/README.md",
    "docs/guide/getting-started/README.md",
    "docs/guide/user/README.md",
    "docs/guide/operator/TROUBLESHOOTING.md",
    "docs/guide/administrator/README.md",
    "docs/guide/support/README.md",
    "docs/guide/concepts/TERMINOLOGY.md",
    "docs/guide/troubleshooting/README.md",
  ]) assert.equal(isOrdinaryDocumentationPath(path), true, path);

  const plan = buildRequiredCIPlan(["docs/guide/user/README.md", "docs/guide/operator/TROUBLESHOOTING.md"]);
  assert.equal(plan.mode, "docs-only");
  assert.equal(plan.jobs["discover-tests"], true);
  assert.equal(plan.jobs["docs-consistency"], true);
  assert.equal(plan.jobs["dependency-security"], true);
  for (const job of heavyJobs) assert.equal(plan.jobs[job], false, job);
});

test("engineering, policy, operational instructions, executable examples and mixed diffs are not docs-only", () => {
  for (const path of [
    "README.md",
    "docs/README.md",
    "docs/TESTING_POLICY.md",
    "docs/development/REQUIRED_CHECKS.md",
    "docs/security/LOCAL_AUTH_RBAC.md",
    "docs/operations/OFFLINE_FULL_RESTORE.md",
    "docs/ai/AI_AGENT_WORKFLOW.md",
    "docs/guide/developer/README.md",
    "docs/guide/operations/README.md",
    "fixtures/compose/e2e.yaml",
    ".github/workflows/ci.yml",
  ]) assert.equal(isOrdinaryDocumentationPath(path), false, path);

  for (const paths of [
    ["docs/guide/user/README.md", "src/auth/local-auth.ts"],
    ["docs/guide/user/README.md", "fixtures/example.yaml"],
    ["docs/TESTING_POLICY.md"],
    ["README.md"],
  ]) {
    const plan = buildRequiredCIPlan(paths);
    assert.equal(plan.mode, "full-ci", paths.join(","));
    for (const job of heavyJobs) assert.equal(plan.jobs[job], true, `${paths.join(",")} -> ${job}`);
  }
});

test("main/non-PR full mode preserves the complete CI path", () => {
  const plan = buildRequiredCIPlan([], { full: true });
  assert.equal(plan.mode, "full-ci");
  assert.equal(plan.docsOnly, false);
  for (const required of Object.values(plan.jobs)) assert.equal(required, true);
});

test("empty pull-request diff fails closed", () => {
  assert.throws(() => buildRequiredCIPlan([]), /empty pull-request diff/u);
});

test("gate accepts success for required jobs and skipped only for plan-authorized jobs", () => {
  const plan = buildRequiredCIPlan(["docs/guide/user/README.md"]);
  const results = successResults({
    build: "skipped",
    "container-security": "skipped",
    "recovery-compose": "skipped",
    test: "skipped",
  });
  assert.equal(verifyRequiredCI(plan, results), true);
});

test("gate rejects missing plan requirements and unknown results", () => {
  const plan = buildRequiredCIPlan(["docs/guide/user/README.md"]);
  assert.throws(() => verifyRequiredCI(null, successResults()), /invalid canonical CI plan/u);
  const broken = structuredClone(plan);
  delete broken.jobs.build;
  assert.throws(() => verifyRequiredCI(broken, successResults()), /Missing canonical requirement/u);
  assert.throws(() => verifyRequiredCI(plan, successResults({ build: "neutral" })), /Unknown or missing result/u);
});

test("gate rejects failed cancelled or skipped required jobs", () => {
  const plan = buildRequiredCIPlan(["src/auth/local-auth.ts"]);
  for (const result of ["failure", "cancelled", "skipped"]) {
    assert.throws(() => verifyRequiredCI(plan, successResults({ build: result })), /Required job build/u, result);
  }
});

test("gate rejects failure or cancellation even for not-required jobs", () => {
  const plan = buildRequiredCIPlan(["docs/guide/user/README.md"]);
  for (const result of ["failure", "cancelled"]) {
    assert.throws(() => verifyRequiredCI(plan, successResults({ build: result })), /Not-required job build/u, result);
  }
});

test("workflow keeps stable Required CI without paths-ignore and uses canonical plan/gate", () => {
  const pullRequestBlock = workflow.match(/pull_request:\s*\n([\s\S]*?)(?=\n  push:|\npermissions:)/u)?.[1] ?? "";
  const requiredBlock = workflow.match(/\n  required:\s*\n([\s\S]*)$/u)?.[1] ?? "";
  assert.doesNotMatch(pullRequestBlock, /paths-ignore|\bpaths:/u);
  assert.match(workflow, /name: Required CI/u);
  assert.match(workflow, /Determine canonical Required CI plan/u);
  assert.match(workflow, /git diff --name-status -z --find-renames/u);
  assert.match(workflow, /node scripts\/ci-required-gate\.mjs/u);
  assert.match(workflow, /PLAN_RESULT/u);
  assert.match(workflow, /if: always\(\)/u);
  assert.match(requiredBlock, /Checkout gate contract[\s\S]*actions\/checkout@v4[\s\S]*ci-required-gate\.mjs/u);
});
