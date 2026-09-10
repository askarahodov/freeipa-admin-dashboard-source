import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";

const repoRoot = resolve(new URL("../..", import.meta.url).pathname);
const entrypoint = resolve(repoRoot, "scripts/start-production.mjs");

const staticImportPatterns = [
  /\b(?:import|export)\s+(?:type\s+)?(?:[^"'`;]*?\s+from\s+)?["']([^"']+)["']/gu,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu,
];

function importsFrom(source) {
  const imports = [];
  for (const pattern of staticImportPatterns) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) imports.push(match[1]);
  }
  return imports;
}

function localImport(fromFile, specifier) {
  if (!specifier.startsWith(".")) return null;
  return resolve(dirname(fromFile), specifier);
}

async function sourceClosure(rootFile) {
  const pending = [rootFile];
  const visited = new Set();
  const bare = [];
  while (pending.length) {
    const file = pending.pop();
    if (visited.has(file)) continue;
    visited.add(file);
    const source = await readFile(file, "utf8");
    for (const specifier of importsFrom(source)) {
      if (specifier.startsWith("node:")) continue;
      const local = localImport(file, specifier);
      if (local) {
        pending.push(local);
        continue;
      }
      bare.push({ file, specifier });
    }
  }
  return { visited, bare };
}

test("production host source closure uses only Node built-ins and repository modules", async () => {
  const closure = await sourceClosure(entrypoint);
  assert.ok(closure.visited.size >= 8, "expected the production entrypoint graph to traverse runtime/db modules");
  assert.deepEqual(closure.bare, []);
});

test("built Worker artifact declares no external npm runtime packages", async () => {
  const externalsPath = resolve(repoRoot, "dist/server/vinext-externals.json");
  const externals = JSON.parse(await readFile(externalsPath, "utf8"));
  assert.deepEqual(externals, []);
});
