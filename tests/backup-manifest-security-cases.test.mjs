import assert from "node:assert/strict";
import test from "node:test";

import { assertSanitizedBackupPayload, canonicalBackupJson } from "../src/backup/backup-manifest.ts";

test("canonical backup JSON rejects unsupported and non-finite values", () => {
  assert.throws(() => canonicalBackupJson({ missing: undefined }), /unsupported value/);
  assert.throws(() => canonicalBackupJson({ invalid: Number.NaN }), /non-finite number/);
  assert.throws(() => canonicalBackupJson({ invalid: Number.POSITIVE_INFINITY }), /non-finite number/);
});

test("sanitized payload rejects normalized secret field variants", () => {
  for (const field of [
    "password_hash",
    "encrypted_secrets",
    "session_token",
    "xyops_api_key",
    "config_encryption_key",
  ]) {
    assert.throws(() => assertSanitizedBackupPayload({ nested: { [field]: "redacted" } }), /forbidden field/);
  }
});
