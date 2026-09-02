import test from "node:test";
import assert from "node:assert/strict";

import {
  BACKUP_RESTORE_PLAN_VERSION,
  BackupRestorePlanError,
  createBackupRestorePlan,
  verifyBackupRestoreApprovalToken,
} from "../src/backup/restore/backup-restore-plan.ts";

function document(overrides = {}) {
  return {
    manifest: {
      format: "freeipa-admin-dashboard-backup",
      version: 1,
      createdAt: "2026-07-31T00:00:00.000Z",
      schemaVersion: 1,
      mode: "encrypted",
      domains: ["settings", "local-auth"],
      entries: [
        { domain: "settings", path: "domains/settings.json", sha256: "a".repeat(64), bytes: 100, records: 1 },
        { domain: "local-auth", path: "domains/local-auth.json", sha256: "b".repeat(64), bytes: 200, records: 2 },
      ],
      encryption: { algorithm: "AES-256-GCM", kdf: "PBKDF2-SHA-256", iterations: 310000, salt: "AAECAwQFBgcICQoLDA0ODw==" },
      ...overrides,
    },
    payloads: {},
    summary: { entries: 2, records: 3, bytes: 300 },
  };
}

function payload(domain, secret = "secret-a") {
  if (domain === "settings") {
    return {
      domain,
      schemaVersion: 1,
      tables: [
        { name: "app_settings", columns: ["id", "config_json", "encrypted_secrets", "updated_at"], primaryKey: ["id"], rows: [["singleton", "{}", secret, 1]] },
        { name: "portal_settings_drafts", columns: ["id", "base_revision", "changes_json", "encrypted_secrets", "status", "validation_json", "created_by", "created_at", "updated_at", "validated_at", "applied_at"], primaryKey: ["id"], rows: [] },
        { name: "portal_settings_apply_commits", columns: ["id", "draft_id", "revision", "config_json", "encrypted_secrets", "created_at"], primaryKey: ["id"], rows: [] },
        { name: "portal_settings_revisions", columns: ["id", "revision", "config_json", "encrypted_secrets", "source_draft_id", "created_by", "reason", "status", "health_json", "created_at"], primaryKey: ["id"], rows: [] },
        { name: "portal_settings_draft_resets", columns: ["draft_id", "reset_fields_json", "created_at"], primaryKey: ["draft_id"], rows: [] },
      ],
    };
  }
  return {
    domain,
    schemaVersion: 1,
    tables: [
      { name: "portal_users", columns: ["id", "username", "display_name", "password_hash", "password_salt", "password_iterations", "role", "disabled", "failed_attempts", "locked_until", "created_at", "updated_at", "last_login_at"], primaryKey: ["id"], rows: [["u1", "admin", "Admin", secret, "salt", 310000, "admin", 0, 0, null, 1, 1, null]] },
      { name: "portal_sessions", columns: ["id", "user_id", "token_hash", "created_at", "last_seen_at", "expires_at", "user_agent"], primaryKey: ["id"], rows: [] },
    ],
  };
}

function registry(secret = "secret-a") {
  return new Map([
    ["settings", { domain: "settings", path: "domains/settings.json", async export() { return { payload: payload("settings", secret), records: 1 }; } }],
    ["local-auth", { domain: "local-auth", path: "domains/local-auth.json", async export() { return { payload: payload("local-auth", secret), records: 1 }; } }],
  ]);
}

test("creates a deterministic opaque restore plan", async () => {
  const first = await createBackupRestorePlan({ DB: {} }, document(), ["settings", "local-auth"], 1, registry());
  const second = await createBackupRestorePlan({ DB: {} }, document(), ["settings", "local-auth"], 1, registry());

  assert.equal(BACKUP_RESTORE_PLAN_VERSION, 1);
  assert.deepEqual(first, second);
  assert.deepEqual(Object.keys(first), ["version", "selectedDomains", "approvalToken"]);
  assert.deepEqual(first.selectedDomains, ["settings", "local-auth"]);
  assert.match(first.approvalToken, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(JSON.stringify(first), /secret-a|fingerprint|sha256|records/i);
});

test("token changes with backup selection schema and current full state", async () => {
  const baseline = await createBackupRestorePlan({ DB: {} }, document(), ["settings", "local-auth"], 1, registry("secret-a"));
  const cases = [
    createBackupRestorePlan({ DB: {} }, document(), ["settings"], 1, registry("secret-a")),
    createBackupRestorePlan({ DB: {} }, document({ schemaVersion: 2 }), ["settings", "local-auth"], 1, registry("secret-a")),
    createBackupRestorePlan({ DB: {} }, document(), ["settings", "local-auth"], 2, registry("secret-a")),
    createBackupRestorePlan({ DB: {} }, document({ entries: [
      { domain: "settings", path: "domains/settings.json", sha256: "c".repeat(64), bytes: 100, records: 1 },
      { domain: "local-auth", path: "domains/local-auth.json", sha256: "b".repeat(64), bytes: 200, records: 2 },
    ] }), ["settings", "local-auth"], 1, registry("secret-a")),
    createBackupRestorePlan({ DB: {} }, document(), ["settings", "local-auth"], 1, registry("secret-b")),
  ];

  for (const candidate of await Promise.all(cases)) assert.notEqual(candidate.approvalToken, baseline.approvalToken);
});

test("verifies only strict lowercase SHA-256 approval tokens", async () => {
  const plan = await createBackupRestorePlan({ DB: {} }, document(), ["settings"], 1, registry());
  assert.equal(verifyBackupRestoreApprovalToken(plan.approvalToken, plan.approvalToken), true);
  assert.equal(verifyBackupRestoreApprovalToken(plan.approvalToken, "f".repeat(64)), false);
  assert.equal(verifyBackupRestoreApprovalToken(plan.approvalToken, plan.approvalToken.toUpperCase()), false);
  assert.equal(verifyBackupRestoreApprovalToken(plan.approvalToken, "short"), false);
  assert.equal(verifyBackupRestoreApprovalToken(plan.approvalToken, null), false);
});

test("rejects missing registries and inconsistent current record counts", async () => {
  await assert.rejects(
    () => createBackupRestorePlan({ DB: {} }, document(), ["settings"], 1, new Map()),
    (error) => error instanceof BackupRestorePlanError && error.code === "backup_schema_incompatible" && error.status === 409,
  );
  const bad = registry();
  bad.set("settings", { ...bad.get("settings"), async export() { return { payload: payload("settings"), records: 99 }; } });
  await assert.rejects(
    () => createBackupRestorePlan({ DB: {} }, document(), ["settings"], 1, bad),
    (error) => error instanceof BackupRestorePlanError && error.code === "backup_schema_incompatible",
  );
});
