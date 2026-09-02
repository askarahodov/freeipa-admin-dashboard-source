import test from "node:test";
import assert from "node:assert/strict";

import { FULL_BACKUP_TABLES } from "../backup-full-domains.ts";
import { stageIsolatedRestore } from "../src/backup/restore/backup-isolated-store.ts";
import {
  BackupIsolatedVerificationError,
  verifyIsolatedRestore,
} from "../src/backup/restore/backup-isolated-verification.ts";

function payload(domain, rowsByTable = {}) {
  const definitions = FULL_BACKUP_TABLES.find(([item]) => item === domain)[1];
  return {
    domain,
    schemaVersion: 1,
    tables: definitions.map((table) => ({
      name: table.name,
      columns: [...table.columns],
      primaryKey: [...table.primaryKey],
      rows: rowsByTable[table.name] ?? [],
    })),
  };
}

function options(overrides = {}) {
  return {
    sourceSchemaVersion: 1,
    currentSchemaVersion: 1,
    preview: { canRestore: true, requiredMigrations: [], summary: { conflict: 0 } },
    ...overrides,
  };
}

test("verifies local auth sessions and matching RBAC assignments", () => {
  const store = stageIsolatedRestore(new Map([
    ["local-auth", payload("local-auth", {
      portal_users: [["u1", "admin", "Admin", "hash", "salt", 210000, "admin", 0, 0, null, 1, 2, null]],
      portal_sessions: [["s1", "u1", "token-hash", 1, 2, 3, "ua"]],
    })],
    ["rbac", payload("rbac", {
      portal_role_assignments: [["u1", "admin", "admin", 0, 2]],
    })],
  ]));

  const result = verifyIsolatedRestore(store, options());
  assert.equal(result.canCommit, true);
  assert.equal(result.summary.records, 3);
  assert.equal(result.summary.warnings, 0);
  assert.deepEqual(result.domains.map((item) => item.domain), ["local-auth", "rbac"]);
  assert.ok(result.domains[0].checks.includes("local-auth-integrity"));
  assert.ok(result.domains[1].checks.includes("rbac-consistency"));
  assert.doesNotMatch(JSON.stringify(result), /u1|admin@|token-hash|password|salt|hash/);
});

test("returns a fixed dependency warning when RBAC is tested without local auth", () => {
  const store = stageIsolatedRestore(new Map([
    ["rbac", payload("rbac", {
      portal_role_assignments: [["u1", "admin", "admin", 0, 2]],
    })],
  ]));
  const result = verifyIsolatedRestore(store, options());
  assert.deepEqual(result.domains[0].warnings, ["dependency_not_selected:local-auth"]);
  assert.equal(result.summary.warnings, 1);
  assert.equal(result.canCommit, true);
});

test("rejects broken session and RBAC references without exposing row identifiers", () => {
  const cases = [
    new Map([["local-auth", payload("local-auth", {
      portal_users: [["u1", "admin", "Admin", "hash", "salt", 210000, "admin", 0, 0, null, 1, 2, null]],
      portal_sessions: [["s1", "missing", "token-hash", 1, 2, 3, "ua"]],
    })]]),
    new Map([
      ["local-auth", payload("local-auth", {
        portal_users: [["u1", "admin", "Admin", "hash", "salt", 210000, "viewer", 0, 0, null, 1, 2, null]],
      })],
      ["rbac", payload("rbac", {
        portal_role_assignments: [["u1", "admin", "admin", 0, 2]],
      })],
    ]),
  ];

  for (const candidate of cases) {
    assert.throws(
      () => verifyIsolatedRestore(stageIsolatedRestore(candidate), options()),
      (error) => error instanceof BackupIsolatedVerificationError
        && error.code === "backup_test_restore_failed"
        && error.status === 422
        && !/u1|missing|token/i.test(error.message),
    );
  }
});

test("validates JSON fields and intra-domain operation and approval references", () => {
  const store = stageIsolatedRestore(new Map([
    ["settings", payload("settings", {
      app_settings: [["main", '{"demoMode":false}', "encrypted", 1]],
      portal_settings_drafts: [["d1", 1, "{}", "", "draft", "{}", "admin", 1, 1, null, null]],
      portal_settings_apply_commits: [["c1", "d1", 2, "{}", "", 2]],
      portal_settings_revisions: [["r1", 2, "{}", "", "d1", "admin", "apply", "active", "[]", 2]],
      portal_settings_draft_resets: [["d1", "[]", 1]],
    })],
    ["operations", payload("operations", {
      operation_runs: [["run1", "job1", "event1", "Title", "xyops", "live", "success", "admin", "subject", null, "[]", 1, 2, 2]],
      operation_run_results: [["run1", "job1", "ok", "[]", "[]", "[]", null, 0, 2]],
      operation_run_replays: [["run1", "event1", "1", "encrypted", 1, null, null, 2]],
      operation_notifications: [["n1", "run1", "success", "Done", "Done", 2]],
      operation_notification_reads: [["n1", "admin", 2]],
    })],
    ["approvals", payload("approvals", {
      operation_approvals: [["a1", "event1", "Approve", "danger", "1", "requester", "operator", "[]", "pending", 1, "[]", "[]", 1, "rule", "{}", "encrypted", "fingerprint", 10, 1, 1, null, null, null, null, null]],
      operation_approval_decisions: [["a1", "approver", "admin", "approve", null, 2]],
    })],
  ]));

  const result = verifyIsolatedRestore(store, options());
  assert.equal(result.canCommit, true);
  assert.ok(result.domains.find((item) => item.domain === "settings").checks.includes("settings-consistency"));
  assert.ok(result.domains.find((item) => item.domain === "operations").checks.includes("operation-references"));
  assert.ok(result.domains.find((item) => item.domain === "approvals").checks.includes("approval-references"));
});

test("rejects invalid JSON and prevents commit when preview is not restorable", () => {
  const invalid = stageIsolatedRestore(new Map([
    ["settings", payload("settings", {
      app_settings: [["main", "{invalid", "encrypted", 1]],
    })],
  ]));
  assert.throws(
    () => verifyIsolatedRestore(invalid, options()),
    (error) => error instanceof BackupIsolatedVerificationError
      && error.message === "Backup test restore consistency check failed",
  );

  const valid = stageIsolatedRestore(new Map([["audit", payload("audit")]]));
  const result = verifyIsolatedRestore(valid, options({
    preview: { canRestore: false, requiredMigrations: [2], summary: { conflict: 1 } },
  }));
  assert.equal(result.canCommit, false);
});
