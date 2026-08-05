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
  integrityServiceSource,
] = await Promise.all([
  readFile(new URL("../worker/local-secure-entry.ts", import.meta.url), "utf8"),
  readFile(new URL("../worker/schema-migrations-entry.ts", import.meta.url), "utf8"),
  readFile(new URL("../worker/maintenance-mode-gate.ts", import.meta.url), "utf8"),
  readFile(new URL("../worker/service-admin-root-entry.ts", import.meta.url), "utf8"),
  readFile(new URL("../admin-session-authorization.ts", import.meta.url), "utf8"),
  readFile(new URL("../Dockerfile", import.meta.url), "utf8"),
  readFile(new URL("../storage-integrity.ts", import.meta.url), "utf8"),
]);

test("integrity route is dispatched only after local session and same-origin mutation boundaries", () => {
  assert.match(localSecureSource, /import secureRuntime from ["']\.\/settings-input-normalizer-entry(?:\.ts)?["']/);
  assert.match(localSecureSource, /import \{ handleStorageIntegrityRequest \} from ["']\.\/storage-integrity-entry\.ts["']/);
  assert.match(localSecureSource, /const session = await resolveLocalSession\(sourceEnv, request\)/);
  assert.match(localSecureSource, /sameOriginAdminMutation\(request\)/);
  assert.match(localSecureSource, /const delegatedRequest = new Request\(request, \{ headers \}\)/);
  assert.match(localSecureSource, /handleStorageIntegrityRequest\(delegatedRequest, delegated\)/);

  const sessionIndex = localSecureSource.indexOf("const session = await resolveLocalSession(sourceEnv, request)");
  const originIndex = localSecureSource.indexOf("sameOriginAdminMutation(request)");
  const delegatedRequestIndex = localSecureSource.indexOf("const delegatedRequest = new Request(request, { headers })");
  const sessionHandlerIndex = localSecureSource.indexOf("handleStorageIntegrityRequest(delegatedRequest, delegated)");
  assert.ok(sessionIndex >= 0 && originIndex > sessionIndex);
  assert.ok(delegatedRequestIndex > originIndex && sessionHandlerIndex > delegatedRequestIndex);

  const tokenCheckIndex = localSecureSource.indexOf("serviceAdminTokenAuthorized(request, sourceEnv.ADMIN_TOKEN)");
  const serviceHandlerIndex = localSecureSource.indexOf("handleStorageIntegrityRequest(request, delegated)");
  assert.ok(tokenCheckIndex >= 0 && serviceHandlerIndex > tokenCheckIndex);
  assert.match(localSecureSource, /secureRuntime\.scheduled\?\.\(controller, env, ctx\)/);
});

test("integrity route is exact for service-admin and available through recovery gates", () => {
  assert.match(authorizationSource, /STORAGE_INTEGRITY_PATH/);
  assert.match(authorizationSource, /ADMIN_INTEGRATION_PATHS[\s\S]*STORAGE_INTEGRITY_PATH/);
  assert.match(schemaEntrySource, /STORAGE_INTEGRITY_PATH/);
  assert.match(maintenanceGateSource, /STORAGE_INTEGRITY_PATH/);

  const recoveryDispatch = schemaEntrySource.indexOf("url.pathname === STORAGE_INTEGRITY_PATH");
  const missingDatabaseGate = schemaEntrySource.indexOf("if (!sourceEnv.DB)");
  const schemaEvaluationGate = schemaEntrySource.indexOf("const schema = await portalSchema(sourceEnv)");
  assert.ok(recoveryDispatch >= 0 && recoveryDispatch < missingDatabaseGate);
  assert.ok(recoveryDispatch < schemaEvaluationGate);

  const integrityAllowlist = maintenanceGateSource.indexOf("STORAGE_INTEGRITY_PATH");
  const maintenanceRead = maintenanceGateSource.indexOf("const read = await readMaintenance");
  assert.ok(integrityAllowlist >= 0 && maintenanceRead > integrityAllowlist);
});

test("existing service-admin settings health and storage-status contracts remain unchanged", () => {
  assert.match(serviceAdminSource, /import rootRuntime from ["']\.\/maintenance-control-root-entry(?:\.ts)?["']/);
  assert.match(localSecureSource, /import secureRuntime from ["']\.\/settings-input-normalizer-entry(?:\.ts)?["']/);
  assert.match(localSecureSource, /handleStorageStatusRequest\(delegatedRequest, delegated\)/);
  assert.match(localSecureSource, /handleStorageStatusRequest\(request, sourceEnv\)/);
  assert.match(dockerfileSource, /\/health\/live/);
  assert.equal(dockerfileSource.includes("/api/admin/storage/integrity/check"), false);
  assert.equal(dockerfileSource.includes("/api/admin/storage/status"), false);
});

test("integrity inspection source is fixed read-only SQL without request-controlled identifiers", () => {
  assert.equal(/request\.url|searchParams|request\.json\(/.test(integrityServiceSource), false);
  assert.match(integrityServiceSource, /PRAGMA quick_check\(1\)/);
  assert.match(integrityServiceSource, /FROM sqlite_schema WHERE type = 'index'/);
  assert.equal(
    /\b(?:INSERT\s+INTO|UPDATE\s+[^\s]+\s+SET|DELETE\s+FROM|CREATE\s+(?:TABLE|INDEX|TRIGGER)|ALTER\s+TABLE|DROP\s+(?:TABLE|INDEX|TRIGGER)|REPLACE\s+INTO|REINDEX|VACUUM|ANALYZE|PRAGMA\s+optimize)\b/i.test(integrityServiceSource),
    false,
  );
});
