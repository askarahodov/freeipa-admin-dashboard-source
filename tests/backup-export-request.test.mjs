import assert from "node:assert/strict";
import test from "node:test";

import { parseBackupExportRequest } from "../src/backup/export/backup-export.ts";

test("normalizes requested backup domains into canonical order", () => {
  assert.deepEqual(
    parseBackupExportRequest({ domains: ["audit", "settings", "catalog"] }),
    { domains: ["settings", "catalog", "audit"] },
  );
});

test("rejects empty, duplicate, unknown and extra request fields", () => {
  assert.throws(() => parseBackupExportRequest({ domains: [] }), /non-empty/);
  assert.throws(() => parseBackupExportRequest({ domains: ["settings", "settings"] }), /Duplicate/);
  assert.throws(() => parseBackupExportRequest({ domains: ["unknown"] }), /Unsupported/);
  assert.throws(() => parseBackupExportRequest({ domains: ["settings"], extra: true }), /Unknown request field/);
});

test("rejects non-object and non-array request shapes", () => {
  assert.throws(() => parseBackupExportRequest(null), /must be an object/);
  assert.throws(() => parseBackupExportRequest({ domains: "settings" }), /non-empty array/);
});
