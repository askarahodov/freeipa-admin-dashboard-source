import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { FULL_BACKUP_TABLES } from "../backup-full-domains.ts";
import { PORTAL_BACKUP_DOMAINS } from "../backup-manifest.ts";
import {
  decryptPortalEnvelope,
  fingerprintRecoveryFile,
  inspectRecoveryDatabase,
  loadRecoveryMaintenance,
  statRecoveryDiskSpace,
  verifyRecoveryEncryptedMaterial,
} from "../recovery-local-adapters.ts";

const keyHex = "11".repeat(32);

async function encrypt(value, keyValue = keyHex) {
  const key = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(keyValue.match(/.{2}/gu), (pair) => Number.parseInt(pair, 16)),
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const iv = Uint8Array.from({ length: 12 }, (_, index) => index + 1);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return `v1.${Buffer.from(iv).toString("base64")}.${Buffer.from(ciphertext).toString("base64")}`;
}

function sourceFixture(envelopes) {
  const payloads = new Map();
  const tableCounts = {};
  for (const [domain, definitions] of FULL_BACKUP_TABLES) {
    const tables = definitions.map((definition) => {
      let rows = [];
      if (definition.name === "app_settings") rows = [["main", "{}", envelopes.settings, 1]];
      if (definition.name === "portal_settings_drafts") rows = [["d1", 1, "{}", "", "draft", "{}", "admin", 1, 1, null, null]];
      if (definition.name === "operation_run_replays") rows = [["r1", "event", "3", envelopes.replay, 1, null, null, 1]];
      if (definition.name === "operation_approvals") rows = [[
        "a1", "event", "Approve", "danger", "3", "requester", "operator", "[]", "pending", 1,
        "[]", "[]", 1, "rule", "{}", envelopes.approval, "fingerprint", 10, 1, 1,
        null, null, null, null, null,
      ]];
      tableCounts[definition.name] = rows.length;
      return { name: definition.name, columns: [...definition.columns], primaryKey: [...definition.primaryKey], rows };
    });
    payloads.set(domain, { domain, schemaVersion: 3, tables });
  }
  return {
    manifestSha256: "a".repeat(64),
    sourceSchemaVersion: 3,
    domains: Object.freeze([...PORTAL_BACKUP_DOMAINS]),
    payloads,
    tableCounts: Object.freeze(tableCounts),
    totalRecords: Object.values(tableCounts).reduce((sum, count) => sum + count, 0),
    documentBytes: 1024,
  };
}

test("decrypts the production v1 portal envelope with hex or base64 keys", async () => {
  const envelope = await encrypt({ hello: "world" });
  assert.deepEqual(await decryptPortalEnvelope(envelope, keyHex), { hello: "world" });
  assert.deepEqual(
    await decryptPortalEnvelope(envelope, Buffer.from(keyHex, "hex").toString("base64")),
    { hello: "world" },
  );
  await assert.rejects(
    decryptPortalEnvelope(envelope, "22".repeat(32)),
    (error) => error.code === "recovery_encryption_material_invalid" && !/world|11/u.test(error.message),
  );
});

test("verifies settings replay and approval encrypted material", async () => {
  const source = sourceFixture({
    settings: await encrypt({ ipaPassword: "secret" }),
    replay: await encrypt({ values: { user: "alice" }, targets: [] }),
    approval: await encrypt({ values: { user: "alice" }, targets: [] }),
  });
  assert.deepEqual(await verifyRecoveryEncryptedMaterial(source, keyHex), {
    settings: "ok",
    replays: "ok",
    approvals: "ok",
  });

  source.payloads.get("operations").tables.find((item) => item.name === "operation_run_replays").rows[0][3] = "v1.invalid.invalid";
  await assert.rejects(
    verifyRecoveryEncryptedMaterial(source, keyHex),
    (error) => error.code === "recovery_encryption_material_invalid",
  );
});

test("fingerprints a regular file and reports available disk bytes", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "recovery-adapters-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "value.bin");
  await writeFile(path, "hello", { mode: 0o600 });
  const fingerprint = await fingerprintRecoveryFile(path);
  assert.equal(fingerprint.bytes, 5);
  assert.equal(fingerprint.sha256, "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  const space = await statRecoveryDiskSpace(root);
  assert.equal(Number.isSafeInteger(space.availableBytes), true);
  assert.ok(space.availableBytes > 0);
});

test("parses bounded schema and maintenance query output", async () => {
  const scripts = [];
  const sqlite = async (input) => {
    scripts.push(input.script);
    if (input.script.includes("FROM portal_maintenance_state")) {
      return { stdout: `active|maintenance_22222222-2222-4222-8222-222222222222|${"a".repeat(64)}\n` };
    }
    return { stdout: "3|5\n" };
  };
  assert.deepEqual(await inspectRecoveryDatabase("/data/live.sqlite", { runSqlite: sqlite }), {
    state: "ready",
    currentVersion: 3,
  });
  assert.deepEqual(await loadRecoveryMaintenance("/data/live.sqlite", { runSqlite: sqlite }), {
    state: "active",
    operationId: "maintenance_22222222-2222-4222-8222-222222222222",
    controllerSecretHash: "a".repeat(64),
  });
  assert.equal(scripts.length, 2);
});
