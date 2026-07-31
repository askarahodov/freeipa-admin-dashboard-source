import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const ignoredDirectories = new Set([
  ".git",
  ".next",
  ".wrangler",
  "dist",
  "node_modules",
  "tests",
]);
const ddlOwners = new Set([
  "db/portal-migration-v1.ts",
  "db/portal-migration-v2.ts",
  "db/portal-migrations.ts",
  "db/portal-migrations-v2.ts",
  "db/portal-restore-stage-schema.ts",
  "db/portal-schema.ts",
]);
const schemaChangingSql = /\b(?:CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX|TRIGGER)|ALTER\s+TABLE|DROP\s+(?:TABLE|INDEX|TRIGGER)|REINDEX)\b/gi;

async function productionTypeScriptFiles(directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await productionTypeScriptFiles(absolute));
    else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(absolute);
  }
  return files;
}

function lineNumber(source, offset) {
  return source.slice(0, offset).split("\n").length;
}

test("runtime production sources do not own schema-changing SQL", async () => {
  const violations = [];
  for (const absolute of await productionTypeScriptFiles()) {
    const relative = path.relative(root, absolute).replaceAll(path.sep, "/");
    if (ddlOwners.has(relative)) continue;
    const source = await readFile(absolute, "utf8");
    for (const match of source.matchAll(schemaChangingSql)) {
      violations.push(`${relative}:${lineNumber(source, match.index ?? 0)}:${match[0].replace(/\s+/g, " ")}`);
    }
  }
  assert.deepEqual(violations, [], `Schema-changing SQL is owned only by canonical migrations:\n${violations.join("\n")}`);
});
