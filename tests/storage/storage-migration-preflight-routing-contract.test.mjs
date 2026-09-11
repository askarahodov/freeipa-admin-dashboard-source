import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { isAdminIntegrationPath } from "../../src/auth/admin-session-authorization.ts";
import { STORAGE_MIGRATION_PREFLIGHT_PATH } from "../../src/storage/migration/preflight/storage-migration-preflight-contract.ts";

const [
  localSecureSource,
  localRoutingSource,
  schemaEntrySource,
  maintenanceGateSource,
  authorizationSource,
  preflightSource,
] = await Promise.all([
  readFile(new URL("../../worker/local-secure-entry.ts", import.meta.url), "utf8"),
  readFile(new URL("../../worker/middleware/local-security-routing.ts", import.meta.url), "utf8"),
  readFile(new URL("../../worker/schema-migrations-entry.ts", import.meta.url), "utf8"),
  readFile(new URL("../../worker/maintenance-mode-gate.ts", import.meta.url), "utf8"),
  readFile(new URL("../../src/auth/admin-session-authorization.ts", import.meta.url), "utf8"),
  readFile(new URL("../../src/storage/migration/preflight/storage-migration-preflight.ts", import.meta.url), "utf8"),
]);

test("migration preflight is dispatched only after service-token or local-session authorization", () => {
  assert.match(localSecureSource, /import \{ handleStorageMigrationPreflightRequest \} from ["']\.\/storage-migration-preflight-entry\.ts["']/);
  assert.match(localRoutingSource, /STORAGE_MIGRATION_PREFLIGHT_PATH/);

  const nonLocalPathIndex = localRoutingSource.indexOf("url.pathname === STORAGE_MIGRATION_PREFLIGHT_PATH");
  const tokenCheckIndex = localRoutingSource.indexOf("serviceAdminTokenAuthorized(request, env.ADMIN_TOKEN)", nonLocalPathIndex);
  const nonLocalHandlerIndex = localRoutingSource.indexOf("dependencies.handleStorageMigrationPreflight(request, delegated)", nonLocalPathIndex);
  assert.ok(nonLocalPathIndex >= 0 && tokenCheckIndex > nonLocalPathIndex);
  assert.ok(nonLocalHandlerIndex > tokenCheckIndex);

  const sessionIndex = localRoutingSource.indexOf("const session = await dependencies.resolveSession(env, request)");
  const originIndex = localRoutingSource.indexOf("sameOriginAdminMutation(request)", sessionIndex);
  const delegatedRequestIndex = localRoutingSource.indexOf("const delegatedRequest = new Request(request, { headers })", sessionIndex);
  const localHandlerIndex = localRoutingSource.indexOf("dependencies.handleStorageMigrationPreflight(delegatedRequest, delegated)", sessionIndex);
  assert.ok(sessionIndex >= 0 && originIndex > sessionIndex);
  assert.ok(delegatedRequestIndex > originIndex && localHandlerIndex > delegatedRequestIndex);

  const noSessionTokenIndex = localRoutingSource.indexOf("serviceAdminTokenAuthorized(request, env.ADMIN_TOKEN)", sessionIndex);
  const noSessionHandlerIndex = localRoutingSource.indexOf("dependencies.handleStorageMigrationPreflight(request, delegated)", noSessionTokenIndex);
  assert.ok(noSessionTokenIndex > sessionIndex && noSessionHandlerIndex > noSessionTokenIndex);
  assert.match(localSecureSource, /secureRuntime\.scheduled\?\.\(controller, env, ctx\)/);
});

test("migration preflight path is exact in admin and recovery allowlists", () => {
  assert.equal(isAdminIntegrationPath(STORAGE_MIGRATION_PREFLIGHT_PATH), true);
  assert.equal(isAdminIntegrationPath(`${STORAGE_MIGRATION_PREFLIGHT_PATH}/force`), false);
  assert.equal(isAdminIntegrationPath(`${STORAGE_MIGRATION_PREFLIGHT_PATH}/4`), false);

  assert.match(authorizationSource, /STORAGE_MIGRATION_PREFLIGHT_PATH/);
  assert.match(authorizationSource, /ADMIN_INTEGRATION_PATHS[\s\S]*STORAGE_MIGRATION_PREFLIGHT_PATH/);
  assert.match(schemaEntrySource, /STORAGE_MIGRATION_PREFLIGHT_PATH/);
  assert.match(maintenanceGateSource, /STORAGE_MIGRATION_PREFLIGHT_PATH/);

  const recoveryDispatch = schemaEntrySource.indexOf("url.pathname === STORAGE_MIGRATION_PREFLIGHT_PATH");
  const missingDatabaseGate = schemaEntrySource.indexOf("if (!sourceEnv.DB)");
  const schemaEvaluationGate = schemaEntrySource.indexOf("const schema = await portalSchema(sourceEnv)");
  assert.ok(recoveryDispatch >= 0 && recoveryDispatch < missingDatabaseGate);
  assert.ok(recoveryDispatch < schemaEvaluationGate);

  const preflightAllowlist = maintenanceGateSource.indexOf("STORAGE_MIGRATION_PREFLIGHT_PATH");
  const maintenanceRead = maintenanceGateSource.indexOf("const read = await readMaintenance");
  assert.ok(preflightAllowlist >= 0 && maintenanceRead > preflightAllowlist);
});

test("existing storage integrity status health and scheduled composition remains unchanged", () => {
  assert.match(localRoutingSource, /dependencies\.handleStorageIntegrity\(delegatedRequest, delegated\)/);
  assert.match(localRoutingSource, /dependencies\.handleStorageStatus\(delegatedRequest, delegated\)/);
  assert.match(schemaEntrySource, /STORAGE_STATUS_PATH/);
  assert.match(schemaEntrySource, /STORAGE_INTEGRITY_PATH/);
  assert.match(maintenanceGateSource, /STORAGE_STATUS_PATH/);
  assert.match(maintenanceGateSource, /STORAGE_INTEGRITY_PATH/);
  assert.match(localSecureSource, /secureRuntime\.scheduled\?\.\(controller, env, ctx\)/);
});

test("preflight evaluator remains read-only and cannot acquire the migration lock", () => {
  assert.equal(/request\.url|searchParams|request\.json\(/.test(preflightSource), false);
  assert.equal(/acquirePortalMigrationLock|renewPortalMigrationLock|releasePortalMigrationLock/.test(preflightSource), false);
  assert.equal(/ensurePortalSchema/.test(preflightSource), false);
  assert.equal(
    /\b(?:INSERT\s+INTO|UPDATE\s+[^\s]+\s+SET|DELETE\s+FROM|CREATE\s+(?:TABLE|INDEX|TRIGGER)|ALTER\s+TABLE|DROP\s+(?:TABLE|INDEX|TRIGGER)|REPLACE\s+INTO|REINDEX|VACUUM|ANALYZE|PRAGMA\s+optimize)\b/i.test(preflightSource),
    false,
  );
});
