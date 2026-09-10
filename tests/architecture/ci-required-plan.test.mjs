import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { assessRequiredCIJobs, buildRequiredCIPlan, isOrdinaryDocumentationPath } from "../../scripts/ci-required-plan.mjs";
import { verifyRequiredCI } from "../../scripts/ci-required-gate.mjs";

const workflow = await readFile(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");

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
  for (const job of ["build", "container-security", "recovery-compose", "test"]) assert.equal(plan.jobs[job], false, job);
});

test("engineering, policy, executable and mixed diffs keep build and full Node suite", () => {
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
    "src/auth/local-auth.ts",
  ]) assert.equal(isOrdinaryDocumentationPath(path), false, path);

  for (const paths of [
    ["docs/guide/user/README.md", "src/auth/local-auth.ts"],
    ["docs/guide/user/README.md", "fixtures/example.yaml"],
    ["docs/TESTING_POLICY.md"],
    ["README.md"],
  ]) {
    const plan = buildRequiredCIPlan(paths);
    assert.equal(plan.mode, "risk-routed-ci", paths.join(","));
    assert.equal(plan.jobs.build, true, `${paths.join(",")} -> build`);
    assert.equal(plan.jobs.test, true, `${paths.join(",")} -> test`);
  }
});

test("container and recovery jobs follow table-driven risk boundaries", () => {
  const cases = [
    { input: ["app/users/UserTable.tsx"], container: false, recovery: false, reason: "isolated UI" },
    { input: ["src/freeipa/freeipa-user-query.ts"], container: false, recovery: false, reason: "runtime behavior without package composition" },
    { input: ["Dockerfile"], container: true, recovery: true, reason: "shared image definition" },
    { input: ["package-lock.json"], container: true, recovery: true, reason: "dependency graph" },
    { input: ["security/audit-allowlist.json"], container: true, recovery: false, reason: "security enforcement" },
    { input: ["src/recovery/swap.ts"], container: false, recovery: true, reason: "recovery implementation" },
    { input: ["src/backup/backup.ts"], container: false, recovery: true, reason: "backup dependency" },
    { input: ["src/storage/store.ts"], container: false, recovery: true, reason: "storage dependency" },
    { input: ["db/portal-schema.ts"], container: false, recovery: true, reason: "schema dependency" },
    { input: ["scripts/config-encryption-key.mjs"], container: false, recovery: true, reason: "encryption boundary" },
    { input: ["scripts/identity-startup-policy.mjs"], container: false, recovery: true, reason: "identity boundary" },
    { input: ["compose.yaml"], container: false, recovery: true, reason: "container/volume configuration" },
    { input: ["tests/recovery/recovery-fault-matrix.test.mjs"], container: false, recovery: true, reason: "recovery contract" },
    { input: ["scripts/ci-required-plan.mjs"], container: true, recovery: true, reason: "planner change forces conservative regression" },
    { input: ["app/users/UserTable.tsx", "db/portal-schema.ts"], container: false, recovery: true, reason: "mixed UI + schema" },
    { input: ["src/auth/local-auth.ts", "package.json"], container: true, recovery: true, reason: "mixed auth + package" },
  ];

  for (const fixture of cases) {
    const risk = assessRequiredCIJobs(fixture.input);
    assert.equal(risk.containerSecurity, fixture.container, `${fixture.reason}: container`);
    assert.equal(risk.recoveryCompose, fixture.recovery, `${fixture.reason}: recovery`);

    const plan = buildRequiredCIPlan(fixture.input);
    assert.equal(plan.jobs["container-security"], fixture.container, `${fixture.reason}: planned container`);
    assert.equal(plan.jobs["recovery-compose"], fixture.recovery, `${fixture.reason}: planned recovery`);
    assert.equal(plan.jobs.build, true, `${fixture.reason}: build preserved`);
    assert.equal(plan.jobs.test, true, `${fixture.reason}: full Node suite preserved`);
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

test("gate accepts skipped Docker jobs only when canonical plan authorizes them", () => {
  const plan = buildRequiredCIPlan(["src/auth/local-auth.ts"]);
  assert.equal(plan.jobs["container-security"], false);
  assert.equal(plan.jobs["recovery-compose"], false);
  assert.equal(
    verifyRequiredCI(plan, successResults({ "container-security": "skipped", "recovery-compose": "skipped" })),
    true,
  );
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
  const plan = buildRequiredCIPlan(["Dockerfile"]);
  for (const job of ["build", "container-security", "recovery-compose", "test"]) {
    for (const result of ["failure", "cancelled", "skipped"]) {
      assert.throws(() => verifyRequiredCI(plan, successResults({ [job]: result })), new RegExp(`Required job ${job}`), `${job}:${result}`);
    }
  }
});

test("gate rejects failure or cancellation even for not-required jobs", () => {
  const plan = buildRequiredCIPlan(["src/auth/local-auth.ts"]);
  for (const job of ["container-security", "recovery-compose"]) {
    for (const result of ["failure", "cancelled"]) {
      assert.throws(() => verifyRequiredCI(plan, successResults({ [job]: result })), new RegExp(`Not-required job ${job}`), `${job}:${result}`);
    }
  }
});

test("workflow keeps stable Required CI and consumes canonical risk outputs", () => {
  const pullRequestBlock = workflow.match(/pull_request:\s*\n([\s\S]*?)(?=\n  push:|\npermissions:)/u)?.[1] ?? "";
  const requiredBlock = workflow.match(/\n  required:\s*\n([\s\S]*)$/u)?.[1] ?? "";
  assert.doesNotMatch(pullRequestBlock, /paths-ignore|\bpaths:/u);
  assert.match(workflow, /name: Required CI/u);
  assert.match(workflow, /Determine canonical Required CI plan/u);
  assert.match(workflow, /git diff --name-status -z --find-renames/u);
  assert.match(workflow, /needs\.plan\.outputs\.container_security == 'true'/u);
  assert.match(workflow, /needs\.plan\.outputs\.recovery_compose == 'true'/u);
  assert.match(workflow, /node scripts\/ci-required-gate\.mjs/u);
  assert.match(workflow, /PLAN_RESULT/u);
  assert.match(workflow, /if: always\(\)/u);
  assert.match(requiredBlock, /Checkout gate contract[\s\S]*actions\/checkout@v4[\s\S]*ci-required-gate\.mjs/u);
});
