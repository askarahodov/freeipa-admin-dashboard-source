import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { RECOVERY_RECEIPT_PHASES } from "../src/recovery/foundation/recovery-receipt.ts";

const runbook = await readFile(new URL("../docs/OFFLINE_FULL_RESTORE.md", import.meta.url), "utf8");
const maintenance = await readFile(new URL("../docs/operations/MAINTENANCE_MODE.md", import.meta.url), "utf8");
const roadmap = await readFile(new URL("../docs/PRODUCT_ROADMAP.md", import.meta.url), "utf8");

test("offline restore runbook documents the complete bounded lifecycle", () => {
  for (const command of [
    "preflight",
    "backup-current",
    "restore",
    "status",
    "verify",
    "rollback",
    "maintenance-recover",
  ]) {
    assert.ok(runbook.includes(`run --rm recovery ${command}`), command);
  }
  for (const required of [
    "docker compose stop dashboard",
    "docker compose up -d dashboard",
    "--backup-password-file",
    "--recovery-password-file",
    "--config-key-file",
    "--confirmation-file",
    "RECOVER FAILED MAINTENANCE <operationId>",
    "mode-`0600`",
    "не выключается автоматически",
    "-wal`/`-shm",
    "portal_sessions",
  ]) {
    assert.ok(runbook.includes(required), required);
  }
  assert.doesNotMatch(runbook, /--(?:force-running|ignore-lock|skip-recovery-point|ignore-checksum|ignore-schema)/u);
});

test("runbook lists exactly the canonical receipt phases", () => {
  for (const phase of RECOVERY_RECEIPT_PHASES) assert.ok(runbook.includes(`\`${phase}\``), phase);
  assert.doesNotMatch(runbook, /`completed`|`verification_failed`/u);
});

test("maintenance and roadmap point operators at completed offline recovery", () => {
  assert.match(maintenance, /OFFLINE_FULL_RESTORE\.md/u);
  assert.match(maintenance, /verification\/smoke/u);
  assert.match(maintenance, /offline.*failed maintenance/iu);
  assert.match(roadmap, /\[x\].*PR #72.*destructive full restore/iu);
  assert.match(roadmap, /\[x\].*PR #72.*CLI\/offline recovery/iu);
});
