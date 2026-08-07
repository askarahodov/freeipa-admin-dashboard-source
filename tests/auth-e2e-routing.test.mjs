import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

import { authE2EExactRelevantPaths, shouldRunAuthE2E } from "../scripts/auth-e2e-scope.mjs";

const workflow = await readFile(new URL("../.github/workflows/e2e-auth.yml", import.meta.url), "utf8");

const relevant = [
  "local-auth.ts",
  "admin-session-authorization.ts",
  "worker/local-secure-entry.ts",
  "worker/settings-lifecycle-entry.ts",
  "app/login/page.tsx",
  "db/portal-migrations.ts",
  "e2e/specs/auth.spec.mjs",
  "scripts/start-worker.mjs",
  "scripts/freeipa-gateway.mjs",
  "Dockerfile",
  "compose.yaml",
  "compose.e2e.yaml",
  ".env.example",
  ".env.e2e.example",
  "package.json",
  "package-lock.json",
  "vite.config.ts",
  ".github/workflows/e2e-auth.yml",
];

for (const path of relevant) {
  test(`Auth E2E scope includes ${path}`, () => {
    assert.equal(shouldRunAuthE2E([path]), true);
  });
}

test("every exact Auth E2E routing reference exists in the repository", async () => {
  for (const path of authE2EExactRelevantPaths) {
    await assert.doesNotReject(access(new URL(`../${path}`, import.meta.url)), `missing routing path: ${path}`);
  }
});

test("Auth E2E scope ignores documentation-only changes", () => {
  assert.equal(shouldRunAuthE2E(["docs/README.md", "docs/OPERATIONS_EXPLORER.md"]), false);
});

test("Auth E2E scope runs when any file in a mixed change is relevant", () => {
  assert.equal(shouldRunAuthE2E(["docs/README.md", "local-auth.ts"]), true);
});

test("workflow exposes a stable pull-request check instead of top-level path filtering", () => {
  const pullRequestBlock = workflow.match(/pull_request:\s*\n([\s\S]*?)(?=\n  [a-zA-Z_]+:|\npermissions:)/u)?.[1] ?? "";
  assert.doesNotMatch(pullRequestBlock, /\bpaths:/u);
  assert.match(workflow, /workflow_dispatch:/u);
  assert.match(workflow, /schedule:/u);
  assert.match(workflow, /push:\s*\n\s+branches:\s*\[main\]/u);
});

test("workflow keeps one stable auth-e2e job and gates only expensive steps", () => {
  assert.match(workflow, /\n  auth-e2e:\n/u);
  assert.match(workflow, /Determine Auth E2E scope/u);
  assert.match(workflow, /Auth E2E not required for this pull request/u);
  assert.match(workflow, /if: steps\.scope\.outputs\.run == 'true'/u);
});

test("workflow concurrency cancels obsolete PR runs but not main, manual, or scheduled runs", () => {
  assert.match(workflow, /concurrency:/u);
  assert.match(workflow, /cancel-in-progress:.*pull_request/u);
});
