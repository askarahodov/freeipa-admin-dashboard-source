import assert from "node:assert/strict";
import test from "node:test";

import { assertSanitizedBackupPayload, PORTAL_BACKUP_DOMAINS } from "../backup-manifest.ts";
import { SANITIZED_BACKUP_EXPORTERS } from "../backup-export-domains.ts";

function fakeDb(rowsByTable) {
  const sql = [];
  return {
    sql,
    prepare(statement) {
      sql.push(statement);
      return {
        async all() {
          const match = /\bFROM\s+([a-z0-9_]+)/i.exec(statement);
          return { results: match ? (rowsByTable[match[1]] ?? []) : [] };
        },
      };
    },
  };
}

test("registry is exhaustive and uses fixed domain paths", () => {
  assert.deepEqual([...SANITIZED_BACKUP_EXPORTERS.keys()], [...PORTAL_BACKUP_DOMAINS]);
  for (const domain of PORTAL_BACKUP_DOMAINS) {
    assert.equal(SANITIZED_BACKUP_EXPORTERS.get(domain)?.path, `domains/${domain}.json`);
  }
});

test("all domain exporters return deterministic sanitized records using explicit read-only queries", async () => {
  const db = fakeDb({
    app_settings: [{ id: "singleton", config_json: '{"theme":"dark"}', updated_at: 20 }],
    portal_users: [{ id: "u1", username: "admin", display_name: "Admin", role: "admin", disabled: 0, created_at: 1, updated_at: 2, last_login_at: 3 }],
    catalog_visibility_policies: [{ id: "default", policy_json: '{"hidden":[]}', updated_at: 4 }],
    approval_policy_sets: [],
    process_presentation_sets: [],
    xyops_catalog_snapshot: [{ id: "current", catalog_json: '{"items":[]}', synced_at: 5 }],
    xyops_catalog_history: [],
    operation_runs: [{ id: "r1", job_id: "j1", event_id: "e1", title: "Run", kind: "event", mode: "manual", status: "success", actor: "admin", subject: "test", stages_json: '[]', started_at: 1, updated_at: 2, completed_at: 3 }],
    operation_run_results: [],
    operation_approvals: [],
    operation_approval_decisions: [],
    portal_audit_events: [],
  });

  for (const domain of PORTAL_BACKUP_DOMAINS) {
    const result = await SANITIZED_BACKUP_EXPORTERS.get(domain).export({ DB: db });
    assert.equal(result.records, result.payload.records.length);
    assertSanitizedBackupPayload(result.payload);
  }

  const settings = await SANITIZED_BACKUP_EXPORTERS.get("settings").export({ DB: db });
  assert.deepEqual(settings.payload.records[0].config, { theme: "dark" });
  const localAuth = await SANITIZED_BACKUP_EXPORTERS.get("local-auth").export({ DB: db });
  assert.equal(localAuth.payload.records[0].username, "admin");
  assert.equal("password_hash" in localAuth.payload.records[0], false);

  for (const statement of db.sql) {
    assert.match(statement, /^SELECT\s/i);
    assert.doesNotMatch(statement, /SELECT\s+\*/i);
    assert.doesNotMatch(statement, /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i);
    assert.doesNotMatch(statement, /encrypted_secrets|password_hash|password_salt|token_hash|encrypted_spec/i);
    assert.match(statement, /ORDER BY/i);
  }
});

test("missing database and query failures become safe compatibility errors", async () => {
  await assert.rejects(() => SANITIZED_BACKUP_EXPORTERS.get("settings").export({}), /unavailable/);
  const db = { prepare() { throw new Error("raw sql details"); } };
  await assert.rejects(
    () => SANITIZED_BACKUP_EXPORTERS.get("settings").export({ DB: db }),
    (error) => error.code === "backup_schema_incompatible" && !error.message.includes("raw sql details"),
  );
});
