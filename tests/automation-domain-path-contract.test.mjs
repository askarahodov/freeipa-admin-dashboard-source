import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scanRoots = ["app", "worker", "tests", "scripts", "db", "e2e", "src"];
const sourceExtensions = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx"]);

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

async function collectRootSourceFiles() {
  const entries = await readdir(repoRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && sourceExtensions.has(path.extname(entry.name)))
    .map((entry) => entry.name);
}

async function exists(relativePath) {
  try {
    await stat(path.join(repoRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}

test("automation domain has one canonical implementation path", async () => {
  for (const canonical of [
    "src/automation/automation-types.ts",
    "src/automation/field-conditions.ts",
  ]) {
    assert.equal(await exists(canonical), true, `missing canonical automation module: ${canonical}`);
  }

  for (const removedRoot of ["automation-types.ts", "field-conditions.ts"]) {
    assert.equal(await exists(removedRoot), false, `legacy root automation module returned: ${removedRoot}`);
  }
});

test("legacy automation imports are absent repository-wide", async () => {
  const files = [
    ...await collectRootSourceFiles(),
    ...(await Promise.all(scanRoots.map(collectSourceFiles))).flat(),
  ];
  const forbidden = [
    /(?:\.\.\/|\.\/)+automation-types(?:\.ts)?["']/,
    /(?:\.\.\/|\.\/)+field-conditions(?:\.ts)?["']/,
  ];

  const violations = [];
  for (const relativePath of files) {
    if (["tests/automation-domain-path-contract.test.mjs", "src/automation/field-conditions.ts"].includes(relativePath)) continue;
    const content = await readFile(path.join(repoRoot, relativePath), "utf8");
    if (forbidden.some((pattern) => pattern.test(content))) violations.push(relativePath);
  }

  assert.deepEqual(violations.sort(), [], `legacy automation imports found: ${violations.join(", ")}`);
});
