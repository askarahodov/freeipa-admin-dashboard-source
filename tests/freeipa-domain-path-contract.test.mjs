import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scanRoots = ["app", "worker", "tests"];
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

async function exists(relativePath) {
  try {
    await stat(path.join(repoRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}

test("FreeIPA domain modules have one canonical implementation path", async () => {
  for (const canonical of [
    "src/freeipa/freeipa-user-query.ts",
    "src/freeipa/freeipa-group-member-query.ts",
    "src/freeipa/freeipa-ui-events.ts",
  ]) {
    assert.equal(await exists(canonical), true, `missing canonical FreeIPA module: ${canonical}`);
  }

  for (const removedRoot of ["freeipa-user-query.ts", "freeipa-group-member-query.ts"]) {
    assert.equal(await exists(removedRoot), false, `legacy root FreeIPA module returned: ${removedRoot}`);
  }

  const compatibilityShim = await readFile(path.join(repoRoot, "freeipa-ui-events.ts"), "utf8");
  assert.equal(
    compatibilityShim.trim(),
    'export * from "./src/freeipa/freeipa-ui-events.ts";',
    "root FreeIPA UI events file must remain a compatibility-only re-export while legacy application consumers remain",
  );
});

test("application, workers and tests do not reference removed FreeIPA root query paths", async () => {
  const files = (await Promise.all(scanRoots.map(collectSourceFiles))).flat();
  const forbidden = [
    /(?:\.\.\/)+freeipa-user-query(?:\.ts)?["']/,
    /(?:\.\.\/)+freeipa-group-member-query(?:\.ts)?["']/,
  ];

  const violations = [];
  for (const relativePath of files) {
    if (relativePath === "tests/freeipa-domain-path-contract.test.mjs") continue;
    const content = await readFile(path.join(repoRoot, relativePath), "utf8");
    for (const pattern of forbidden) {
      if (pattern.test(content)) violations.push(relativePath);
    }
  }

  assert.deepEqual(violations, [], `legacy FreeIPA root query path references found: ${violations.join(", ")}`);
});

test("temporary FreeIPA UI events root shim has an explicit shrinking application allowlist", async () => {
  const files = (await Promise.all(scanRoots.map(collectSourceFiles))).flat();
  const consumers = [];

  for (const relativePath of files) {
    if (relativePath === "tests/freeipa-domain-path-contract.test.mjs") continue;
    const content = await readFile(path.join(repoRoot, relativePath), "utf8");
    if (/(?:\.\.\/)+freeipa-ui-events(?:\.ts)?["']/.test(content)) consumers.push(relativePath);
  }

  consumers.sort();
  assert.deepEqual(
    consumers,
    ["app/page.tsx"],
    `temporary FreeIPA UI events shim consumers changed: ${consumers.join(", ")}`,
  );
});
