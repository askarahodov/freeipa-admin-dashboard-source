import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const [
  localSecureSource,
  schemaEntrySource,
  maintenanceGateSource,
  serviceAdminSource,
  authorizationSource,
  dockerfileSource,
  storageServiceSource,
] = await Promise.all([
  readFile(new URL("../worker/local-secure-entry.ts", import.meta.url), "utf8"),
  readFile(new URL("../worker/schema-migrations-entry.ts", import.meta.url), "utf8"),
  readFile(new URL("../worker/maintenance-mode-gate.ts", import.meta.url), "utf8"),
  readFile(new URL("../worker/service-admin-root-entry.ts", import.meta.url), "utf8"),
  readFile(new URL("../admin-session-authorization.ts", import.meta.url), "utf8"),
  readFile(new URL("../Dockerfile", import.meta.url), "utf8"),
  readFile(new URL("../storage-status.ts", import.meta.url), "utf8"),
]);

const storageRootSource = await readFile(
  new URL("../worker/storage-status-root-entry.ts", import.meta.url),
  "utf8",
);

test("storage route is composed below local-session authorization", () => {
  assert.match(localSecureSource, /import secureRuntime from ["']\.\/storage-status-root-entry(?:\.ts)?["']/);
  assert.match(storageRootSource, /import rootRuntime from ["']\.\/settings-input-normalizer-entry(?:\.ts)?["']/);
  assert.match(storageRootSource, /handleStorageStatusRequest\(request, sourceEnv\)/);

  const handlerIndex = storageRootSource.indexOf("handleStorageStatusRequest(request, sourceEnv)");
  const delegateIndex = storageRootSource.indexOf("rootRuntime.fetch(request, sourceEnv, ctx)");
  assert.ok(handlerIndex >= 0 && delegateIndex > handlerIndex);
  assert.match(storageRootSource, /rootRuntime\.scheduled\?\.\(controller, env, ctx\)/);
});

test("storage route is explicit for service-admin and recovery gates", () => {
  assert.match(authorizationSource, /STORAGE_STATUS_PATH/);
  assert.match(authorizationSource, /ADMIN_INTEGRATION_PATHS[\s\S]*STORAGE_STATUS_PATH/);
  assert.match(schemaEntrySource, /STORAGE_STATUS_PATH/);
  assert.match(maintenanceGateSource, /STORAGE_STATUS_PATH/);

  const recoveryDispatch = schemaEntrySource.indexOf("url.pathname === STORAGE_STATUS_PATH");
  const missingDatabaseGate = schemaEntrySource.indexOf("if (!sourceEnv.DB)");
  const schemaEvaluationGate = schemaEntrySource.indexOf("const schema = await portalSchema(sourceEnv)");
  assert.ok(recoveryDispatch >= 0 && recoveryDispatch < missingDatabaseGate);
  assert.ok(recoveryDispatch < schemaEvaluationGate);

  const immediateAllowlist = maintenanceGateSource.indexOf("immediatelyAllowedApiPaths");
  const maintenanceRead = maintenanceGateSource.indexOf("const read = await readMaintenance");
  assert.ok(immediateAllowlist >= 0 && maintenanceRead > immediateAllowlist);
});

test("existing service-admin and health contracts remain unchanged", () => {
  assert.match(serviceAdminSource, /import rootRuntime from ["']\.\/maintenance-control-root-entry(?:\.ts)?["']/);
  assert.match(dockerfileSource, /\/health\/live/);
  assert.equal(dockerfileSource.includes("/api/admin/storage/status"), false);
  assert.equal(dockerfileSource.includes("/metrics/health"), false);
});

test("storage inspection source cannot apply migrations or accept arbitrary SQL", () => {
  assert.equal(storageServiceSource.includes("ensurePortalSchema"), false);
  assert.match(storageServiceSource, /inspectPortalSchema/);
  assert.equal(/request\.url|searchParams|request\.json\(/.test(storageServiceSource), false);
  assert.equal(/\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|REPLACE)\b/i.test(storageServiceSource), false);
});
