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
  readFile(new URL("../src/auth/admin-session-authorization.ts", import.meta.url), "utf8"),
  readFile(new URL("../Dockerfile", import.meta.url), "utf8"),
  readFile(new URL("../src/storage/status/storage-status.ts", import.meta.url), "utf8"),
]);

test("storage route is dispatched only after the existing local-session boundary", () => {
  assert.match(localSecureSource, /import secureRuntime from ["']\.\/settings-input-normalizer-entry(?:\.ts)?["']/);
  assert.match(localSecureSource, /import \{ handleStorageStatusRequest \} from ["']\.\/storage-status-entry\.ts["']/);
  assert.match(localSecureSource, /const session = await resolveLocalSession\(sourceEnv, request\)/);
  assert.match(localSecureSource, /const delegatedRequest = new Request\(request, \{ headers \}\)/);
  assert.match(localSecureSource, /handleStorageStatusRequest\(delegatedRequest, delegated\)/);

  const sessionIndex = localSecureSource.indexOf("const session = await resolveLocalSession(sourceEnv, request)");
  const delegatedRequestIndex = localSecureSource.indexOf("const delegatedRequest = new Request(request, { headers })");
  const sessionHandlerIndex = localSecureSource.indexOf("handleStorageStatusRequest(delegatedRequest, delegated)");
  assert.ok(sessionIndex >= 0 && delegatedRequestIndex > sessionIndex && sessionHandlerIndex > delegatedRequestIndex);

  const tokenCheckIndex = localSecureSource.indexOf("serviceAdminTokenAuthorized(request, sourceEnv.ADMIN_TOKEN)");
  const serviceHandlerIndex = localSecureSource.indexOf("handleStorageStatusRequest(request, delegated)");
  assert.ok(tokenCheckIndex >= 0 && serviceHandlerIndex > tokenCheckIndex);
  assert.match(localSecureSource, /secureRuntime\.scheduled\?\.\(controller, env, ctx\)/);
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

test("existing service-admin, settings and health contracts remain unchanged", () => {
  assert.match(serviceAdminSource, /import rootRuntime from ["']\.\/maintenance-control-root-entry(?:\.ts)?["']/);
  assert.match(localSecureSource, /import secureRuntime from ["']\.\/settings-input-normalizer-entry(?:\.ts)?["']/);
  assert.match(dockerfileSource, /\/health\/live/);
  assert.equal(dockerfileSource.includes("/api/admin/storage/status"), false);
  assert.equal(dockerfileSource.includes("/metrics/health"), false);
});

test("storage inspection source cannot apply migrations or accept arbitrary SQL", () => {
  assert.equal(storageServiceSource.includes("ensurePortalSchema"), false);
  assert.match(storageServiceSource, /inspectPortalSchema/);
  assert.equal(/request\.url|searchParams|request\.json\(/.test(storageServiceSource), false);
  assert.equal(
    /\b(?:INSERT\s+INTO|UPDATE\s+[^\s]+\s+SET|DELETE\s+FROM|CREATE\s+(?:TABLE|INDEX|TRIGGER)|ALTER\s+TABLE|DROP\s+(?:TABLE|INDEX|TRIGGER)|REPLACE\s+INTO)\b/i.test(storageServiceSource),
    false,
  );
});
