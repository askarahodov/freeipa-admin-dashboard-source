import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PORTAL_BACKUP_DOMAINS } from "../src/backup/backup-manifest.ts";
import { FULL_BACKUP_EXPORTERS, FULL_BACKUP_TABLES, FullBackupValidationError, validateFullBackupDomainPayload } from "../src/backup/export/backup-full-domains.ts";

const expectedTables = {
  settings: ["app_settings", "portal_settings_drafts", "portal_settings_apply_commits", "portal_settings_revisions", "portal_settings_draft_resets"],
  "local-auth": ["portal_users", "portal_sessions"],
  rbac: ["portal_role_assignments"],
  policies: ["catalog_visibility_policies", "approval_policy_sets", "process_presentation_sets"],
  catalog: ["xyops_catalog_snapshot", "xyops_catalog_history", "xyops_catalog_sync_runs"],
  operations: ["operation_runs", "operation_run_results", "operation_run_replays", "operation_notifications", "operation_notification_reads"],
  approvals: ["operation_approvals", "operation_approval_decisions"],
  audit: ["portal_audit_events"],
};
const descriptor = (name) => FULL_BACKUP_TABLES.flatMap(([, tables]) => tables).find((table) => table.name === name);

test("full backup registry is canonical exhaustive and read only", () => {
  assert.deepEqual([...FULL_BACKUP_EXPORTERS.keys()], PORTAL_BACKUP_DOMAINS);
  assert.deepEqual(Object.fromEntries(FULL_BACKUP_TABLES.map(([domain, tables]) => [domain, tables.map((table) => table.name)])), expectedTables);
  for (const [domain, tables] of FULL_BACKUP_TABLES) {
    assert.equal(tables.length > 0, true, domain);
    for (const table of tables) {
      assert.equal(table.columns.length > 0, true);
      assert.equal(table.primaryKey.length > 0, true);
      assert.equal(table.primaryKey.every((column) => table.columns.includes(column)), true);
      assert.match(table.sql, /^SELECT [\s\S]+ FROM [a-z0-9_]+ ORDER BY [a-z0-9_, ]+$/i);
      assert.doesNotMatch(table.sql, /SELECT\s+\*/i);
      assert.doesNotMatch(table.sql, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|REINDEX)\b/i);
    }
  }
});

test("full registry includes encrypted recovery material but no external encryption key", () => {
  assert.equal(descriptor("app_settings").columns.includes("encrypted_secrets"), true);
  assert.equal(descriptor("portal_users").columns.includes("password_hash"), true);
  assert.equal(descriptor("portal_users").columns.includes("password_salt"), true);
  assert.equal(descriptor("portal_users").columns.includes("password_iterations"), true);
  assert.equal(descriptor("portal_sessions").columns.includes("token_hash"), true);
  assert.equal(descriptor("portal_settings_drafts").columns.includes("encrypted_secrets"), true);
  assert.equal(descriptor("portal_settings_apply_commits").columns.includes("encrypted_secrets"), true);
  assert.equal(descriptor("portal_settings_revisions").columns.includes("encrypted_secrets"), true);
  assert.equal(descriptor("operation_run_replays").columns.includes("encrypted_spec"), true);
  assert.equal(descriptor("operation_approvals").columns.includes("encrypted_spec"), true);
  const source = fs.readFileSync(new URL("../src/backup/export/backup-full-domains.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /CONFIG_ENCRYPTION_KEY|backup_password|backup_key|ipa_password|xyops_api_key/i);
});

test("validates exact table bundles and rejects ambiguous primary keys", () => {
  const table = descriptor("app_settings");
  const valid = {
    domain: "settings",
    schemaVersion: 1,
    tables: FULL_BACKUP_TABLES.find(([domain]) => domain === "settings")[1].map((item) => ({ name: item.name, columns: [...item.columns], primaryKey: [...item.primaryKey], rows: item.name === "app_settings" ? [["main", "{}", "encrypted", 1]] : [] })),
  };
  assert.deepEqual(validateFullBackupDomainPayload("settings", valid), valid);
  const unknown = structuredClone(valid);
  unknown.extra = true;
  assert.throws(() => validateFullBackupDomainPayload("settings", unknown), FullBackupValidationError);
  const nullKey = structuredClone(valid);
  nullKey.tables[0].rows[0][0] = null;
  assert.throws(() => validateFullBackupDomainPayload("settings", nullKey), FullBackupValidationError);
  const duplicate = structuredClone(valid);
  duplicate.tables.find((item) => item.name === table.name).rows.push(["main", "{}", "other", 2]);
  assert.throws(() => validateFullBackupDomainPayload("settings", duplicate), (error) => error instanceof FullBackupValidationError && error.code === "backup_full_payload_invalid");
});

test("exports positional rows in declared order", async () => {
  const seen = [];
  const env = { DB: { prepare(sql) { seen.push(sql); return { async all() {
    if (sql.includes("FROM portal_users")) return { results: [{ id: "u1", username: "admin", display_name: "Admin", password_hash: "h", password_salt: "s", password_iterations: 210000, role: "admin", disabled: 0, failed_attempts: 0, locked_until: null, created_at: 1, updated_at: 2, last_login_at: null }] };
    if (sql.includes("FROM portal_sessions")) return { results: [] };
    return { results: [] };
  } }; } } };
  const result = await FULL_BACKUP_EXPORTERS.get("local-auth").export(env, 1);
  assert.equal(result.records, 1);
  assert.deepEqual(result.payload.tables[0].rows[0], ["u1", "admin", "Admin", "h", "s", 210000, "admin", 0, 0, null, 1, 2, null]);
  assert.equal(seen.length, 2);
});
