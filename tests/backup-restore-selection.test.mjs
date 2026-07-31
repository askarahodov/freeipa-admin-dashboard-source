import test from "node:test";
import assert from "node:assert/strict";

import {
  BackupRestoreSelectionError,
  selectBackupRestoreDomains,
} from "../backup-restore-selection.ts";

test("selects all manifest domains when selection is omitted", () => {
  const manifestDomains = ["settings", "local-auth", "rbac"];
  const result = selectBackupRestoreDomains(manifestDomains, undefined);
  assert.deepEqual(result, manifestDomains);
  assert.notEqual(result, manifestDomains);
});

test("normalizes a requested subset into canonical portal order", () => {
  assert.deepEqual(
    selectBackupRestoreDomains(["settings", "local-auth", "rbac", "audit"], ["audit", "rbac", "settings"]),
    ["settings", "rbac", "audit"],
  );
});

test("rejects empty duplicate unknown and unavailable domain selections", () => {
  for (const value of [
    [],
    ["settings", "settings"],
    ["settings", "unknown"],
    ["audit"],
    "settings",
    null,
  ]) {
    assert.throws(
      () => selectBackupRestoreDomains(["settings", "local-auth"], value),
      (error) => error instanceof BackupRestoreSelectionError
        && error.code === "backup_request_invalid"
        && error.status === 400,
    );
  }
});

test("rejects invalid or non-canonical manifest domain declarations", () => {
  for (const manifestDomains of [
    [],
    ["rbac", "settings"],
    ["settings", "settings"],
    ["settings", "unknown"],
  ]) {
    assert.throws(
      () => selectBackupRestoreDomains(manifestDomains, undefined),
      (error) => error instanceof BackupRestoreSelectionError
        && error.code === "backup_request_invalid",
    );
  }
});
