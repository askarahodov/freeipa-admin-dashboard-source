import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  STORAGE_MIGRATION_APPLY_PATH,
  STORAGE_MIGRATION_APPLY_STATUS_PATH,
  STORAGE_MIGRATION_RECONCILE_PATH,
  isStorageMigrationApplyPath,
} from "../../src/storage/migration/apply/storage-migration-apply-contract.ts";

const [securityComposition, maintenanceGate, schemaEntry, handler] = await Promise.all([
  readFile(new URL("../../worker/security-composition.ts", import.meta.url), "utf8"),
  readFile(new URL("../../worker/maintenance-mode-gate.ts", import.meta.url), "utf8"),
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

test("security composition dispatches controlled migration handler before explicit maintenance", () => {
  const handlerIndex = securityComposition.indexOf("handleApply: handleStorageMigrationApplyRequest");
  const maintenanceIndex = securityComposition.indexOf("handleMaintenanceGate(");
  assert.ok(handlerIndex >= 0 && maintenanceIndex > handlerIndex);
  assert.equal(securityComposition.includes('from "./maintenance-mode-gate.ts"'), true);
  assert.equal(securityComposition.includes('from "./maintenance-mode-root-entry.ts"'), false);
  assert.equal(maintenanceGate.includes("handleStorageMigrationApplyRequest"), false);
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
