import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const entry = new URL("../worker/schema-migrations-entry.ts", import.meta.url);
const vite = fs.readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");

test("Vite uses the schema migration boundary as the outer worker entry", () => {
  assert.equal(fs.existsSync(entry), true, "worker/schema-migrations-entry.ts must exist");
  assert.equal(vite.includes('main: "./worker/schema-migrations-entry.ts"'), true);
});

test("normal fetch and scheduled dispatch require a ready production schema", async () => {
  assert.equal(fs.existsSync(entry), true, "worker/schema-migrations-entry.ts must exist");
  const source = fs.readFileSync(entry, "utf8");
  assert.equal(source.includes('import rootRuntime from "./service-admin-root-entry.ts"'), true);
  assert.equal(source.includes("await ensurePortalSchema(sourceEnv)"), true);
  assert.equal(source.includes('schema.state !== "ready"'), true);
  assert.equal(source.includes("return rootRuntime.fetch(request, sourceEnv, ctx)"), true);
  assert.equal(source.includes("return rootRuntime.scheduled?.(controller, sourceEnv, ctx)"), true);
  assert.equal(source.indexOf("await ensurePortalSchema(sourceEnv)"), source.lastIndexOf("await ensurePortalSchema(sourceEnv)"));

  const module = await import(entry.href);
  assert.equal(module.migrationCapableDatabase(undefined), false);
  assert.equal(module.migrationCapableDatabase({ prepare() {} }), false);
  assert.equal(module.migrationCapableDatabase({ prepare() {}, batch() {} }), true);
});

test("recovery status requires constant-time service token authorization and returns safe fields", async () => {
  assert.equal(fs.existsSync(entry), true, "worker/schema-migrations-entry.ts must exist");
  const source = fs.readFileSync(entry, "utf8");
  assert.equal(source.includes('url.pathname === "/api/schema/status"'), true);
  assert.equal(source.includes("serviceAdminTokenAuthorized(request, sourceEnv.ADMIN_TOKEN)"), true);
  assert.equal(source.includes("publicPortalSchemaStatus(schema)"), true);
  assert.equal(source.includes("schema_authorization_required"), true);
  assert.equal(source.includes('"cache-control": "no-store"'), true);

  const module = await import(entry.href);
  const response = module.schemaFailureResponse({
    state: "incompatible",
    currentVersion: 0,
    latestVersion: 1,
    appliedVersions: [],
    pendingVersions: [1],
    compatibleDrift: [],
    incompatibleDrift: ["column:portal_users.username:missing"],
    errorCode: "schema_incompatible_drift",
    verifiedAt: 123,
  });
  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.equal(payload.code, "schema_incompatible_drift");
  assert.equal(JSON.stringify(payload).includes("CREATE TABLE"), false);
  assert.equal(JSON.stringify(payload).includes("checksum"), false);
});
