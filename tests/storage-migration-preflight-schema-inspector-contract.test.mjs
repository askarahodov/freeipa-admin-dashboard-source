import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const [migrationSource, preflightSource] = await Promise.all([
  readFile(new URL("../db/portal-migrations.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/storage/migration/preflight/storage-migration-preflight.ts", import.meta.url), "utf8"),
]);

test("preflight reuses canonical schema constraint index trigger and extra-object rules", () => {
  assert.match(migrationSource, /export async function inspectPortalSchemaSnapshot\(/);
  assert.match(preflightSource, /import \{[\s\S]*inspectPortalSchemaSnapshot[\s\S]*\} from ["']\.\.\/\.\.\/\.\.\/\.\.\/db\/portal-migrations\.ts["']/);
  assert.match(preflightSource, /inspectPortalSchemaSnapshot\(env\.DB, snapshot\)/);
  assert.equal(/async function tableStructureCompatible\(/.test(preflightSource), false);
  assert.equal(/PRAGMA table_info/.test(preflightSource), false);
});
