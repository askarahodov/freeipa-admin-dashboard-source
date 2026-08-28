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

test("operation explorer bridge has a canonical operations implementation and thin root shim", async () => {
  assert.equal(await exists("src/operations/operation-explorer-legacy-bridge.ts"), true);
  assert.equal(
    await readFile(path.join(repoRoot, "operation-explorer-legacy-bridge.ts"), "utf8"),
    'export * from "./src/operations/operation-explorer-legacy-bridge";\n',
  );
});

test("legacy operation explorer bridge imports are limited to the explicit migration allowlist", async () => {
  const files = (await Promise.all(scanRoots.map(collectSourceFiles))).flat();
  const offenders = [];
  for (const relativePath of files) {
    if (relativePath === "tests/operation-explorer-domain-path-contract.test.mjs") continue;
    const content = await readFile(path.join(repoRoot, relativePath), "utf8");
    if (/(?:\.\.\/|\.\/)+operation-explorer-legacy-bridge(?:\.ts)?["']/.test(content)) offenders.push(relativePath);
  }
  assert.deepEqual(offenders.sort(), ["app/OperationExplorer.tsx"]);
});
