import assert from "node:assert/strict";
import test from "node:test";

import {
  PORTAL_BACKUP_FORMAT,
  PORTAL_BACKUP_VERSION,
  assertSanitizedBackupPayload,
  canonicalBackupJson,
  createBackupEntry,
  sha256Hex,
  validateBackupManifest,
} from "../backup-manifest.ts";

test("canonical backup JSON and checksum are deterministic", async () => {
  const left = canonicalBackupJson({ z: 1, nested: { b: 2, a: 1 } });
  const right = canonicalBackupJson({ nested: { a: 1, b: 2 }, z: 1 });
  assert.equal(left, right);
  assert.equal(await sha256Hex(left), await sha256Hex(right));
});

test("creates a versioned sanitized manifest entry", async () => {
  const payload = { users: [{ username: "admin", role: "admin" }] };
  assertSanitizedBackupPayload(payload);
  const entry = await createBackupEntry({ domain: "local-auth", path: "domains/local-auth.json", payload, records: 1 });
  const manifest = validateBackupManifest({
    format: PORTAL_BACKUP_FORMAT,
    version: PORTAL_BACKUP_VERSION,
    createdAt: "2026-07-30T13:00:00.000Z",
    schemaVersion: 1,
    mode: "sanitized",
    domains: ["local-auth"],
    entries: [entry],
    encryption: null,
  });
  assert.equal(manifest.entries[0].records, 1);
  assert.match(manifest.entries[0].sha256, /^[a-f0-9]{64}$/);
});

test("sanitized payload rejects secret and encryption material at any depth", () => {
  assert.throws(() => assertSanitizedBackupPayload({ settings: { CONFIG_ENCRYPTION_KEY: "forbidden" } }), /forbidden field/);
  assert.throws(() => assertSanitizedBackupPayload({ users: [{ passwordHash: "forbidden" }] }), /forbidden field/);
  assert.throws(() => assertSanitizedBackupPayload({ integration: { encryptedSecrets: "forbidden" } }), /forbidden field/);
});

test("rejects incompatible, malformed and unsafe manifests before mutation", () => {
  const base = {
    format: PORTAL_BACKUP_FORMAT,
    version: PORTAL_BACKUP_VERSION,
    createdAt: "2026-07-30T13:00:00.000Z",
    schemaVersion: 1,
    mode: "sanitized",
    domains: ["settings"],
    entries: [],
    encryption: null,
  };
  assert.throws(() => validateBackupManifest({ ...base, version: 2 }), /version/);
  assert.throws(() => validateBackupManifest({ ...base, domains: ["settings", "settings"] }), /Duplicate/);
  assert.throws(() => validateBackupManifest({ ...base, entries: [{ domain: "settings", path: "../escape", bytes: 1, sha256: "a".repeat(64), records: 1 }] }), /path/);
  assert.throws(() => validateBackupManifest({ ...base, mode: "sanitized", encryption: { algorithm: "AES-256-GCM" } }), /must not declare encryption/);
});

test("encrypted manifests require strong explicit backup encryption metadata", () => {
  const base = {
    format: PORTAL_BACKUP_FORMAT,
    version: PORTAL_BACKUP_VERSION,
    createdAt: "2026-07-30T13:00:00.000Z",
    schemaVersion: 1,
    mode: "encrypted",
    domains: ["settings"],
    entries: [],
  };
  assert.throws(() => validateBackupManifest({ ...base, encryption: null }), /requires encryption metadata/);
  assert.throws(() => validateBackupManifest({ ...base, encryption: { algorithm: "AES-256-GCM", kdf: "PBKDF2-SHA-256", iterations: 1000, salt: "YWJjZGVmZ2hpamtsbW5vcA==" } }), /too low/);
  assert.doesNotThrow(() => validateBackupManifest({ ...base, encryption: { algorithm: "AES-256-GCM", kdf: "PBKDF2-SHA-256", iterations: 310000, salt: "YWJjZGVmZ2hpamtsbW5vcA==" } }));
});
