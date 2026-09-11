import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  STORAGE_MIGRATION_APPLY_PATH,
  STORAGE_MIGRATION_APPLY_STATUS_PATH,
  STORAGE_MIGRATION_RECONCILE_PATH,
  isStorageMigrationApplyPath,
} from "../../src/storage/migration/apply/storage-migration-apply-contract.ts";

const [securityComposition, maintenanceRoot, schemaEntry, handler] = await Promise.all([
  readFile(new URL("../../worker/security-composition.ts", import.meta.url), "utf8"),
  readFile(new URL("../../worker/maintenance-mode-root-entry.ts", import.meta.url), "utf8"),
  readFile(new URL("../../worker/schema-migrations-entry.ts", import.meta.url), "utf8"),
  readFile(new URL("../../worker/storage-migration-apply-entry.ts", import.meta.url), "utf8"),
]);

const paths = [STORAGE_MIGRATION_APPLY_PATH, STORAGE_MIGRATION_APPLY_STATUS_PATH, STORAGE_MIGRATION_RECONCILE_PATH];

test("controlled migration paths are exact and recovery allowlisted before schema readiness", () => {
  for (const path of paths) {
    assert.equal(isStorageMigrationApplyPath(path), true);
    assert.equal(isStorageMigrationApplyPath(`${path}/force`), false);
  }
  assert.match(schemaEntry, /STORAGE_MIGRATION_APPLY_PATH/);
  assert.match(schemaEntry, /STORAGE_MIGRATION_APPLY_STATUS_PATH/);
  assert.match(schemaEntry, /STORAGE_MIGRATION_RECONCILE_PATH/);
  const recoveryIndex = schemaEntry.indexOf("STORAGE_MIGRATION_APPLY_PATH");
  assert.ok(recoveryIndex >= 0 && recoveryIndex < schemaEntry.indexOf("if (!sourceEnv.DB)"));
});

test("security composition dispatches controlled migration handler before remaining maintenance compatibility", () => {
  const handlerIndex = securityComposition.indexOf("handleApply: handleStorageMigrationApplyRequest");
  const downstreamIndex = securityComposition.indexOf("compatibilityRuntime.fetch(nextRequest, nextEnv, nextContext)");
  assert.ok(handlerIndex >= 0 && downstreamIndex > handlerIndex);
  assert.equal(maintenanceRoot.includes("handleStorageMigrationApplyRequest"), false);
  assert.equal(maintenanceRoot.includes("handleMaintenanceGate(request"), true);
});

test("handler authorizes service token or local admin session before bounded body parsing", () => {
  assert.match(handler, /serviceAdminTokenAuthorized\(request, env\.ADMIN_TOKEN\)/);
  assert.match(handler, /resolveLocalSession\(env, request\)/);
  assert.match(handler, /sameOriginAdminMutation\(request\)/);
  const access = handler.indexOf("dependencies.authorize");
  const body = handler.indexOf("await readInput(request)");
  assert.ok(access >= 0 && body > access);
  assert.match(handler, /getReader\(\)/);
  assert.match(handler, /reader\.cancel/);
  assert.doesNotMatch(handler, /request\.(?:json|text)\(/);
  assert.doesNotMatch(handler, /targetVersion|statements|sql/i);
});
