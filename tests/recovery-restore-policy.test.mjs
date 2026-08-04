import test from "node:test";
import assert from "node:assert/strict";

import { PORTAL_BACKUP_DOMAINS } from "../backup-manifest.ts";
import { FULL_BACKUP_TABLES } from "../backup-full-domains.ts";
import {
  RECOVERY_CLEAR_TABLES,
  RECOVERY_PRESERVE_TABLES,
  RECOVERY_VALIDATE_ONLY_TABLES,
  createRecoveryRestorePolicy,
} from "../recovery-restore-policy.ts";

const allBackupTables = FULL_BACKUP_TABLES.flatMap(([, tables]) => tables.map((table) => table.name));

test("full restore requires every canonical backup domain", () => {
  const payloads = new Map(PORTAL_BACKUP_DOMAINS.map((domain) => [domain, { domain, schemaVersion: 3, tables: [] }]));
  payloads.delete("audit");
  assert.throws(
    () => createRecoveryRestorePolicy({ selectedDomains: [...payloads.keys()], backupTables: allBackupTables }),
    (error) => error.code === "recovery_backup_incomplete",
  );
});

test("policy classifies sessions and RBAC projection as validate-only", () => {
  const policy = createRecoveryRestorePolicy({
    selectedDomains: [...PORTAL_BACKUP_DOMAINS],
    backupTables: allBackupTables,
  });
  assert.deepEqual(policy.validateOnlyTables, [...RECOVERY_VALIDATE_ONLY_TABLES]);
  assert.ok(policy.validateOnlyTables.includes("portal_sessions"));
  assert.ok(policy.validateOnlyTables.includes("portal_role_assignments"));
  assert.ok(!policy.replaceTables.includes("portal_sessions"));
  assert.ok(!policy.replaceTables.includes("portal_role_assignments"));
});

test("policy preserves schema and maintenance metadata and clears runtime restore stages", () => {
  const policy = createRecoveryRestorePolicy({
    selectedDomains: [...PORTAL_BACKUP_DOMAINS],
    backupTables: allBackupTables,
  });
  assert.deepEqual(policy.preserveTables, [...RECOVERY_PRESERVE_TABLES]);
  assert.ok(policy.preserveTables.includes("portal_schema_migrations"));
  assert.ok(policy.preserveTables.includes("portal_maintenance_state"));
  assert.deepEqual(policy.clearTables, [...RECOVERY_CLEAR_TABLES]);
  assert.ok(policy.clearTables.includes("portal_backup_restore_stages"));
});

test("policy has deterministic dependency-safe ordering", () => {
  const policy = createRecoveryRestorePolicy({
    selectedDomains: [...PORTAL_BACKUP_DOMAINS],
    backupTables: allBackupTables,
  });
  assert.equal(new Set(policy.replaceTables).size, policy.replaceTables.length);
  assert.deepEqual(policy.deleteOrder, [...policy.replaceTables].reverse());
  assert.deepEqual(policy.insertOrder, policy.replaceTables);
  assert.ok(policy.insertOrder.indexOf("operation_runs") < policy.insertOrder.indexOf("operation_run_results"));
  assert.ok(policy.insertOrder.indexOf("operation_approvals") < policy.insertOrder.indexOf("operation_approval_decisions"));
});

test("unknown or missing backup tables fail before mutation", () => {
  assert.throws(
    () => createRecoveryRestorePolicy({
      selectedDomains: [...PORTAL_BACKUP_DOMAINS],
      backupTables: [...allBackupTables, "unexpected_table"],
    }),
    (error) => error.code === "recovery_backup_layout_invalid",
  );
  assert.throws(
    () => createRecoveryRestorePolicy({
      selectedDomains: [...PORTAL_BACKUP_DOMAINS],
      backupTables: allBackupTables.filter((name) => name !== "portal_users"),
    }),
    (error) => error.code === "recovery_backup_layout_invalid",
  );
});
