import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const config = await readFile(new URL("../.github/dependabot.yml", import.meta.url), "utf8");
const policy = await readFile(new URL("../.github/DEPENDABOT_POLICY.md", import.meta.url), "utf8");

function updateBlock(ecosystem) {
  const marker = `  - package-ecosystem: ${ecosystem}`;
  const start = config.indexOf(marker);
  assert.notEqual(start, -1, `missing Dependabot block for ${ecosystem}`);
  const rest = config.slice(start + marker.length);
  const next = rest.indexOf("\n  - package-ecosystem:");
  return `${marker}${next === -1 ? rest : rest.slice(0, next)}`;
}

function openPullRequestLimit(block) {
  const match = block.match(/open-pull-requests-limit:\s*(\d+)/u);
  assert.ok(match, "missing open-pull-requests-limit");
  return Number(match[1]);
}

test("npm version update fan-out is bounded without removing security groups", () => {
  const npm = updateBlock("npm");
  assert.equal(openPullRequestLimit(npm), 3);
  assert.match(npm, /production-security:\s*\n\s+applies-to:\s*security-updates/u);
  assert.match(npm, /development-security:\s*\n\s+applies-to:\s*security-updates/u);
  assert.match(npm, /routine-development:\s*\n\s+applies-to:\s*version-updates/u);
  assert.match(npm, /update-types:\s*\n\s+- minor\s*\n\s+- patch/u);
});

test("GitHub Actions version updates are serialized", () => {
  const actions = updateBlock("github-actions");
  assert.equal(openPullRequestLimit(actions), 1);
});

test("policy preserves security updates and deliberate high-risk review", () => {
  assert.match(policy, /security updates.*not.*open-pull-requests-limit/isu);
  assert.match(policy, /major.*runtime.*toolchain/isu);
  assert.match(policy, /sharded CI/iu);
  assert.match(policy, /one.*GitHub Actions.*version.*PR/isu);
});
