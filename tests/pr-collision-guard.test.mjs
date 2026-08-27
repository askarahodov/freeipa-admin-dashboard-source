import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  analyzePullRequestCollisions,
  formatCollisionReport,
  isHighConflictPath,
} from "../scripts/pr-collision-guard.mjs";

const workflow = await readFile(new URL("../.github/workflows/pr-collision-guard.yml", import.meta.url), "utf8");

const openMainPr = (number, title, files) => ({
  number,
  title,
  base: "main",
  state: "open",
  files,
});

test("high-conflict policy recognizes exact canonical owners", () => {
  for (const path of [
    "app/page.tsx",
    "worker/index.ts",
    "package.json",
    "package-lock.json",
    "portal-permissions.ts",
    "local-auth.ts",
    "admin-session-authorization.ts",
    "docs/SOURCE_OF_TRUTH.md",
    "docs/ARCHITECTURE.md",
    "docs/PROJECT_STRUCTURE.md",
    "docs/SECURITY_MODEL.md",
    "docs/ai/README.md",
  ]) {
    assert.equal(isHighConflictPath(path), true, path);
  }
});

test("high-conflict policy recognizes canonical prefixes", () => {
  assert.equal(isHighConflictPath("db/portal-schema.ts"), true);
  assert.equal(isHighConflictPath("db/migrations/v5.ts"), true);
  assert.equal(isHighConflictPath(".github/workflows/ci.yml"), true);
});

test("ordinary files and planning artifacts are not high-conflict", () => {
  assert.equal(isHighConflictPath("app/ui/Button.tsx"), false);
  assert.equal(isHighConflictPath("docs/superpowers/plans/example.md"), false);
  assert.equal(isHighConflictPath("docs/superpowers/specs/example.md"), false);
});

test("ordinary exact overlap is informational and does not block", () => {
  const result = analyzePullRequestCollisions({
    currentPrNumber: 200,
    currentFiles: ["app/ui/Button.tsx"],
    pullRequests: [openMainPr(201, "other UI work", ["app/ui/Button.tsx"])],
  });

  assert.equal(result.blocking, false);
  assert.deepEqual(result.overlaps, [
    {
      severity: "INFO",
      path: "app/ui/Button.tsx",
      pullRequests: [{ number: 201, title: "other UI work" }],
    },
  ]);
});

test("canonical overlap blocks and current PR never collides with itself", () => {
  const result = analyzePullRequestCollisions({
    currentPrNumber: 200,
    currentFiles: ["app/page.tsx", "docs/superpowers/plans/current.md"],
    pullRequests: [
      openMainPr(200, "current", ["app/page.tsx"]),
      openMainPr(201, "home extraction", ["app/page.tsx"]),
      openMainPr(202, "planning", ["docs/superpowers/plans/current.md"]),
    ],
  });

  assert.equal(result.blocking, true);
  assert.deepEqual(result.overlaps, [
    {
      severity: "BLOCKING",
      path: "app/page.tsx",
      pullRequests: [{ number: 201, title: "home extraction" }],
    },
    {
      severity: "INFO",
      path: "docs/superpowers/plans/current.md",
      pullRequests: [{ number: 202, title: "planning" }],
    },
  ]);
});

test("non-open and non-main pull request entries are ignored", () => {
  const result = analyzePullRequestCollisions({
    currentPrNumber: 200,
    currentFiles: ["worker/index.ts"],
    pullRequests: [
      { number: 201, title: "closed", base: "main", state: "closed", files: ["worker/index.ts"] },
      { number: 202, title: "stacked", base: "agent/base", state: "open", files: ["worker/index.ts"] },
    ],
  });

  assert.equal(result.blocking, false);
  assert.deepEqual(result.overlaps, []);
});

test("multiple conflicts are deduplicated and sorted deterministically", () => {
  const result = analyzePullRequestCollisions({
    currentPrNumber: 200,
    currentFiles: ["package.json", "app/ui/Button.tsx", "db/portal-schema.ts"],
    pullRequests: [
      openMainPr(205, "dependency work", ["package.json"]),
      openMainPr(203, "schema work", ["db/portal-schema.ts", "package.json"]),
      openMainPr(204, "button work", ["app/ui/Button.tsx"]),
      openMainPr(202, "also dependency work", ["package.json", "package.json"]),
    ],
  });

  assert.deepEqual(result.overlaps, [
    {
      severity: "BLOCKING",
      path: "db/portal-schema.ts",
      pullRequests: [{ number: 203, title: "schema work" }],
    },
    {
      severity: "BLOCKING",
      path: "package.json",
      pullRequests: [
        { number: 202, title: "also dependency work" },
        { number: 203, title: "schema work" },
        { number: 205, title: "dependency work" },
      ],
    },
    {
      severity: "INFO",
      path: "app/ui/Button.tsx",
      pullRequests: [{ number: 204, title: "button work" }],
    },
  ]);
});

test("report formatting distinguishes clean, informational and blocking results", () => {
  assert.equal(
    formatCollisionReport({ blocking: false, overlaps: [] }),
    "PR ownership collision check: no overlapping files with other open PRs targeting main.\n",
  );

  assert.match(
    formatCollisionReport({
      blocking: false,
      overlaps: [
        {
          severity: "INFO",
          path: "app/ui/Button.tsx",
          pullRequests: [{ number: 201, title: "button work" }],
        },
      ],
    }),
    /INFO app\/ui\/Button\.tsx -> #201 button work/u,
  );

  const blockingReport = formatCollisionReport({
    blocking: true,
    overlaps: [
      {
        severity: "BLOCKING",
        path: "worker/index.ts",
        pullRequests: [{ number: 202, title: "worker refactor" }],
      },
    ],
  });
  assert.match(blockingReport, /BLOCKING worker\/index\.ts -> #202 worker refactor/u);
  assert.match(blockingReport, /establish ordering\/dependency, narrow the PR scope, or replay after the owning PR merges/u);
});

test("workflow is a stable read-only pull-request check", () => {
  assert.match(workflow, /^name:\s*PR Collision Guard/mu);
  assert.match(workflow, /pull_request:\s*\n\s+branches:\s*\[main\]/u);
  assert.match(workflow, /contents:\s*read/u);
  assert.match(workflow, /pull-requests:\s*read/u);
  assert.doesNotMatch(workflow, /contents:\s*write/u);
  assert.doesNotMatch(workflow, /pull-requests:\s*write/u);
  assert.match(workflow, /name:\s*ownership-collision/u);
  assert.match(workflow, /actions\/github-script@v9/u);
});

test("workflow reads PR metadata through the GitHub client and delegates policy to the tested module", () => {
  assert.match(workflow, /github\.paginate\(github\.rest\.pulls\.list/u);
  assert.match(workflow, /github\.paginate\(github\.rest\.pulls\.listFiles/u);
  assert.match(workflow, /analyzePullRequestCollisions/u);
  assert.match(workflow, /formatCollisionReport/u);
  assert.match(workflow, /core\.setFailed/u);
});
