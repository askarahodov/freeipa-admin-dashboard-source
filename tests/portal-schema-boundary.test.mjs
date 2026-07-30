import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const entry = new URL("../worker/schema-migrations-entry.ts", import.meta.url);
const helpers = new URL("../worker/schema-migrations-boundary.ts", import.meta.url);
const vite = fs.readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
const testsDirectory = path.dirname(fileURLToPath(import.meta.url));

test("Vite uses the schema migration boundary as the outer worker entry", () => {
  assert.equal(fs.existsSync(entry), true, "worker/schema-migrations-entry.ts must exist");
  assert.equal(vite.includes('main: "./worker/schema-migrations-entry.ts"'), true);
});

test("normal fetch and scheduled dispatch require a ready production schema", async () => {
  const source = fs.readFileSync(entry, "utf8");
  assert.equal(source.includes('import rootRuntime from "./service-admin-root-entry.ts"'), true);
  assert.equal(source.includes('from "./schema-migrations-boundary.ts"'), true);
  assert.equal(source.includes("await ensurePortalSchema(sourceEnv)"), true);
  assert.equal(source.includes('schema.state !== "ready"'), true);
  assert.equal(source.includes("schemaTestBypassEnabled(sourceEnv)"), true);
  assert.equal(source.includes("return schemaFailureResponse(await portalSchema(sourceEnv))"), true);
  assert.equal(source.includes("return rootRuntime.fetch(request, sourceEnv, ctx)"), true);
  assert.equal(source.includes("return rootRuntime.scheduled?.(controller, sourceEnv, ctx)"), true);
  assert.equal(source.includes("NODE_TEST_CONTEXT"), false);

  const boundaryHelpers = await import(helpers.href);
  assert.equal(boundaryHelpers.migrationCapableDatabase(undefined), false);
  assert.equal(boundaryHelpers.migrationCapableDatabase({ prepare() {} }), false);
  assert.equal(boundaryHelpers.migrationCapableDatabase({ prepare() {}, batch() {} }), true);
  assert.equal(boundaryHelpers.schemaTestBypassEnabled({}), false);
  assert.equal(boundaryHelpers.schemaTestBypassEnabled({ NODE_TEST_CONTEXT: "child-v8" }), false);
  const marked = boundaryHelpers.markSchemaTestBypass({});
  assert.equal(boundaryHelpers.schemaTestBypassEnabled(marked), true);
  assert.deepEqual(Object.keys(marked), []);
});

test("recovery status requires constant-time service token authorization and returns safe fields", async () => {
  const source = fs.readFileSync(entry, "utf8");
  const helperSource = fs.readFileSync(helpers, "utf8");
  assert.equal(source.includes('url.pathname === "/api/schema/status"'), true);
  assert.equal(source.includes("serviceAdminTokenAuthorized(request, sourceEnv.ADMIN_TOKEN)"), true);
  assert.equal(source.includes("schemaStatusResponse(await portalSchema(sourceEnv))"), true);
  assert.equal(source.indexOf('url.pathname === "/api/schema/status"') < source.indexOf("if (!sourceEnv.DB)"), true);
  assert.equal(helperSource.includes("publicPortalSchemaStatus(schema)"), true);
  assert.equal(helperSource.includes("schema_authorization_required"), true);
  assert.equal(helperSource.includes('"cache-control": "no-store"'), true);

  const boundaryHelpers = await import(helpers.href);
  const response = boundaryHelpers.schemaFailureResponse({
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

test("no test still treats service-admin-root as the outer Vite entry", () => {
  const stale = [];
  for (const name of fs.readdirSync(testsDirectory).filter((value) => value.endsWith(".test.mjs"))) {
    if (name === path.basename(fileURLToPath(import.meta.url))) continue;
    const source = fs.readFileSync(path.join(testsDirectory, name), "utf8");
    if (/\.includes\(\s*["'][^"']*worker\/service-admin-root-entry\.ts["']\s*\)/.test(source)) stale.push(name);
  }
  assert.deepEqual(stale, [], `stale outer worker entry assertions: ${stale.join(", ")}`);
});
