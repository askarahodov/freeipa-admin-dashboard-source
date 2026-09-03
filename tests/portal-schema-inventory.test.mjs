import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = path.join(root, "db", "portal-schema.ts");
const restoreStageSchemaPath = path.join(root, "db", "portal-restore-stage-schema.ts");
const maintenanceSchemaPath = path.join(root, "db", "portal-maintenance-schema.ts");
const controlledFoundationSchemaPath = path.join(root, "db", "portal-migration-v4.ts");
const loginRateLimitSchemaPath = path.join(root, "db", "portal-login-rate-limit-schema.ts");

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

test("canonical schema inventories exist before runtime DDL can be adopted", async () => {
  assert.equal(fs.existsSync(schemaPath), true, "db/portal-schema.ts must define immutable migration v1 inventory");
  assert.equal(fs.existsSync(restoreStageSchemaPath), true, "migration v2 must define explicit restore-stage inventory");
  assert.equal(fs.existsSync(maintenanceSchemaPath), true, "migration v3 must define explicit maintenance inventory");
  assert.equal(fs.existsSync(controlledFoundationSchemaPath), true, "migration v4 must define explicit controlled-apply inventory");
  assert.equal(fs.existsSync(loginRateLimitSchemaPath), true, "migration v5 must define explicit login rate-limit inventory");
  const [schema, restoreStageSchema, maintenanceSchema, controlledFoundationSchema, loginRateLimitSchema] = await Promise.all([
    import(pathToFileURL(schemaPath).href),
    import(pathToFileURL(restoreStageSchemaPath).href),
    import(pathToFileURL(maintenanceSchemaPath).href),
    import(pathToFileURL(controlledFoundationSchemaPath).href),
    import(pathToFileURL(loginRateLimitSchemaPath).href),
  ]);
  assert.ok(schema.portalSchemaTableNames instanceof Set);
  assert.equal(typeof restoreStageSchema.portalRestoreStageTable?.name, "string");
  assert.equal(typeof maintenanceSchema.portalMaintenanceStateTable?.name, "string");
  assert.equal(typeof controlledFoundationSchema.portalMigrationOperationsTable?.name, "string");
  assert.equal(typeof loginRateLimitSchema.portalLoginRateLimitsTable?.name, "string");

  const canonicalTableNames = new Set([
    ...schema.portalSchemaTableNames,
    restoreStageSchema.portalRestoreStageTable.name,
    maintenanceSchema.portalMaintenanceStateTable.name,
    controlledFoundationSchema.portalMigrationOperationsTable.name,
    loginRateLimitSchema.portalLoginRateLimitsTable.name,
  ]);
  const missing = runtimeTableNames().filter((name) => !canonicalTableNames.has(name));
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
