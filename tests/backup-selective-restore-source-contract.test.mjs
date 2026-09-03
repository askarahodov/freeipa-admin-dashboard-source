import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const productionPaths = [
  "../src/backup/restore/backup-selective-restore-policy.ts",
  "../backup-restore-stage.ts",
  "../backup-restore-stage-repository.ts",
  "../src/backup/restore/backup-selective-recovery-point.ts",
  "../backup-selective-write-plan.ts",
  "../backup-selective-restore-prepare.ts",
  "../backup-selective-restore-commit.ts",
  "../worker/backup-selective-restore-entry.ts",
  "../worker/backup-selective-restore-dispatch.ts",
  "../worker/backup-selective-restore-root-entry.ts",
];

test("selective restore production sources never persist or audit request secrets", () => {
  const route = fs.readFileSync(new URL("../worker/backup-selective-restore-entry.ts", import.meta.url), "utf8");
  for (const forbidden of [
    "metadata: input",
    "metadata: body",
    "metadata: request",
    "password: input.password",
    "stageSecret:",
    "approvalToken:",
    "recoveryPassword:",
  ]) {
    assert.equal(route.includes(forbidden), false, forbidden);
  }
  assert.equal(route.includes("sameOriginAdminMutation"), true);
  assert.equal(route.includes('"cache-control": "no-store"'), true);
  assert.equal(route.includes("MAX_SELECTIVE_RESTORE_REQUEST_BYTES"), true);
  assert.equal(route.includes("MAX_SELECTIVE_CANCEL_REQUEST_BYTES"), true);
});

test("production restore has no outbound calls maintenance mode or destructive schema changes", () => {
  const source = productionPaths.map((path) => fs.readFileSync(new URL(path, import.meta.url), "utf8")).join("\n");
  assert.doesNotMatch(source, /\bglobalThis\.fetch\s*\(/);
  assert.doesNotMatch(source, /\bawait\s+fetch\s*\(/);
  assert.doesNotMatch(source, /console\./);
  assert.doesNotMatch(source, /maintenance/i);
  assert.doesNotMatch(source, /CONFIG_ENCRYPTION_KEY/);
  assert.doesNotMatch(source, /\b(?:DROP|ALTER)\s+(?:TABLE|INDEX|TRIGGER)\b/i);
  assert.doesNotMatch(source, /DELETE\s+FROM\s+portal_audit_events/i);
  assert.doesNotMatch(source, /UPDATE\s+portal_audit_events/i);
  assert.doesNotMatch(source, /INSERT\s+INTO\s+portal_sessions/i);
});

test("dedicated outer root composes a pure admin-only selective dispatch", () => {
  const root = fs.readFileSync(new URL("../worker/backup-selective-restore-root-entry.ts", import.meta.url), "utf8");
  const dispatch = fs.readFileSync(new URL("../worker/backup-selective-restore-dispatch.ts", import.meta.url), "utf8");
  const readOnlyRoot = fs.readFileSync(new URL("../worker/backup-encrypted-root-entry.ts", import.meta.url), "utf8");
  for (const value of [
    "SELECTIVE_RESTORE_PREPARE_PATH",
    "SELECTIVE_RESTORE_COMMIT_PATH",
    "SELECTIVE_RESTORE_CANCEL_PATH",
    "backup.restore.prepare",
    "backup.restore.commit",
    "backup.restore.cancel",
    "encryptedBackupAccess",
  ]) {
    assert.equal(dispatch.includes(value), true, value);
  }
  assert.equal((dispatch.match(/prepareHandler/g) ?? []).length >= 2, true);
  assert.equal((dispatch.match(/commitHandler/g) ?? []).length >= 2, true);
  assert.equal((dispatch.match(/cancelHandler/g) ?? []).length >= 2, true);
  assert.equal(root.includes("backup-selective-restore-dispatch.ts"), true);
  assert.equal(root.includes("freeipa-group-member-entry.ts"), true);
  assert.equal(root.includes("return rootRuntime.fetch"), true);
  assert.equal(readOnlyRoot.includes("backup.restore.commit"), false);
  assert.equal(readOnlyRoot.includes("backup-selective-restore"), false);
});
