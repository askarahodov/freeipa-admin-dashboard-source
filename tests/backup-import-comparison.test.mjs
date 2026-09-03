import assert from "node:assert/strict";
import test from "node:test";
import { createBackupEntry, PORTAL_BACKUP_FORMAT, PORTAL_BACKUP_VERSION } from "../backup-manifest.ts";
import { previewBackupImport, validateBackupImportDocument } from "../src/backup/preview/backup-import-preview.ts";

async function documentFor(domains) {
  const entries = [];
  const payloads = {};
  for (const [domain, records] of domains) {
    const path = `domains/${domain}.json`;
    const payload = { records };
    const entry = await createBackupEntry({ domain, path, payload, records: records.length });
    entries.push(entry);
    payloads[path] = payload;
  }
  return validateBackupImportDocument({
    manifest: {
      format: PORTAL_BACKUP_FORMAT,
      version: PORTAL_BACKUP_VERSION,
      createdAt: "2026-07-31T07:00:00.000Z",
      schemaVersion: 7,
      mode: "sanitized",
      domains: domains.map(([domain]) => domain),
      entries,
      encryption: null,
    },
    payloads,
    summary: {
      entries: entries.length,
      records: entries.reduce((sum, entry) => sum + entry.records, 0),
      bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
    },
  });
}

function registry(currentByDomain, calls = []) {
  return new Map(Object.entries(currentByDomain).map(([domain, records]) => [domain, {
    domain,
    path: `domains/${domain}.json`,
    async export() { calls.push(domain); return { payload: { records }, records: records.length }; },
  }]));
}

test("returns deterministic add update unchanged conflict and removeIgnored counts", async () => {
  const document = await documentFor([["settings", [
    { id: "add", value: 1, updated_at: 5 },
    { id: "same", value: 1, updated_at: 5 },
    { id: "update", value: 2, updated_at: 8 },
    { id: "conflict", value: 2, updated_at: 4 },
  ]]]);
  const result = await previewBackupImport(
    { DB: {} },
    document,
    { state: "ready", currentVersion: 7, latestVersion: 7, appliedVersions: [1, 2, 3, 4, 5, 6, 7] },
    registry({ settings: [
      { id: "same", value: 1, updated_at: 5 },
      { id: "update", value: 1, updated_at: 7 },
      { id: "conflict", value: 1, updated_at: 9 },
      { id: "only-current", value: 1, updated_at: 1 },
    ] }),
  );

  assert.deepEqual(result.summary, { add: 1, update: 1, unchanged: 1, conflict: 1, removeIgnored: 1 });
  assert.equal(result.canRestore, false);
  assert.deepEqual(result.requiredMigrations, []);
  assert.deepEqual(result.domains[0].conflicts, [{ id: "conflict" }]);
});

test("uses canonical domain order and returns required migrations for older backups", async () => {
  const document = await documentFor([
    ["settings", []],
    ["audit", []],
  ]);
  document.manifest.schemaVersion = 5;
  const calls = [];
  const result = await previewBackupImport(
    { DB: {} },
    document,
    { state: "ready", currentVersion: 7, latestVersion: 7, appliedVersions: [1, 2, 3, 4, 5, 6, 7] },
    registry({ settings: [], audit: [] }, calls),
  );
  assert.deepEqual(calls, ["settings", "audit"]);
  assert.deepEqual(result.requiredMigrations, [6, 7]);
  assert.equal(result.canRestore, false);
});

test("rejects non-ready and future schemas before querying current state", async () => {
  const document = await documentFor([["settings", []]]);
  let calls = 0;
  const exporters = new Map([["settings", { domain: "settings", path: "domains/settings.json", async export() { calls += 1; return { payload: { records: [] }, records: 0 }; } }]]);
  await assert.rejects(
    () => previewBackupImport({ DB: {} }, document, { state: "incompatible", currentVersion: 7 }, exporters),
    (error) => error.code === "backup_schema_incompatible",
  );
  assert.equal(calls, 0);

  document.manifest.schemaVersion = 8;
  await assert.rejects(
    () => previewBackupImport({ DB: {} }, document, { state: "ready", currentVersion: 7 }, exporters),
    (error) => error.code === "backup_schema_incompatible",
  );
  assert.equal(calls, 0);
});

test("returns no partial result when a current-state exporter fails", async () => {
  const document = await documentFor([["settings", []], ["audit", []]]);
  const calls = [];
  const exporters = new Map([
    ["settings", { domain: "settings", path: "domains/settings.json", async export() { calls.push("settings"); return { payload: { records: [] }, records: 0 }; } }],
    ["audit", { domain: "audit", path: "domains/audit.json", async export() { calls.push("audit"); throw new Error("raw d1 detail"); } }],
  ]);
  await assert.rejects(
    () => previewBackupImport({ DB: {} }, document, { state: "ready", currentVersion: 7 }, exporters),
    (error) => error.code === "backup_preview_failed" && !error.message.includes("raw d1 detail"),
  );
  assert.deepEqual(calls, ["settings", "audit"]);
});

test("bounds and sorts conflict identifiers", async () => {
  const incoming = Array.from({ length: 30 }, (_, index) => ({ id: `id-${String(29 - index).padStart(2, "0")}`, value: 2, updated_at: 1 }));
  const current = incoming.map((row) => ({ ...row, value: 1, updated_at: 2 }));
  const document = await documentFor([["settings", incoming]]);
  const result = await previewBackupImport({ DB: {} }, document, { state: "ready", currentVersion: 7 }, registry({ settings: current }));
  assert.equal(result.domains[0].conflicts.length, 20);
  assert.deepEqual(result.domains[0].conflicts.slice(0, 3), [{ id: "id-00" }, { id: "id-01" }, { id: "id-02" }]);
});

test("uses explicit stable identities for every supported domain record shape", async () => {
  const domainRecords = [
    ["settings", [{ id: "settings-main", updated_at: 1 }]],
    ["local-auth", [{ id: "user-1", username: "admin", updated_at: 1 }]],
    ["rbac", [{ identity_id: "user-1", role: "admin", updated_at: 1 }]],
    ["policies", [{ type: "approval", id: "default", updated_at: 1 }]],
    ["catalog", [{ type: "snapshot", id: "current", synced_at: 1 }]],
    ["operations", [
      { type: "run", id: "run-1", updated_at: 1 },
      { type: "result", run_id: "run-1", job_id: "job-1", captured_at: 1 },
    ]],
    ["approvals", [
      { type: "approval", id: "approval-1", updated_at: 1 },
      { type: "decision", approval_id: "approval-1", approver_identity: "admin", decided_at: 1 },
    ]],
    ["audit", [{ id: "audit-1", created_at: 1 }]],
  ];
  const document = await documentFor(domainRecords);
  const result = await previewBackupImport(
    { DB: {} },
    document,
    { state: "ready", currentVersion: 7, appliedVersions: [1, 2, 3, 4, 5, 6, 7] },
    registry(Object.fromEntries(domainRecords)),
  );
  assert.equal(result.summary.unchanged, 10);
  assert.equal(result.summary.add, 0);
  assert.equal(result.summary.update, 0);
  assert.equal(result.summary.conflict, 0);
  assert.deepEqual(result.selectedDomains, domainRecords.map(([domain]) => domain));
});
