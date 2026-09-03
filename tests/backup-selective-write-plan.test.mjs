import assert from "node:assert/strict";
import test from "node:test";

import { FULL_BACKUP_TABLES } from "../src/backup/export/backup-full-domains.ts";
import { validateSelectiveRestoreDomains } from "../src/backup/restore/backup-selective-restore-policy.ts";
import {
  MAX_SELECTIVE_RESTORE_JSON_BINDING_BYTES,
  buildSelectiveRestoreStatements,
  validateSelectiveRestoreCandidate,
} from "../src/backup/restore/backup-selective-write-plan.ts";

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

function definitions(domain) {
  const found = FULL_BACKUP_TABLES.find(([candidate]) => candidate === domain);
  assert.ok(found);
  return found[1];
}

function placeholderRow(descriptor, seed) {
  return descriptor.columns.map((column, index) => {
    if (descriptor.primaryKey.includes(column)) return `${seed}-pk-${index}`;
    if (/(_at|_count|iterations|revision|required_approvals|disabled|failed_attempts|replayable|truncated|cannot_approve)$/.test(column)) return 1;
    if (column.endsWith("_json") || column === "config_json" || column === "metadata_json" || column === "policy_json") return "{}";
    return `${seed}-${column}`;
  });
}

function domainPayload(domain, rowTables = new Set()) {
  return {
    domain,
    schemaVersion: 1,
    tables: definitions(domain).map((descriptor) => ({
      name: descriptor.name,
      columns: [...descriptor.columns],
      primaryKey: [...descriptor.primaryKey],
      rows: rowTables.has(descriptor.name) ? [placeholderRow(descriptor, descriptor.name)] : [],
    })),
  };
}

const policiesPayload = domainPayload("policies", new Set([
  "catalog_visibility_policies",
  "approval_policy_sets",
  "process_presentation_sets",
]));
const currentPoliciesPayload = structuredClone(policiesPayload);
currentPoliciesPayload.tables[0].rows[0][1] = "{\"current\":true}";
const localAuthPayload = domainPayload("local-auth");
localAuthPayload.tables[0].rows = [[
  "user-1", "admin", "Admin", "hash", "salt", 210000, "admin", 0, 0, null, 1, 1, null,
]];
localAuthPayload.tables[1].rows = [["session-1", "user-1", "token-hash", 1, 1, 2, "browser"]];

function policiesStatements() {
  const db = new FakeDb();
  const statements = buildSelectiveRestoreStatements(
    db,
    guard,
    validateSelectiveRestoreDomains(["policies"]),
    new Map([["policies", policiesPayload]]),
    new Map([["policies", currentPoliciesPayload]]),
    audit,
  );
  return { db, statements };
}

test("claims the stage only while every selected production table still matches recovery state", () => {
  const { db, statements } = policiesStatements();
  assert.deepEqual(statements, db.prepared);
  assert.equal(statements.length, 9);
  assert.match(statements[0].sql, /^UPDATE portal_backup_restore_stages SET status = 'committing'/);
  assert.equal((statements[0].sql.match(/SELECT COUNT\(\*\) FROM/g) ?? []).length, 3);
  assert.equal((statements[0].sql.match(/FROM json_each\(\?\)/g) ?? []).length, 3);
  assert.match(statements[0].sql, /NOT EXISTS \(SELECT json_extract.*FROM json_each\(\?\) EXCEPT SELECT id, policy_json, updated_at FROM catalog_visibility_policies\)/);
  assert.deepEqual(statements[0].values.slice(0, 5), [
    guard.now,
    guard.id,
    guard.actorIdentity,
    guard.stageSecretHash,
    guard.now,
  ]);
  assert.equal(statements[0].values[5], 1);
  assert.equal(statements[0].values[6], JSON.stringify(currentPoliciesPayload.tables[0].rows));
  assert.equal(statements[0].values[7], 1);
});

test("builds dependency-safe guarded deletes and one JSON insert per populated table", () => {
  const { statements } = policiesStatements();
  assert.match(statements[1].sql, /^DELETE FROM process_presentation_sets WHERE EXISTS/);
  assert.match(statements[2].sql, /^DELETE FROM approval_policy_sets WHERE EXISTS/);
  assert.match(statements[3].sql, /^DELETE FROM catalog_visibility_policies WHERE EXISTS/);
  assert.match(statements[4].sql, /^INSERT INTO catalog_visibility_policies \(id, policy_json, updated_at\) SELECT json_extract\(value, '\$\[0\]'\), json_extract/);
  assert.match(statements[4].sql, /FROM json_each\(\?\) WHERE EXISTS/);
  assert.equal(statements[4].values[0], JSON.stringify(policiesPayload.tables[0].rows));
  assert.match(statements[5].sql, /^INSERT INTO approval_policy_sets/);
  assert.match(statements[6].sql, /^INSERT INTO process_presentation_sets/);
  assert.match(statements[7].sql, /^INSERT INTO portal_audit_events/);
  assert.match(statements[8].sql, /^UPDATE portal_backup_restore_stages SET status = 'committed'/);

  for (const statement of statements.slice(1, -1)) {
    assert.match(statement.sql, /status = 'committing'/);
    assert.equal(statement.sql.includes("SELECT *"), false);
  }
});

test("chunks large table rows below the D1 bound-value limit", () => {
  const source = domainPayload("policies");
  const descriptor = definitions("policies")[0];
  const largeValue = "x".repeat(Math.floor(MAX_SELECTIVE_RESTORE_JSON_BINDING_BYTES * 0.55));
  const first = placeholderRow(descriptor, "large-one");
  const second = placeholderRow(descriptor, "large-two");
  first[descriptor.columns.indexOf("policy_json")] = JSON.stringify({ value: largeValue });
  second[descriptor.columns.indexOf("policy_json")] = JSON.stringify({ value: largeValue });
  source.tables[0].rows = [first, second];

  const db = new FakeDb();
  const statements = buildSelectiveRestoreStatements(
    db,
    guard,
    validateSelectiveRestoreDomains(["policies"]),
    new Map([["policies", source]]),
    new Map([["policies", structuredClone(source)]]),
    audit,
  );
  const inserts = statements.filter((statement) => statement.sql.startsWith("INSERT INTO catalog_visibility_policies"));
  assert.equal(inserts.length, 2);
  assert.equal((statements[0].sql.match(/FROM json_each\(\?\)/g) ?? []).length, 2);
  for (const statement of inserts) {
    assert.equal(new TextEncoder().encode(statement.values[0]).byteLength <= MAX_SELECTIVE_RESTORE_JSON_BINDING_BYTES, true);
  }
});

test("rejects a single row that cannot fit an atomic D1 binding", () => {
  const source = domainPayload("policies");
  const descriptor = definitions("policies")[0];
  const row = placeholderRow(descriptor, "oversized");
  row[descriptor.columns.indexOf("policy_json")] = "x".repeat(MAX_SELECTIVE_RESTORE_JSON_BINDING_BYTES);
  source.tables[0].rows = [row];
  assert.throws(
    () => validateSelectiveRestoreCandidate(
      validateSelectiveRestoreDomains(["policies"]),
      new Map([["policies", source]]),
    ),
    (error) => error?.code === "backup_restore_commit_too_large",
  );
});

test("revokes sessions and never inserts historical session rows", () => {
  const db = new FakeDb();
  const statements = buildSelectiveRestoreStatements(
    db,
    guard,
    validateSelectiveRestoreDomains(["local-auth", "rbac"]),
    new Map([["local-auth", localAuthPayload]]),
    new Map([["local-auth", structuredClone(localAuthPayload)]]),
    { ...audit, metadataJson: "{\"domains\":[\"local-auth\",\"rbac\"]}" },
  );
  const sql = statements.map((statement) => statement.sql);
  assert.equal(sql.some((value) => value.startsWith("DELETE FROM portal_sessions")), true);
  assert.equal(sql.some((value) => value.startsWith("DELETE FROM portal_users")), true);
  assert.equal(sql.some((value) => value.startsWith("INSERT INTO portal_users")), true);
  assert.equal(sql.some((value) => value.startsWith("INSERT INTO portal_sessions")), false);
  assert.equal(sql.some((value) => value.includes("portal_role_assignments")), false);
  assert.match(sql[0], /SELECT COUNT\(\*\) FROM portal_sessions/);
});

test("uses dependency-safe domain and table ordering for operations and approvals", () => {
  const operations = domainPayload("operations", new Set(["operation_runs"]));
  const approvals = domainPayload("approvals", new Set(["operation_approvals"]));
  const db = new FakeDb();
  const source = new Map([["operations", operations], ["approvals", approvals]]);
  const sql = buildSelectiveRestoreStatements(
    db,
    guard,
    validateSelectiveRestoreDomains(["operations", "approvals"]),
    source,
    new Map([["operations", structuredClone(operations)], ["approvals", structuredClone(approvals)]]),
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
      new Map([["policies", currentPoliciesPayload]]),
      audit,
    ),
    (error) => error?.code === "backup_restore_commit_failed",
  );
  const disabledAdmin = structuredClone(localAuthPayload);
  disabledAdmin.tables[0].rows[0][7] = 1;
  assert.throws(
    () => validateSelectiveRestoreCandidate(
      validateSelectiveRestoreDomains(["local-auth"]),
      new Map([["local-auth", disabledAdmin]]),
    ),
    (error) => error?.code === "backup_restore_admin_required",
  );
});
