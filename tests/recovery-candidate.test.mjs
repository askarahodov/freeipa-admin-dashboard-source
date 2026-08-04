import assert from "node:assert/strict";
import test from "node:test";

import { FULL_BACKUP_TABLES } from "../backup-full-domains.ts";
import { PORTAL_BACKUP_DOMAINS } from "../backup-manifest.ts";
import {
  buildRecoveryCandidate,
  buildRecoveryCandidateScript,
  encodeRecoverySqliteLiteral,
  validateRecoveryRbacProjection,
} from "../recovery-candidate.ts";
import { createRecoveryRestorePolicy } from "../recovery-restore-policy.ts";

function sourceFixture() {
  const payloads = new Map();
  const tableCounts = {};
  for (const [domain, definitions] of FULL_BACKUP_TABLES) {
    const tables = definitions.map((definition) => {
      let rows = [];
      if (definition.name === "portal_users") {
        rows = [[
          "user-1", "admin", "Admin '); DROP TABLE portal_users; --",
          "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
          "AAAAAAAAAAAAAAAAAAAAAA==", 310000, "admin", 0, 0, null, 1, 1, null,
        ]];
      }
      if (definition.name === "portal_role_assignments") {
        rows = [["user-1", "admin", "admin", 0]];
      }
      tableCounts[definition.name] = rows.length;
      return {
        name: definition.name,
        columns: [...definition.columns],
        primaryKey: [...definition.primaryKey],
        rows,
      };
    });
    payloads.set(domain, { domain, schemaVersion: 3, tables });
  }
  return Object.freeze({
    manifestSha256: "a".repeat(64),
    sourceSchemaVersion: 3,
    domains: Object.freeze([...PORTAL_BACKUP_DOMAINS]),
    payloads,
    tableCounts: Object.freeze(tableCounts),
    totalRecords: Object.values(tableCounts).reduce((sum, value) => sum + value, 0),
    documentBytes: 1024,
  });
}

function policyFor(source) {
  return createRecoveryRestorePolicy({
    selectedDomains: source.domains,
    backupTables: FULL_BACKUP_TABLES.flatMap(([, tables]) => tables.map((table) => table.name)),
  });
}

test("SQLite literal encoder supports only validated scalar values", () => {
  assert.equal(encodeRecoverySqliteLiteral(null), "NULL");
  assert.equal(encodeRecoverySqliteLiteral(true), "1");
  assert.equal(encodeRecoverySqliteLiteral(false), "0");
  assert.equal(encodeRecoverySqliteLiteral(42), "42");
  assert.equal(encodeRecoverySqliteLiteral(-0), "0");
  assert.equal(encodeRecoverySqliteLiteral("a'b"), "'a''b'");
  assert.throws(
    () => encodeRecoverySqliteLiteral(Number.POSITIVE_INFINITY),
    (error) => error.code === "recovery_candidate_payload_invalid",
  );
  assert.throws(
    () => encodeRecoverySqliteLiteral({ value: "x" }),
    (error) => error.code === "recovery_candidate_payload_invalid",
  );
});

test("RBAC projection must exactly match restored portal users", () => {
  const source = sourceFixture();
  assert.deepEqual(validateRecoveryRbacProjection(source), { rbac: "ok", users: 1 });

  const rbac = source.payloads.get("rbac").tables[0];
  rbac.rows[0][2] = "viewer";
  assert.throws(
    () => validateRecoveryRbacProjection(source),
    (error) => error.code === "recovery_candidate_rbac_invalid",
  );
});

test("candidate SQL replaces only allowlisted tables and discards sessions", () => {
  const source = sourceFixture();
  const script = buildRecoveryCandidateScript({
    source,
    policy: policyFor(source),
    operationId: "recovery_123e4567-e89b-42d3-a456-426614174000",
    schemaVersion: 3,
    now: 1_754_302_000_000,
    auditId: "audit-1",
  });

  assert.match(script, /BEGIN IMMEDIATE;/u);
  assert.match(script, /DROP TRIGGER IF EXISTS "portal_audit_events_no_update";/u);
  assert.match(script, /DELETE FROM "portal_sessions";/u);
  assert.match(script, /DELETE FROM "portal_backup_restore_stages";/u);
  assert.match(script, /INSERT INTO "portal_users"/u);
  assert.doesNotMatch(script, /INSERT INTO "portal_sessions"/u);
  assert.doesNotMatch(script, /INSERT INTO "portal_role_assignments"/u);
  assert.match(script, /Admin ''\); DROP TABLE portal_users; --/u);
  assert.match(script, /portal\.full_restore\.candidate_verified/u);
  assert.match(script, /CREATE TRIGGER IF NOT EXISTS portal_audit_events_no_delete/u);
  assert.match(script, /COMMIT;/u);
});

test("candidate builder verifies live binding before and after cloning", async () => {
  const source = sourceFixture();
  const calls = [];
  let liveFingerprintCalls = 0;
  const result = await buildRecoveryCandidate({
    livePath: "/data/live.sqlite",
    candidatePath: "/data/.candidate.sqlite",
    expectedLiveSha256: "b".repeat(64),
    source,
    operationId: "recovery_123e4567-e89b-42d3-a456-426614174000",
    administratorUsername: "admin",
    administratorPassword: "password",
    configEncryptionKey: "c".repeat(64),
    schemaVersion: 3,
    now: 1_754_302_000_000,
  }, {
    async fingerprintFile(path) {
      calls.push(`fingerprint:${path}`);
      if (path === "/data/live.sqlite") {
        liveFingerprintCalls += 1;
        return { sha256: "b".repeat(64), bytes: 4096 };
      }
      return { sha256: "d".repeat(64), bytes: 8192 };
    },
    async snapshotSchema(path) {
      calls.push(`schema:${path}`);
      return "schema-snapshot";
    },
    async snapshotPreservedState(path) {
      calls.push(`preserved:${path}`);
      return "preserved-snapshot";
    },
    async backupDatabase(sourcePath, destinationPath) {
      calls.push(`backup:${sourcePath}:${destinationPath}`);
      return { backup: "ok" };
    },
    async verifyAdministrator() {
      calls.push("administrator");
      return { userId: "user-1", username: "admin" };
    },
    async verifyEncryptedMaterial() {
      calls.push("encryption");
      return { settings: "ok", replays: "ok", approvals: "ok" };
    },
    async runTransaction(path, script) {
      calls.push(`transaction:${path}`);
      assert.match(script, /BEGIN IMMEDIATE;/u);
    },
    async verifyCandidate(input) {
      calls.push(`verify:${input.candidatePath}`);
      assert.equal(input.expectedSchemaSnapshot, "schema-snapshot");
      assert.equal(input.expectedPreservedSnapshot, "preserved-snapshot");
      return {
        checks: {
          integrity: "ok",
          schema: "ok",
          preserved: "ok",
          counts: "ok",
          administrator: "ok",
          encryption: "ok",
          audit: "ok",
        },
        counts: Object.freeze({ portal_users: 1, portal_sessions: 0 }),
      };
    },
    async removeCandidate() {
      calls.push("remove");
    },
  });

  assert.equal(liveFingerprintCalls, 2);
  assert.equal(result.candidate.sha256, "d".repeat(64));
  assert.equal(result.candidate.bytes, 8192);
  assert.equal(result.checks.audit, "ok");
  assert.deepEqual(calls, [
    "fingerprint:/data/live.sqlite",
    "schema:/data/live.sqlite",
    "preserved:/data/live.sqlite",
    "administrator",
    "encryption",
    "backup:/data/live.sqlite:/data/.candidate.sqlite",
    "fingerprint:/data/live.sqlite",
    "transaction:/data/.candidate.sqlite",
    "verify:/data/.candidate.sqlite",
    "fingerprint:/data/.candidate.sqlite",
  ]);
});

test("candidate builder removes an unverified candidate on failure", async () => {
  const source = sourceFixture();
  let removed = false;
  await assert.rejects(
    buildRecoveryCandidate({
      livePath: "/data/live.sqlite",
      candidatePath: "/data/.candidate.sqlite",
      expectedLiveSha256: "b".repeat(64),
      source,
      operationId: "recovery_123e4567-e89b-42d3-a456-426614174000",
      administratorUsername: "admin",
      administratorPassword: "password",
      configEncryptionKey: "c".repeat(64),
      schemaVersion: 3,
    }, {
      async fingerprintFile(path) {
        return path.includes("candidate")
          ? { sha256: "d".repeat(64), bytes: 8192 }
          : { sha256: "b".repeat(64), bytes: 4096 };
      },
      async snapshotSchema() { return "schema"; },
      async snapshotPreservedState() { return "preserved"; },
      async backupDatabase() { return { backup: "ok" }; },
      async verifyAdministrator() { return { userId: "user-1", username: "admin" }; },
      async verifyEncryptedMaterial() { return { settings: "ok", replays: "ok", approvals: "ok" }; },
      async runTransaction() { throw new Error("raw sqlite detail"); },
      async verifyCandidate() { throw new Error("unreachable"); },
      async removeCandidate() { removed = true; },
    }),
    (error) => error.code === "recovery_candidate_failed" && !error.message.includes("raw sqlite detail"),
  );
  assert.equal(removed, true);
});
