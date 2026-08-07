import assert from "node:assert/strict";
import test from "node:test";

import {
  portalMigrationsV4,
  inspectPortalSchemaV4,
  ensurePortalSchemaV4,
} from "../db/portal-migrations-v4.ts";
import { validatePortalMigrationRegistry } from "../db/portal-migration-registry.ts";

test("production registry ends at automatic foundation version 4", () => {
  const validated = validatePortalMigrationRegistry(portalMigrationsV4);
  assert.deepEqual(
    validated.all.map(({ version, mode }) => ({ version, mode })),
    [
      { version: 1, mode: "automatic" },
      { version: 2, mode: "automatic" },
      { version: 3, mode: "automatic" },
      { version: 4, mode: "automatic" },
    ],
  );
  assert.deepEqual(validated.controlled, []);
  assert.equal(validated.all[3].name, "controlled-migration-foundation");
  assert.ok(validated.all[3].snapshot);
});

test("v4 exports hardened ensure and inspect entry points", () => {
  assert.equal(typeof ensurePortalSchemaV4, "function");
  assert.equal(typeof inspectPortalSchemaV4, "function");
});

test("v4 checksum material remains version, name and statements only", async () => {
  const migration = portalMigrationsV4[3];
  const material = JSON.stringify({
    version: migration.version,
    name: migration.name,
    statements: migration.statements,
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  const expected = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  assert.equal(await migration.checksum(), expected);
});
