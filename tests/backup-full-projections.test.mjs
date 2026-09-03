import test from "node:test";
import assert from "node:assert/strict";
import { assertSanitizedBackupPayload } from "../src/backup/backup-manifest.ts";
import { FULL_BACKUP_TABLES } from "../src/backup/export/backup-full-domains.ts";
import { projectFullBackupDomain } from "../src/backup/preview/backup-full-projections.ts";

function payload(domain, tableRows) {
  const definitions = FULL_BACKUP_TABLES.find(([item]) => item === domain)[1];
  return {
    domain,
    schemaVersion: 1,
    tables: definitions.map((table) => ({ name: table.name, columns: [...table.columns], primaryKey: [...table.primaryKey], rows: tableRows[table.name] ?? [] })),
  };
}

test("projects settings local auth and RBAC without recovery secrets", () => {
  const settings = projectFullBackupDomain("settings", payload("settings", {
    app_settings: [["main", '{"demoMode":false}', "encrypted-secret", 10]],
    portal_settings_revisions: [["r1", 1, "{}", "revision-secret", null, "admin", "apply", "active", "[]", 9]],
  }));
  assert.deepEqual(settings, { records: [{ id: "main", config: { demoMode: false }, updated_at: 10 }] });

  const localAuth = projectFullBackupDomain("local-auth", payload("local-auth", {
    portal_users: [["u1", "admin", "Admin", "hash", "salt", 210000, "admin", 0, 2, null, 1, 5, 4]],
    portal_sessions: [["s1", "u1", "token-hash", 1, 2, 3, "ua"]],
  }));
  assert.deepEqual(localAuth, { records: [{ id: "u1", username: "admin", display_name: "Admin", role: "admin", disabled: 0, created_at: 1, updated_at: 5, last_login_at: 4 }] });

  const rbac = projectFullBackupDomain("rbac", payload("rbac", {
    portal_role_assignments: [["u1", "admin", "admin", 0, 5]],
  }));
  assert.deepEqual(rbac, { records: [{ identity_id: "u1", username: "admin", role: "admin", disabled: 0, updated_at: 5 }] });
  assert.doesNotMatch(JSON.stringify({ settings, localAuth, rbac }), /encrypted-secret|revision-secret|hash|salt|token-hash/);
});

test("projects policies catalog operations approvals and audit into existing safe shapes", () => {
  const policies = projectFullBackupDomain("policies", payload("policies", {
    catalog_visibility_policies: [["default", '{"allow":true}', 2]],
    approval_policy_sets: [["default", '{"required":1}', 3]],
    process_presentation_sets: [["default", '{"title":"X"}', 4]],
  }));
  assert.deepEqual(policies.records.map((item) => item.type), ["catalog-visibility", "approval", "process-presentation"]);

  const catalog = projectFullBackupDomain("catalog", payload("catalog", {
    xyops_catalog_snapshot: [["current", '{"items":[]}', 10]],
    xyops_catalog_history: [["h1", 9, '{"added":1}', '{"items":[]}']],
  }));
  assert.deepEqual(catalog.records.map((item) => item.type), ["snapshot", "history"]);

  const operations = projectFullBackupDomain("operations", payload("operations", {
    operation_runs: [["r1", "j1", "e1", "Run", "event", "live", "completed", "admin", "host", null, '[{"name":"done"}]', 1, 2, 3]],
    operation_run_results: [["r1", "j1", "ok", '["secret-value"]', "[]", "[]", null, 0, 4]],
    operation_run_replays: [["r1", "e1", "1", "encrypted-spec", 1, null, null, 5]],
  }));
  assert.deepEqual(operations.records, [
    { type: "run", id: "r1", job_id: "j1", event_id: "e1", title: "Run", kind: "event", mode: "live", status: "completed", actor: "admin", subject: "host", started_at: 1, updated_at: 2, completed_at: 3, stages: [{ name: "done" }] },
    { type: "result", run_id: "r1", job_id: "j1", summary: "ok", truncated: 0, captured_at: 4 },
  ]);

  const approvals = projectFullBackupDomain("approvals", payload("approvals", {
    operation_approvals: [["a1", "e1", "Approve", "danger", "1", "requester", "operator", '["g"]', "approved", 1, '["admin"]', "[]", 1, "rule", '{"target":"host"}', "encrypted-spec", "fingerprint", 100, 1, 2, 3, 4, "r1", null, null]],
    operation_approval_decisions: [["a1", "admin", "admin", "approve", "private comment", 3]],
  }));
  assert.equal(approvals.records[0].summary.target, "host");
  assert.equal(Object.hasOwn(approvals.records[0], "encrypted_spec"), false);
  assert.equal(Object.hasOwn(approvals.records[1], "comment"), false);

  const audit = projectFullBackupDomain("audit", payload("audit", {
    portal_audit_events: [["x1", 1, "c1", "admin", "admin", '["g"]', "backup", "portal", null, null, null, null, null, null, "success", null, '{"safe":true}']],
  }));
  assert.deepEqual(audit.records[0].actor_groups, ["g"]);
  assert.deepEqual(audit.records[0].metadata, { safe: true });

  for (const projection of [policies, catalog, operations, approvals, audit]) assert.doesNotThrow(() => assertSanitizedBackupPayload(projection));
  assert.doesNotMatch(JSON.stringify({ operations, approvals }), /secret-value|encrypted-spec|private comment|fingerprint/);
});
