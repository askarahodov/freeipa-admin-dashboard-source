import assert from "node:assert/strict";
import test from "node:test";

import { buildSelectiveRestoreStatements } from "../backup-selective-write-plan.ts";
import { validateSelectiveRestoreDomains } from "../backup-selective-restore-policy.ts";

class FakeStatement {
  constructor(sql) {
    this.sql = sql;
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }
}

class FakeDb {
  constructor() {
    this.prepared = [];
  }

  prepare(sql) {
    const statement = new FakeStatement(sql);
    this.prepared.push(statement);
    return statement;
  }
}

const guard = {
  id: "restore_11111111-1111-4111-8111-111111111111",
  actorIdentity: "admin",
  stageSecretHash: "1".repeat(64),
  now: 10_000,
};
const audit = {
  id: "audit-restore-1",
  createdAt: 10_000,
  correlationId: "restore-correlation",
  actorIdentity: "admin",
  actorRole: "admin",
  actorGroupsJson: "[]",
  action: "backup.restore.commit",
  resourceType: "portal_backup",
  resourceId: guard.id,
  schemaVersion: "1",
  outcome: "success",
  metadataJson: "{\"domains\":[\"policies\"]}",
};
const policiesPayload = {
  domain: "policies",
  schemaVersion: 1,
  tables: [
    {
      name: "catalog_visibility_policies",
      columns: ["id", "policy_json", "updated_at"],
      primaryKey: ["id"],
      rows: [["visibility", "{}", 1]],
    },
    {
      name: "approval_policy_sets",
      columns: ["id", "policy_json", "updated_at"],
      primaryKey: ["id"],
      rows: [["approval", "{}", 2]],
    },
    {
      name: "process_presentation_sets",
      columns: ["id", "metadata_json", "updated_at"],
      primaryKey: ["id"],
      rows: [["presentation", "{}", 3]],
    },
  ],
};
const localAuthPayload = {
  domain: "local-auth",
  schemaVersion: 1,
  tables: [
    {
      name: "portal_users",
      columns: ["id", "username", "display_name", "password_hash", "password_salt", "password_iterations", "role", "disabled", "failed_attempts", "locked_until", "created_at", "updated_at", "last_login_at"],
      primaryKey: ["id"],
      rows: [["user-1", "admin", "Admin", "hash", "salt", 210000, "admin", 0, 0, null, 1, 1, null]],
    },
    {
      name: "portal_sessions",
      columns: ["id", "user_id", "token_hash", "created_at", "last_seen_at", "expires_at", "user_agent"],
      primaryKey: ["id"],
      rows: [["session-1", "user-1", "token-hash", 1, 1, 2, "browser"]],
    },
  ],
};

test("builds one guarded claim delete insert audit and commit sequence", () => {
  const db = new FakeDb();
  const statements = buildSelectiveRestoreStatements(
    db,
    guard,
    validateSelectiveRestoreDomains(["policies"]),
    new Map([["policies", policiesPayload]]),
    audit,
  );
  assert.equal(statements, db.prepared);
  assert.equal(statements.length, 9);
  assert.match(statements[0].sql, /^UPDATE portal_backup_restore_stages SET status = 'committing'/);
  assert.deepEqual(statements[0].values, [guard.now, guard.id, guard.actorIdentity, guard.stageSecretHash, guard.now]);

  assert.match(statements[1].sql, /^DELETE FROM process_presentation_sets WHERE EXISTS/);
  assert.match(statements[2].sql, /^DELETE FROM approval_policy_sets WHERE EXISTS/);
  assert.match(statements[3].sql, /^DELETE FROM catalog_visibility_policies WHERE EXISTS/);
  assert.match(statements[4].sql, /^INSERT INTO catalog_visibility_policies \(id, policy_json, updated_at\) SELECT \?, \?, \? WHERE EXISTS/);
  assert.deepEqual(statements[4].values.slice(0, 3), ["visibility", "{}", 1]);
  assert.match(statements[5].sql, /^INSERT INTO approval_policy_sets/);
  assert.match(statements[6].sql, /^INSERT INTO process_presentation_sets/);
  assert.match(statements[7].sql, /^INSERT INTO portal_audit_events/);
  assert.match(statements[8].sql, /^UPDATE portal_backup_restore_stages SET status = 'committed'/);

  for (const statement of statements.slice(1, -1)) {
    assert.match(statement.sql, /status = 'committing'/);
    assert.equal(statement.sql.includes("SELECT *"), false);
  }
});

test("revokes sessions and never inserts historical session rows", () => {
  const db = new FakeDb();
  const statements = buildSelectiveRestoreStatements(
    db,
    guard,
    validateSelectiveRestoreDomains(["local-auth", "rbac"]),
    new Map([["local-auth", localAuthPayload]]),
    { ...audit, metadataJson: "{\"domains\":[\"local-auth\",\"rbac\"]}" },
  );
  const sql = statements.map((statement) => statement.sql);
  assert.equal(sql.some((value) => value.startsWith("DELETE FROM portal_sessions")), true);
  assert.equal(sql.some((value) => value.startsWith("DELETE FROM portal_users")), true);
  assert.equal(sql.some((value) => value.startsWith("INSERT INTO portal_users")), true);
  assert.equal(sql.some((value) => value.startsWith("INSERT INTO portal_sessions")), false);
  assert.equal(sql.some((value) => value.includes("portal_role_assignments")), false);
});

test("uses dependency-safe domain and table ordering for operations and approvals", () => {
  const operations = {
    domain: "operations",
    schemaVersion: 1,
    tables: [
      ["operation_runs", ["id", "job_id", "event_id", "title", "kind", "mode", "status", "actor", "subject", "error", "stages_json", "started_at", "updated_at", "completed_at"], ["id"]],
      ["operation_run_results", ["run_id", "job_id", "summary", "values_json", "links_json", "files_json", "table_json", "truncated", "captured_at"], ["run_id"]],
      ["operation_run_replays", ["run_id", "event_id", "schema_version", "encrypted_spec", "replayable", "reason", "parent_run_id", "created_at"], ["run_id"]],
      ["operation_notifications", ["id", "run_id", "status", "title", "message", "created_at"], ["id"]],
      ["operation_notification_reads", ["notification_id", "identity", "read_at"], ["notification_id", "identity"]],
    ].map(([name, columns, primaryKey]) => ({ name, columns, primaryKey, rows: [] })),
  };
  const approvals = {
    domain: "approvals",
    schemaVersion: 1,
    tables: [
      { name: "operation_approvals", columns: ["id", "event_id", "title", "category", "schema_version", "requester_identity", "requester_role", "requester_groups_json", "status", "required_approvals", "approver_roles_json", "approver_groups_json", "requester_cannot_approve", "rule_id", "summary_json", "encrypted_spec", "request_fingerprint", "expires_at", "created_at", "updated_at", "approved_at", "executed_at", "run_id", "parent_run_id", "error"], primaryKey: ["id"], rows: [] },
      { name: "operation_approval_decisions", columns: ["approval_id", "approver_identity", "approver_role", "decision", "comment", "decided_at"], primaryKey: ["approval_id", "approver_identity"], rows: [] },
    ],
  };
  const db = new FakeDb();
  const sql = buildSelectiveRestoreStatements(
    db,
    guard,
    validateSelectiveRestoreDomains(["operations", "approvals"]),
    new Map([["operations", operations], ["approvals", approvals]]),
    audit,
  ).map((statement) => statement.sql);

  assert.ok(sql.indexOf("DELETE FROM operation_approval_decisions WHERE EXISTS (SELECT 1 FROM portal_backup_restore_stages WHERE id = ? AND actor_identity = ? AND stage_secret_hash = ? AND status = 'committing')")
    < sql.indexOf("DELETE FROM operation_runs WHERE EXISTS (SELECT 1 FROM portal_backup_restore_stages WHERE id = ? AND actor_identity = ? AND stage_secret_hash = ? AND status = 'committing')"));
  assert.ok(sql.findIndex((value) => value.startsWith("INSERT INTO operation_runs"))
    < sql.findIndex((value) => value.startsWith("INSERT INTO operation_approvals")));
});

test("rejects missing payloads and invalid active-admin local-auth data before preparing SQL", () => {
  const db = new FakeDb();
  assert.throws(
    () => buildSelectiveRestoreStatements(
      db,
      guard,
      validateSelectiveRestoreDomains(["policies"]),
      new Map(),
      audit,
    ),
    (error) => error?.code === "backup_restore_commit_failed",
  );
  const disabledAdmin = structuredClone(localAuthPayload);
  disabledAdmin.tables[0].rows[0][7] = 1;
  assert.throws(
    () => buildSelectiveRestoreStatements(
      db,
      guard,
      validateSelectiveRestoreDomains(["local-auth"]),
      new Map([["local-auth", disabledAdmin]]),
      audit,
    ),
    (error) => error?.code === "backup_restore_admin_required",
  );
});
