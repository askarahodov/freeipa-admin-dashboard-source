import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = path.join(root, "db", "portal-schema.ts");

function sourceFiles(directory) {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if ([".git", "node_modules", "dist", ".next", ".wrangler", "artifacts"].includes(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...sourceFiles(absolute));
    else if (/\.(?:ts|mjs)$/.test(entry.name)) result.push(absolute);
  }
  return result;
}

function runtimeTableNames() {
  const names = new Set();
  for (const file of sourceFiles(root)) {
    if (file === schemaPath || file.includes(`${path.sep}tests${path.sep}`)) continue;
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([A-Za-z_][A-Za-z0-9_]*)/gi)) names.add(match[1]);
  }
  return [...names].sort();
}

test("canonical schema inventory exists before runtime DDL can be adopted", async () => {
  assert.equal(fs.existsSync(schemaPath), true, "db/portal-schema.ts must define the canonical schema inventory");
  const schema = await import(pathToFileURL(schemaPath).href);
  assert.ok(schema.portalSchemaTableNames instanceof Set);

  const missing = runtimeTableNames().filter((name) => !schema.portalSchemaTableNames.has(name));
  assert.deepEqual(missing, [], `runtime tables missing from canonical inventory: ${missing.join(", ")}`);
});

test("baseline owns migration infrastructure and contains no destructive or data-changing SQL", async () => {
  assert.equal(fs.existsSync(schemaPath), true, "db/portal-schema.ts must define baseline SQL");
  const schema = await import(pathToFileURL(schemaPath).href);
  assert.equal(schema.portalSchemaTableNames.has("portal_schema_migrations"), true);
  assert.equal(schema.portalSchemaTableNames.has("portal_schema_lock"), true);
  assert.ok(Array.isArray(schema.portalBaselineStatements));
  assert.ok(schema.portalBaselineStatements.length > 20);

  const unsafe = schema.portalBaselineStatements.filter((statement) => /^\s*(?:DROP|DELETE|UPDATE|INSERT\s+INTO)\b|ALTER\s+TABLE/i.test(statement));
  assert.deepEqual(unsafe, [], `automatic baseline contains unsafe SQL: ${unsafe.join(" | ")}`);
});
