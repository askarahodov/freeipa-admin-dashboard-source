import assert from "node:assert/strict";
import { chmod, lstat, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  RECOVERY_POINT_MAGIC,
  createRecoveryPoint,
  decryptRecoveryPointFile,
  encryptRecoveryPointFile,
} from "../recovery-point.ts";

const password = "offline recovery point password";
const createdAt = "2026-08-04T08:00:00.000Z";
const salt = Buffer.from(Array.from({ length: 16 }, (_, index) => index + 1)).toString("base64");
const iv = Buffer.from(Array.from({ length: 12 }, (_, index) => index + 31)).toString("base64");
const sourceBytes = Buffer.concat([
  Buffer.from("SQLite format 3\0", "binary"),
  Buffer.from("offline recovery fixture data".repeat(200)),
]);

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "portal-recovery-point-"));
  const sourcePath = join(root, "source.sqlite");
  const encryptedPath = join(root, "point.sqlite.enc");
  const restoredPath = join(root, "restored.sqlite");
  await writeFile(sourcePath, sourceBytes, { mode: 0o600 });
  return { root, sourcePath, encryptedPath, restoredPath };
}

async function expectCode(promise, code) {
  await assert.rejects(
    promise,
    (error) => error && error.code === code && !String(error.message).includes(password),
  );
}

test("encrypts and decrypts a versioned authenticated raw sqlite recovery point", async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));

  const encrypted = await encryptRecoveryPointFile({
    sourcePath: value.sourcePath,
    destinationPath: value.encryptedPath,
    password,
    createdAt,
    iterations: 210_000,
    salt,
    iv,
  });
  assert.equal(encrypted.header.format, "portal-recovery-sqlite-v1");
  assert.equal(encrypted.header.version, 1);
  assert.equal(encrypted.header.algorithm, "AES-256-GCM");
  assert.equal(encrypted.header.kdf, "PBKDF2-SHA-256");
  assert.equal(encrypted.header.plaintextBytes, sourceBytes.length);
  assert.match(encrypted.header.plaintextSha256, /^[a-f0-9]{64}$/u);
  assert.match(encrypted.artifactSha256, /^[a-f0-9]{64}$/u);
  assert.ok(encrypted.artifactBytes > sourceBytes.length);
  assert.equal((await stat(value.encryptedPath)).mode & 0o777, 0o600);

  const artifact = await readFile(value.encryptedPath);
  assert.equal(artifact.subarray(0, RECOVERY_POINT_MAGIC.length).equals(RECOVERY_POINT_MAGIC), true);
  const headerLength = artifact.readUInt32BE(RECOVERY_POINT_MAGIC.length);
  assert.ok(headerLength > 0 && headerLength < 16_384);
  const headerText = artifact.subarray(RECOVERY_POINT_MAGIC.length + 4, RECOVERY_POINT_MAGIC.length + 4 + headerLength).toString("utf8");
  assert.deepEqual(JSON.parse(headerText), encrypted.header);

  const decrypted = await decryptRecoveryPointFile({
    sourcePath: value.encryptedPath,
    destinationPath: value.restoredPath,
    password,
  });
  assert.deepEqual(decrypted.header, encrypted.header);
  assert.equal(decrypted.plaintextSha256, encrypted.header.plaintextSha256);
  assert.equal(decrypted.plaintextBytes, sourceBytes.length);
  assert.deepEqual(await readFile(value.restoredPath), sourceBytes);
  assert.equal((await stat(value.restoredPath)).mode & 0o777, 0o600);
});

test("wrong password truncated ciphertext and authenticated-header damage share one safe error", async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  await encryptRecoveryPointFile({
    sourcePath: value.sourcePath,
    destinationPath: value.encryptedPath,
    password,
    createdAt,
    iterations: 210_000,
    salt,
    iv,
  });

  await expectCode(decryptRecoveryPointFile({
    sourcePath: value.encryptedPath,
    destinationPath: join(value.root, "wrong-password.sqlite"),
    password: "wrong recovery point password",
  }), "recovery_point_decryption_failed");

  const original = await readFile(value.encryptedPath);
  const truncated = join(value.root, "truncated.enc");
  await writeFile(truncated, original.subarray(0, original.length - 8), { mode: 0o600 });
  await expectCode(decryptRecoveryPointFile({
    sourcePath: truncated,
    destinationPath: join(value.root, "truncated.sqlite"),
    password,
  }), "recovery_point_decryption_failed");

  const damaged = Buffer.from(original);
  const headerStart = RECOVERY_POINT_MAGIC.length + 4;
  damaged[headerStart + 10] ^= 1;
  const damagedPath = join(value.root, "damaged-header.enc");
  await writeFile(damagedPath, damaged, { mode: 0o600 });
  await expectCode(decryptRecoveryPointFile({
    sourcePath: damagedPath,
    destinationPath: join(value.root, "damaged.sqlite"),
    password,
  }), "recovery_point_decryption_failed");
});

test("rejects symlink sources and existing destinations without overwriting", async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  const linked = join(value.root, "linked.sqlite");
  await symlink(value.sourcePath, linked);
  await writeFile(value.encryptedPath, "existing", { mode: 0o600 });

  await expectCode(encryptRecoveryPointFile({
    sourcePath: linked,
    destinationPath: join(value.root, "linked.enc"),
    password,
  }), "recovery_point_path_invalid");
  await expectCode(encryptRecoveryPointFile({
    sourcePath: value.sourcePath,
    destinationPath: value.encryptedPath,
    password,
  }), "recovery_point_destination_exists");
  assert.equal(await readFile(value.encryptedPath, "utf8"), "existing");
});

test("orchestrates mandatory checkpoint backup double verification encryption and receipt write", async () => {
  const calls = [];
  const removed = [];
  const preflight = {
    database: {
      relativePath: "state/v3/d1/opaque.sqlite",
      sha256: "a".repeat(64),
      bytes: 1024,
      schemaVersion: 3,
    },
    maintenance: {
      state: "active",
      operationId: "maintenance_22222222-2222-4222-8222-222222222222",
    },
    backup: {
      manifestSha256: "b".repeat(64),
      sourceSchemaVersion: 3,
      domains: 8,
      tables: 24,
      records: 10,
      documentBytes: 2048,
    },
  };
  const sourceTemp = "/artifacts/.source-temp.sqlite";
  const verifyTemp = "/artifacts/.verify-temp.sqlite";
  const recoveryPointPath = "/artifacts/points/recovery.enc";
  const receiptPath = "/artifacts/receipts/recovery.json";
  const receipt = await createRecoveryPoint({
    liveDatabasePath: "/data/state/v3/d1/opaque.sqlite",
    artifactRoot: "/artifacts",
    recoveryPointPath,
    receiptPath,
    recoveryPassword: password,
    operationId: "recovery_11111111-1111-4111-8111-111111111111",
    createdAt,
    preflight,
  }, {
    async createTemporaryPath(_root, purpose) {
      calls.push(`temp:${purpose}`);
      return purpose === "source" ? sourceTemp : verifyTemp;
    },
    async checkpoint(path) {
      calls.push(`checkpoint:${path}`);
      return { checkpoint: "ok", busy: 0, logFrames: 0, checkpointedFrames: 0 };
    },
    async backup(source, destination) {
      calls.push(`backup:${source}->${destination}`);
      return { backup: "ok" };
    },
    async verifyIntegrity(path) {
      calls.push(`integrity:${path}`);
      return { integrity: "ok" };
    },
    async verifySchema(path, version) {
      calls.push(`schema:${path}:${version}`);
      return { schema: "ok" };
    },
    async fingerprint(path) {
      calls.push(`fingerprint:${path}`);
      if (path === sourceTemp || path === verifyTemp) return { sha256: "d".repeat(64), bytes: 1024 };
      if (path === recoveryPointPath) return { sha256: "c".repeat(64), bytes: 2048 };
      throw new Error("unexpected fingerprint path");
    },
    async encrypt(input) {
      calls.push(`encrypt:${input.sourcePath}->${input.destinationPath}`);
      return {
        header: { plaintextSha256: "d".repeat(64), plaintextBytes: 1024 },
        artifactSha256: "c".repeat(64),
        artifactBytes: 2048,
      };
    },
    async decrypt(input) {
      calls.push(`decrypt:${input.sourcePath}->${input.destinationPath}`);
      return { header: { plaintextSha256: "d".repeat(64), plaintextBytes: 1024 }, plaintextSha256: "d".repeat(64), plaintextBytes: 1024 };
    },
    async remove(path) {
      calls.push(`remove:${path}`);
      removed.push(path);
    },
    async writeReceipt(path, value) {
      calls.push(`receipt:${path}`);
      assert.equal(path, receiptPath);
      return value;
    },
  });

  assert.deepEqual(calls, [
    "temp:source",
    "temp:verify",
    "checkpoint:/data/state/v3/d1/opaque.sqlite",
    "backup:/data/state/v3/d1/opaque.sqlite->/artifacts/.source-temp.sqlite",
    "integrity:/artifacts/.source-temp.sqlite",
    "schema:/artifacts/.source-temp.sqlite:3",
    "fingerprint:/artifacts/.source-temp.sqlite",
    "encrypt:/artifacts/.source-temp.sqlite->/artifacts/points/recovery.enc",
    "fingerprint:/artifacts/points/recovery.enc",
    "decrypt:/artifacts/points/recovery.enc->/artifacts/.verify-temp.sqlite",
    "fingerprint:/artifacts/.verify-temp.sqlite",
    "integrity:/artifacts/.verify-temp.sqlite",
    "schema:/artifacts/.verify-temp.sqlite:3",
    "receipt:/artifacts/receipts/recovery.json",
    "remove:/artifacts/.source-temp.sqlite",
    "remove:/artifacts/.verify-temp.sqlite",
  ]);
  assert.deepEqual(removed, [sourceTemp, verifyTemp]);
  assert.equal(receipt.phase, "recovery_point_ready");
  assert.equal(receipt.recoveryPointSha256, "c".repeat(64));
  assert.equal(receipt.recoveryPointBytes, 2048);
});

test("always removes plaintext temporary copies when recovery point creation fails", async () => {
  const removed = [];
  await expectCode(createRecoveryPoint({
    liveDatabasePath: "/data/live.sqlite",
    artifactRoot: "/artifacts",
    recoveryPointPath: "/artifacts/point.enc",
    receiptPath: "/artifacts/receipt.json",
    recoveryPassword: password,
    operationId: "recovery_11111111-1111-4111-8111-111111111111",
    createdAt,
    preflight: {
      database: { relativePath: "live.sqlite", sha256: "a".repeat(64), bytes: 1024, schemaVersion: 3 },
      maintenance: { state: "active", operationId: "maintenance_22222222-2222-4222-8222-222222222222" },
      backup: { manifestSha256: "b".repeat(64), sourceSchemaVersion: 3, domains: 8, tables: 24, records: 1, documentBytes: 100 },
    },
  }, {
    async createTemporaryPath(_root, purpose) { return `/artifacts/${purpose}.tmp`; },
    async checkpoint() { return { checkpoint: "ok", busy: 0, logFrames: 0, checkpointedFrames: 0 }; },
    async backup() { return { backup: "ok" }; },
    async verifyIntegrity() { return { integrity: "ok" }; },
    async verifySchema() { return { schema: "ok" }; },
    async fingerprint(path) {
      if (path.endsWith("source.tmp")) return { sha256: "d".repeat(64), bytes: 1024 };
      throw new Error("raw injected fingerprint failure");
    },
    async encrypt() { return { header: {}, artifactSha256: "c".repeat(64), artifactBytes: 2048 }; },
    async decrypt() { throw new Error("not reached"); },
    async remove(path) { removed.push(path); },
    async writeReceipt() { throw new Error("not reached"); },
  }), "recovery_point_creation_failed");
  assert.deepEqual(removed.sort(), ["/artifacts/source.tmp", "/artifacts/verify.tmp"]);
});
