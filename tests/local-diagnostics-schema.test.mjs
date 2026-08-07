import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { publicPortalSchemaStatus } from "../db/portal-migrations.ts";

const diagnosticsUrl = new URL("../worker/diagnostics-entry.ts", import.meta.url);
const source = fs.readFileSync(diagnosticsUrl, "utf8");

test("local admin diagnostics include sanitized migration readiness", () => {
  assert.equal(source.includes('from "../db/portal-migrations.ts"'), true);
  assert.equal(source.includes("inspectPortalSchema(env)"), true);
  assert.equal(source.includes("schema: schemaDiagnostics(schema)"), true);
  assert.equal(source.includes("export function schemaDiagnostics"), true);
  assert.equal(source.includes("return publicPortalSchemaStatus(schema)"), true);

  const value = publicPortalSchemaStatus({
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

test("diagnostics expose sanitized build and dependency versions", () => {
  assert.equal(source.includes('import packageMetadata from "../package.json"'), true);
  assert.equal(source.includes("build: buildDiagnostics()"), true);
  const buildBlock = source.match(/export function buildDiagnostics\(\) \{([\s\S]*?)\n\}/u)?.[1] ?? "";
  assert.notEqual(buildBlock, "", "buildDiagnostics body must be present");
  for (const key of ["version", "next", "react", "vinext", "vite", "wrangler"]) {
    assert.equal(buildBlock.includes(`${key}:`), true, key);
  }
  assert.doesNotMatch(buildBlock, /password|token|secret|CONFIG_ENCRYPTION_KEY/iu);
});
