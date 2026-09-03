import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scanRoots = ["app", "worker", "tests", "scripts", "e2e", "src"];
const sourceExtensions = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx"]);

async function exists(relativePath) {
  try {
    await stat(path.join(repoRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function collectSourceFiles(relativeDir) {
  const absoluteDir = path.join(repoRoot, relativeDir);
  const entries = await readdir(absoluteDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) files.push(...await collectSourceFiles(relativePath));
    else if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) files.push(relativePath);
  }
  return files;
}

test("operation explorer bridge has a canonical operations implementation with no root shim", async () => {
  assert.equal(await exists("src/operations/explorer/operation-explorer-legacy-bridge.ts"), true);
  assert.equal(await exists("operation-explorer-legacy-bridge.ts"), false);
});

test("legacy operation explorer bridge imports are absent", async () => {
  const files = (await Promise.all(scanRoots.map(collectSourceFiles))).flat();
  const offenders = [];
  for (const relativePath of files) {
    if ([
    "tests/operation-explorer-domain-path-contract.test.mjs",
    "tests/operations-domain-path-contract.test.mjs",
  ].includes(relativePath)) continue;
    const content = await readFile(path.join(repoRoot, relativePath), "utf8");
    if (/(?:\.\.\/|\.\/)+operation-explorer-legacy-bridge(?:\.ts)?["']/.test(content)) offenders.push(relativePath);
  }
  assert.deepEqual(offenders.sort(), []);
});
