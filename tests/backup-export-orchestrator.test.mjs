import assert from "node:assert/strict";
import test from "node:test";

import { canonicalBackupJson, sha256Hex } from "../backup-manifest.ts";
import { BackupExportError, exportSanitizedBackup } from "../src/backup/export/backup-export.ts";

function exporter(domain, payload, records, calls) {
  return {
    domain,
    path: `domains/${domain}.json`,
    async export() {
      calls.push(domain);
      return { payload, records };
    },
  };
}

test("exports selected domains in canonical order with manifest/payload bijection", async () => {
  const calls = [];
  const settingsPayload = { records: [{ key: "theme", value: "dark" }] };
  const auditPayload = { records: [{ id: "evt-1", action: "login" }] };
  const registry = new Map([
    ["audit", exporter("audit", auditPayload, 1, calls)],
    ["settings", exporter("settings", settingsPayload, 1, calls)],
  ]);

  const document = await exportSanitizedBackup(
    { DB: {} },
    {
      domains: ["settings", "audit"],
      schemaVersion: 1,
      createdAt: "2026-07-30T14:00:00.000Z",
    },
    registry,
  );

  assert.deepEqual(calls, ["settings", "audit"]);
  assert.deepEqual(document.manifest.domains, ["settings", "audit"]);
  assert.deepEqual(
    document.manifest.entries.map((entry) => entry.path),
    Object.keys(document.payloads),
  );
  assert.deepEqual(document.payloads["domains/settings.json"], settingsPayload);
  assert.deepEqual(document.payloads["domains/audit.json"], auditPayload);
  assert.deepEqual(document.summary, {
    entries: 2,
    records: 2,
    bytes: document.manifest.entries.reduce((sum, entry) => sum + entry.bytes, 0),
  });

  for (const entry of document.manifest.entries) {
    const payload = document.payloads[entry.path];
    const canonical = canonicalBackupJson(payload);
    assert.equal(entry.bytes, new TextEncoder().encode(canonical).byteLength);
    assert.equal(entry.sha256, await sha256Hex(canonical));
  }
});

test("rejects an unavailable database before invoking exporters", async () => {
  const calls = [];
  const registry = new Map([
    ["settings", exporter("settings", { records: [] }, 0, calls)],
  ]);

  await assert.rejects(
    exportSanitizedBackup(
      {},
      { domains: ["settings"], schemaVersion: 1, createdAt: "2026-07-30T14:00:00.000Z" },
      registry,
    ),
    (error) => error instanceof BackupExportError && error.code === "backup_database_unavailable" && error.status === 503,
  );
  assert.deepEqual(calls, []);
});

test("fails all-or-nothing and does not invoke exporters after a failure", async () => {
  const calls = [];
  const registry = new Map([
    ["settings", exporter("settings", { records: [] }, 0, calls)],
    ["catalog", {
      domain: "catalog",
      path: "domains/catalog.json",
      async export() {
        calls.push("catalog");
        throw new Error("catalog read failed");
      },
    }],
    ["audit", exporter("audit", { records: [] }, 0, calls)],
  ]);

  await assert.rejects(
    exportSanitizedBackup(
      { DB: {} },
      {
        domains: ["settings", "catalog", "audit"],
        schemaVersion: 1,
        createdAt: "2026-07-30T14:00:00.000Z",
      },
      registry,
    ),
    /catalog read failed/,
  );
  assert.deepEqual(calls, ["settings", "catalog"]);
});

test("rejects missing registry entries as schema incompatibility", async () => {
  await assert.rejects(
    exportSanitizedBackup(
      { DB: {} },
      { domains: ["settings"], schemaVersion: 1, createdAt: "2026-07-30T14:00:00.000Z" },
      new Map(),
    ),
    (error) => error instanceof BackupExportError && error.code === "backup_schema_incompatible" && error.status === 409,
  );
});
