import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { handleHealthRequest } from "../worker/health-contracts.ts";

function pendingSchema() {
  return {
    state: "pending",
    currentVersion: 4,
    latestVersion: 5,
    appliedVersions: [1, 2, 3, 4],
    pendingVersions: [5],
    compatibleDrift: [],
    incompatibleDrift: [],
    errorCode: "schema_migration_pending",
    verifiedAt: 100,
  };
}

test("readiness reports exact controlled migration pending code", async () => {
  const response = await handleHealthRequest(
    new Request("http://portal.test/health/ready"),
    { DB: { prepare() {}, batch() {} } },
    { portalSchema: async () => pendingSchema(), fetchImpl: fetch },
  );
  assert.equal(response?.status, 503);
  const payload = await response.json();
  assert.equal(payload.code, "health_schema_unready");
  assert.equal(payload.metadata.schemaVersion, 4);
  assert.equal(payload.metadata.latestSchemaVersion, 5);
  assert.equal(payload.checks.find((check) => check.name === "schema")?.code, "schema_migration_pending");
});

test("schema gate continues to block every non-ready state and scheduled work", () => {
  const source = fs.readFileSync(new URL("../worker/schema-migrations-entry.ts", import.meta.url), "utf8");
  assert.equal(source.includes('schema.state !== "ready"'), true);
  assert.match(source, /if \(schema\.state !== "ready"\) return;/);
});

test("public schema type and production hardened runtime include pending and v5", () => {
  const managedSource = fs.readFileSync(new URL("../db/portal-controlled-migrations.ts", import.meta.url), "utf8");
  const hardenedSource = fs.readFileSync(new URL("../db/portal-migrations-hardened.ts", import.meta.url), "utf8");
  assert.match(managedSource, /ManagedPortalSchemaState = [^;]*"pending"/);
  assert.equal(hardenedSource.includes("portalMigrationsV5 as portalMigrations"), true);
  assert.equal(hardenedSource.includes("ensurePortalSchemaV5"), true);
  assert.equal(hardenedSource.includes("portalMigrationOperationsTable"), true);
  assert.equal(hardenedSource.includes("portalLoginRateLimitsTable"), true);
});
