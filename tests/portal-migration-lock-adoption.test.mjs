import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../db/portal-migrations.ts", import.meta.url), "utf8");

test("startup migration uses only the shared portal migration lock implementation", () => {
  const sharedLockImport = source.match(
    /import\s*\{([^}]*)\}\s*from ["']\.\/portal-migration-lock\.ts["']/,
  );
  assert.ok(sharedLockImport);
  assert.deepEqual(
    sharedLockImport[1]
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean)
      .sort(),
    [
      "acquirePortalMigrationLock",
      "releasePortalMigrationLock",
      "renewPortalMigrationLock",
    ].sort(),
  );
  assert.equal(/async function acquireLock\(/.test(source), false);
  assert.equal(/async function renewLock\(/.test(source), false);
  assert.equal(/async function releaseLock\(/.test(source), false);
  assert.equal(/DELETE FROM portal_schema_lock WHERE id = \? AND acquired_at < \?/.test(source), false);
  assert.equal(/INSERT OR IGNORE INTO portal_schema_lock/.test(source), false);
  assert.equal(/UPDATE portal_schema_lock SET acquired_at/.test(source), false);
  assert.equal(/DELETE FROM portal_schema_lock WHERE id = \? AND owner = \?/.test(source), false);
});
