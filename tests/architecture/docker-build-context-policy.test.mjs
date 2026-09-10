import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dockerignoreUrl = new URL("../../.dockerignore", import.meta.url);

function globToRegExp(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/gu, "\\$&").replace(/\*/gu, ".*");
  return new RegExp(`^${escaped}$`, "u");
}

function matchesPattern(path, pattern) {
  const normalized = path.replace(/^\.\//u, "");
  const basename = normalized.split("/").at(-1) ?? normalized;
  const candidatePattern = pattern.replace(/^\//u, "").replace(/\/$/u, "");

  if (candidatePattern.includes("/")) {
    return globToRegExp(candidatePattern).test(normalized);
  }

  if (globToRegExp(candidatePattern).test(basename)) return true;
  return normalized.split("/").some((segment) => globToRegExp(candidatePattern).test(segment));
}

function isIgnored(path, patterns) {
  let ignored = false;
  for (const rawPattern of patterns) {
    if (!rawPattern || rawPattern.startsWith("#")) continue;
    const negated = rawPattern.startsWith("!");
    const pattern = negated ? rawPattern.slice(1) : rawPattern;
    if (matchesPattern(path, pattern)) ignored = !negated;
  }
  return ignored;
}

test("Docker build context excludes local environment, credential, cache and generated-state markers", async () => {
  const source = await readFile(dockerignoreUrl, "utf8");
  const patterns = source.split(/\r?\n/u).map((line) => line.trim());

  const excludedMarkers = [
    ".env",
    ".env.local",
    ".env.production.local",
    ".dev.vars",
    ".vinext/cache/marker",
    ".wrangler/state/marker",
    ".sites-runtime/marker",
    ".next/cache/marker",
    "coverage/marker.json",
    "artifacts/trace.zip",
    "node_modules/pkg/index.js",
    "dist/server/index.js",
    "outputs/marker.txt",
    "work/marker.txt",
    "local-private-key.pem",
    "npm-debug.log",
    "yarn-error.log",
    ".pnpm-debug.log",
  ];

  for (const marker of excludedMarkers) {
    assert.equal(isIgnored(marker, patterns), true, `${marker} must be excluded from Docker build context`);
  }
});

test("Docker build context keeps tracked environment examples explicitly allowlisted", async () => {
  const source = await readFile(dockerignoreUrl, "utf8");
  const patterns = source.split(/\r?\n/u).map((line) => line.trim());

  for (const example of [
    ".env.example",
    ".env.test.example",
    ".env.local-auth-acceptance.example",
    ".env.e2e.example",
  ]) {
    assert.equal(isIgnored(example, patterns), false, `${example} must remain available as a tracked example`);
  }
});

test("Docker context policy remains aligned with repository-local generated state classes", async () => {
  const source = await readFile(dockerignoreUrl, "utf8");
  const requiredPatterns = [
    ".env*",
    ".dev.vars",
    ".next",
    ".vinext",
    ".sites-runtime",
    ".wrangler",
    "dist",
    "node_modules",
    "coverage",
    "artifacts",
    "outputs",
    "work",
    "*.pem",
  ];

  for (const pattern of requiredPatterns) {
    assert.match(source, new RegExp(`(?:^|\\n)${pattern.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?:\\n|$)`, "u"));
  }
});
