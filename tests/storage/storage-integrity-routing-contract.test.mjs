import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const [
  localSecureSource,
  localRoutingSource,
  schemaEntrySource,
  maintenanceGateSource,
  securityCompositionSource,
  serviceAdminGateSource,
  authorizationSource,
  dockerfileSource,
  integrityServiceSource,
  quickCheckSource,
] = await Promise.all([
  readFile(new URL("../../worker/local-secure-entry.ts", import.meta.url), "utf8"),
  readFile(new URL("../../worker/middleware/local-security-routing.ts", import.meta.url), "utf8"),
  readFile(new URL("../../worker/schema-migrations-entry.ts", import.meta.url), "utf8"),
  readFile(new URL("../../worker/maintenance-mode-gate.ts", import.meta.url), "utf8"),
  readFile(new URL("../../worker/security-composition.ts", import.meta.url), "utf8"),
  readFile(new URL("../../worker/middleware/service-admin-authentication.ts", import.meta.url), "utf8"),
  readFile(new URL("../../src/auth/admin-session-authorization.ts", import.meta.url), "utf8"),
  readFile(new URL("../../Dockerfile", import.meta.url), "utf8"),
  readFile(new URL("../../src/storage/integrity/storage-integrity.ts", import.meta.url), "utf8"),
  readFile(new URL("../../src/storage/integrity/storage-quick-check.ts", import.meta.url), "utf8"),
]);

test("integrity route is dispatched only after local session and same-origin mutation boundaries", () => {
  assert.match(localSecureSource, /import secureRuntime from ["']\.\/settings-input-normalizer-entry(?:\.ts)?["']/);
  assert.match(localSecureSource, /import \{ handleStorageIntegrityRequest \} from ["']\.\/storage-integrity-entry\.ts["']/);
  assert.match(localSecureSource, /handleLocalSecurityRouting\(request, sourceEnv, ctx/);
  assert.match(localRoutingSource, /const session = await dependencies\.resolveSession\(env, request\)/);
  assert.match(localRoutingSource, /sameOriginAdminMutation\(request\)/);
  assert.match(localRoutingSource, /const delegatedRequest = new Request\(request, \{ headers \}\)/);
  assert.match(localRoutingSource, /dependencies\.handleStorageIntegrity\(delegatedRequest, delegated\)/);

  const sessionIndex = localRoutingSource.indexOf("const session = await dependencies.resolveSession(env, request)");
  const originIndex = localRoutingSource.indexOf("sameOriginAdminMutation(request)", sessionIndex);
  const delegatedRequestIndex = localRoutingSource.indexOf("const delegatedRequest = new Request(request, { headers })", sessionIndex);
  const sessionHandlerIndex = localRoutingSource.indexOf("dependencies.handleStorageIntegrity(delegatedRequest, delegated)", sessionIndex);
  assert.ok(sessionIndex >= 0 && originIndex > sessionIndex);
  assert.ok(delegatedRequestIndex > originIndex && sessionHandlerIndex > delegatedRequestIndex);

  const tokenCheckIndex = localRoutingSource.indexOf("serviceAdminTokenAuthorized(request, env.ADMIN_TOKEN)");
  const serviceHandlerIndex = localRoutingSource.indexOf("dependencies.handleStorageIntegrity(request, delegated)");
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
  assert.match(securityCompositionSource, /import compatibilityRuntime from ["']\.\/maintenance-control-root-entry(?:\.ts)?["']/);
  assert.match(securityCompositionSource, /middleware\/service-admin-authentication\.ts/);
  assert.match(serviceAdminGateSource, /serviceAdminTokenAuthorized\(request, env\.ADMIN_TOKEN\)/);
  assert.match(localSecureSource, /import secureRuntime from ["']\.\/settings-input-normalizer-entry(?:\.ts)?["']/);
  assert.match(localRoutingSource, /dependencies\.handleStorageStatus\(delegatedRequest, delegated\)/);
  assert.match(localRoutingSource, /dependencies\.handleStorageStatus\(request, env\)/);
  assert.match(dockerfileSource, /\/health\/live/);
  assert.equal(dockerfileSource.includes("/api/admin/storage/integrity/check"), false);
  assert.equal(dockerfileSource.includes("/api/admin/storage/status"), false);
});

test("integrity inspection source is fixed read-only SQL without request-controlled identifiers", () => {
  assert.equal(/request\.url|searchParams|request\.json\(/.test(integrityServiceSource), false);
  assert.match(integrityServiceSource, /inspectStorageQuickCheck/);
  assert.match(quickCheckSource, /PRAGMA quick_check\(1\)/);
  assert.match(integrityServiceSource, /FROM sqlite_schema WHERE type = 'index'/);
  const readOnlySource = `${integrityServiceSource}\n${quickCheckSource}`;
  assert.equal(
    /\b(?:INSERT\s+INTO|UPDATE\s+[^\s]+\s+SET|DELETE\s+FROM|CREATE\s+(?:TABLE|INDEX|TRIGGER)|ALTER\s+TABLE|DROP\s+(?:TABLE|INDEX|TRIGGER)|REPLACE\s+INTO|REINDEX|VACUUM|ANALYZE|PRAGMA\s+optimize)\b/i.test(readOnlySource),
    false,
  );
});
