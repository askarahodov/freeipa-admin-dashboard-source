import assert from "node:assert/strict";
import test from "node:test";

import {
  BackupSelectiveRestorePolicyError,
  validateSelectiveRestoreDomains,
} from "../backup-selective-restore-policy.ts";

function codeOf(callback) {
  try {
    callback();
    return "";
  } catch (error) {
    assert.equal(error instanceof BackupSelectiveRestorePolicyError, true);
    return error.code;
  }
}

test("normalizes selective restore domains and removes logical RBAC from physical writes", () => {
  assert.deepEqual(validateSelectiveRestoreDomains([
    "catalog",
    "rbac",
    "local-auth",
    "settings",
  ]), {
    selectedDomains: ["settings", "local-auth", "rbac", "catalog"],
    physicalDomains: ["settings", "local-auth", "catalog"],
    sessionPolicy: "revoke",
    operationApprovalBundle: false,
  });
});

test("requires RBAC to be restored with local-auth", () => {
  assert.equal(codeOf(() => validateSelectiveRestoreDomains(["rbac"])), "backup_restore_dependency_invalid");
});

test("requires operations and approvals as one dependency bundle", () => {
  assert.equal(codeOf(() => validateSelectiveRestoreDomains(["operations"])), "backup_restore_dependency_invalid");
  assert.equal(codeOf(() => validateSelectiveRestoreDomains(["approvals"])), "backup_restore_dependency_invalid");
  assert.deepEqual(validateSelectiveRestoreDomains(["approvals", "operations"]), {
    selectedDomains: ["operations", "approvals"],
    physicalDomains: ["operations", "approvals"],
    sessionPolicy: "revoke",
    operationApprovalBundle: true,
  });
});

test("rejects audit and malformed selections before restore work", () => {
  for (const value of [
    ["audit"],
    [],
    ["settings", "settings"],
    ["unknown"],
    "settings",
    null,
  ]) {
    const expected = Array.isArray(value) && value.includes("audit")
      ? "backup_restore_domain_unsupported"
      : "backup_restore_dependency_invalid";
    assert.equal(codeOf(() => validateSelectiveRestoreDomains(value)), expected);
  }
});

test("keeps independent supported domains in canonical order", () => {
  assert.deepEqual(validateSelectiveRestoreDomains(["catalog", "policies", "settings"]), {
    selectedDomains: ["settings", "policies", "catalog"],
    physicalDomains: ["settings", "policies", "catalog"],
    sessionPolicy: "revoke",
    operationApprovalBundle: false,
  });
});
