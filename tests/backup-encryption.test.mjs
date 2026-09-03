import test from "node:test";
import assert from "node:assert/strict";
import {
  BACKUP_KDF_ITERATIONS,
  MAX_BACKUP_PASSWORD_BYTES,
  BackupEncryptionError,
  backupPayloadAad,
  createBackupIv,
  createBackupSalt,
  decryptBackupPayload,
  deriveBackupKey,
  encryptBackupPayload,
  validateBackupPassword,
  validateEncryptedDocumentBytes,
  validateEncryptedEnvelope,
} from "../src/backup/crypto/backup-encryption.ts";

const context = { format: "freeipa-admin-dashboard-backup", version: 1, schemaVersion: 1, domain: "settings", path: "domains/settings.json" };
const fixedRandom = (...chunks) => { let index = 0; return { randomBytes(length) { const chunk = chunks[index++]; assert.equal(chunk.length, length); return Uint8Array.from(chunk); } }; };
function expectCode(fn, code) { assert.throws(fn, (error) => error instanceof BackupEncryptionError && error.code === code); }

test("validates password byte limits, KDF floor and document limit", () => {
  expectCode(() => validateBackupPassword(""), "backup_password_invalid");
  expectCode(() => validateBackupPassword("x".repeat(MAX_BACKUP_PASSWORD_BYTES + 1)), "backup_password_invalid");
  assert.equal(validateBackupPassword("сильный пароль").byteLength > 0, true);
  assert.equal(BACKUP_KDF_ITERATIONS >= 210_000, true);
  assert.equal(validateEncryptedDocumentBytes(1024), 1024);
  expectCode(() => validateEncryptedDocumentBytes(19 * 1024 * 1024), "backup_document_too_large");
});

test("creates strict-size random salt and IV", () => {
  const random = fixedRandom(Array.from({ length: 16 }, (_, index) => index), Array.from({ length: 12 }, (_, index) => 100 + index));
  const salt = createBackupSalt(random);
  const iv = createBackupIv(random);
  assert.equal(Buffer.from(salt, "base64").byteLength, 16);
  assert.equal(Buffer.from(iv, "base64").byteLength, 12);
  const validCiphertext = Buffer.from(Array.from({ length: 16 }, (_, index) => index + 1)).toString("base64");
  assert.deepEqual(validateEncryptedEnvelope({ iv, ciphertext: validCiphertext }), { iv, ciphertext: validCiphertext });
  expectCode(() => validateEncryptedEnvelope({ iv: "not base64", ciphertext: validCiphertext }), "backup_envelope_invalid");
  expectCode(() => validateEncryptedEnvelope({ iv, ciphertext: "AQIDBA" }), "backup_envelope_invalid");
});

test("encrypts deterministically with fixed key context and IV and decrypts", async () => {
  const password = "correct horse battery staple";
  const salt = Buffer.from(Array.from({ length: 16 }, (_, index) => index + 1)).toString("base64");
  const iv = Buffer.from(Array.from({ length: 12 }, (_, index) => index + 20)).toString("base64");
  const key = await deriveBackupKey(password, salt, 210_000);
  const payload = { domain: "settings", tables: [{ name: "app_settings", rows: [["main", "ciphertext"]] }] };
  const first = await encryptBackupPayload({ key, context, payload, iv });
  const second = await encryptBackupPayload({ key, context, payload, iv });
  assert.deepEqual(first, second);
  assert.deepEqual(await decryptBackupPayload({ key, context, envelope: first }), payload);
  assert.equal(backupPayloadAad(context) instanceof Uint8Array, true);
});

test("normalizes wrong password and authenticated tampering", async () => {
  const salt = Buffer.from(Array.from({ length: 16 }, (_, index) => 50 + index)).toString("base64");
  const iv = Buffer.from(Array.from({ length: 12 }, (_, index) => 80 + index)).toString("base64");
  const key = await deriveBackupKey("right password", salt, 210_000);
  const wrongKey = await deriveBackupKey("wrong password", salt, 210_000);
  const envelope = await encryptBackupPayload({ key, context, payload: { secret: "inside ciphertext" }, iv });
  await assert.rejects(decryptBackupPayload({ key: wrongKey, context, envelope }), (error) => error instanceof BackupEncryptionError && error.code === "backup_decryption_failed" && error.message === "Backup decryption failed");
  await assert.rejects(decryptBackupPayload({ key, context: { ...context, domain: "audit", path: "domains/audit.json" }, envelope }), (error) => error instanceof BackupEncryptionError && error.code === "backup_decryption_failed");
  const bytes = Buffer.from(envelope.ciphertext, "base64");
  bytes[0] ^= 1;
  await assert.rejects(decryptBackupPayload({ key, context, envelope: { ...envelope, ciphertext: bytes.toString("base64") } }), (error) => error instanceof BackupEncryptionError && error.code === "backup_decryption_failed");
});
