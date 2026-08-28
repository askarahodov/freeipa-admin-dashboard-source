import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scanRoots = ["app", "worker", "tests", "scripts", "db", "e2e", "src"];
const sourceExtensions = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx"]);
const expectedLegacyConsumers = [
  "app/settings-policy-editors.tsx",
  "app/settings/SettingsScreens.tsx",
  "approval-gates.ts",
];

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

test("automation domain has canonical implementations and thin root compatibility shims", async () => {
  for (const canonical of [
    "src/automation/automation-types.ts",
    "src/automation/field-conditions.ts",
  ]) {
    assert.equal(await exists(canonical), true, `missing canonical automation module: ${canonical}`);
  }

  const shims = new Map([
    ["automation-types.ts", 'export * from "./src/automation/automation-types";\n'],
    ["field-conditions.ts", 'export * from "./src/automation/field-conditions";\n'],
  ]);
  for (const [relativePath, expected] of shims) {
    assert.equal(await readFile(path.join(repoRoot, relativePath), "utf8"), expected, `${relativePath} must remain a thin compatibility shim`);
  }
});

test("legacy automation imports are limited to the explicit migration allowlist", async () => {
  const files = [
    ...await collectRootSourceFiles(),
    ...(await Promise.all(scanRoots.map(collectSourceFiles))).flat(),
  ];
  const forbidden = [
    /(?:\.\.\/|\.\/)+automation-types(?:\.ts)?["']/,
    /(?:\.\.\/|\.\/)+field-conditions(?:\.ts)?["']/,
  ];

  const legacyConsumers = new Set();
  for (const relativePath of files) {
    if (["automation-types.ts", "field-conditions.ts", "tests/automation-domain-path-contract.test.mjs", "src/automation/field-conditions.ts"].includes(relativePath)) continue;
    const content = await readFile(path.join(repoRoot, relativePath), "utf8");
    if (forbidden.some((pattern) => pattern.test(content))) legacyConsumers.add(relativePath);
  }

  assert.deepEqual([...legacyConsumers].sort(), expectedLegacyConsumers, "legacy automation import set changed; migrate consumers or update this contract intentionally");
});
