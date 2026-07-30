import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const diagnosticsUrl = new URL("../worker/diagnostics-entry.ts", import.meta.url);
const source = fs.readFileSync(diagnosticsUrl, "utf8");

test("local admin diagnostics include sanitized migration readiness", async () => {
  assert.equal(source.includes('from "../db/portal-migrations"'), true);
  assert.equal(source.includes("inspectPortalSchema(sourceEnv)"), true);
  assert.equal(source.includes("schema: schemaDiagnostics(schema)"), true);

  const module = await import(diagnosticsUrl.href);
  const value = module.schemaDiagnostics({
    state: "incompatible",
    currentVersion: 0,
    latestVersion: 1,
    appliedVersions: [],
    pendingVersions: [1],
    compatibleDrift: ["table:plugin_data:extra"],
    incompatibleDrift: ["column:portal_users.username:missing"],
    errorCode: "schema_incompatible_drift",
    verifiedAt: 100,
    checksum: "must-not-leak",
    sql: "CREATE TABLE secret",
  });

  assert.deepEqual(value, {
    state: "incompatible",
    currentVersion: 0,
    latestVersion: 1,
    appliedVersions: [],
    pendingVersions: [1],
    compatibleDrift: ["table:plugin_data:extra"],
    incompatibleDrift: ["column:portal_users.username:missing"],
    errorCode: "schema_incompatible_drift",
    verifiedAt: 100,
  });
  assert.doesNotMatch(JSON.stringify(value), /checksum|CREATE TABLE|encrypted|password|token/i);
});

test("schema diagnostics preserve the existing admin-only local RBAC boundary", () => {
  assert.equal(source.includes('session.role !== "admin"'), true);
  assert.equal(source.includes('url.pathname === "/api/auth/diagnostics"'), true);
  assert.equal(source.includes('"cache-control": "no-store"'), true);
});
