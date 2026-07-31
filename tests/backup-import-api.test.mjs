import assert from "node:assert/strict";
import test from "node:test";
import { createBackupEntry, PORTAL_BACKUP_FORMAT, PORTAL_BACKUP_VERSION } from "../backup-manifest.ts";
import { handleBackupImportPreviewRequest } from "../worker/backup-import-preview-entry.ts";

const auditContext = {
  correlationId: "cor_12345678901234567890",
  actor: { identity: "admin@example.test", role: "admin", groups: [] },
};

async function backupDocument() {
  const payload = { records: [{ id: "singleton", value: 1, updated_at: 1 }] };
  const entry = await createBackupEntry({ domain: "settings", path: "domains/settings.json", payload, records: 1 });
  return {
    manifest: {
      format: PORTAL_BACKUP_FORMAT,
      version: PORTAL_BACKUP_VERSION,
      createdAt: "2026-07-31T07:00:00.000Z",
      schemaVersion: 7,
      mode: "sanitized",
      domains: ["settings"],
      entries: [entry],
      encryption: null,
    },
    payloads: { [entry.path]: payload },
    summary: { entries: 1, records: 1, bytes: entry.bytes },
  };
}

function request(body, init = {}) {
  return new Request("https://dashboard.test/api/admin/backups/import/preview", {
    method: "POST",
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...init,
  });
}

function registry(current = []) {
  return new Map([["settings", {
    domain: "settings",
    path: "domains/settings.json",
    async export() { return { payload: { records: current }, records: current.length }; },
  }]]);
}

const readySchema = async () => ({ state: "ready", currentVersion: 7, latestVersion: 7, appliedVersions: [1, 2, 3, 4, 5, 6, 7] });

test("returns a no-store read-only preview and audits counts without payloads", async () => {
  const events = [];
  const response = await handleBackupImportPreviewRequest(
    request(await backupDocument()),
    { DB: {} },
    auditContext,
    {
      registry: registry([{ id: "singleton", value: 1, updated_at: 1 }]),
      inspectSchema: readySchema,
      appendAudit: async (_env, _context, event) => { events.push(event); },
      now: () => 100,
    },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.deepEqual(body.summary, { add: 0, update: 0, unchanged: 1, conflict: 0, removeIgnored: 0 });
  assert.equal(events[0].action, "backup.import.preview.completed");
  assert.deepEqual(events[0].metadata.domains, ["settings"]);
  assert.equal("payloads" in events[0].metadata, false);
  assert.equal("conflicts" in events[0].metadata, false);
  assert.doesNotMatch(JSON.stringify(events[0]), /singleton/);
});

test("normalizes malformed, oversized, missing database and non-ready schema errors", async () => {
  const dependencies = { registry: registry(), inspectSchema: readySchema, appendAudit: async () => {} };
  const malformed = await handleBackupImportPreviewRequest(request("{"), { DB: {} }, auditContext, dependencies);
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).code, "backup_request_invalid");

  const oversized = await handleBackupImportPreviewRequest(
    request(await backupDocument(), { headers: { "content-length": String(10 * 1024 * 1024 + 1) } }),
    { DB: {} },
    auditContext,
    dependencies,
  );
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).code, "backup_request_too_large");

  const unavailable = await handleBackupImportPreviewRequest(request(await backupDocument()), {}, auditContext, dependencies);
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.json()).code, "backup_database_unavailable");

  const incompatible = await handleBackupImportPreviewRequest(request(await backupDocument()), { DB: {} }, auditContext, {
    ...dependencies,
    inspectSchema: async () => ({ state: "incompatible", currentVersion: 7 }),
  });
  assert.equal(incompatible.status, 409);
  assert.equal((await incompatible.json()).code, "backup_schema_incompatible");
});

test("returns safe failure and audits only normalized metadata", async () => {
  const events = [];
  const response = await handleBackupImportPreviewRequest(request(await backupDocument()), { DB: {} }, auditContext, {
    registry: new Map([["settings", {
      domain: "settings",
      path: "domains/settings.json",
      async export() { throw new Error("raw D1 secret detail"); },
    }]]),
    inspectSchema: readySchema,
    appendAudit: async (_env, _context, event) => { events.push(event); },
  });
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.code, "backup_preview_failed");
  assert.doesNotMatch(JSON.stringify(body), /raw D1 secret detail/);
  assert.equal(events[0].action, "backup.import.preview.failed");
  assert.equal(events[0].errorCode, "backup_preview_failed");
  assert.equal("payload" in events[0].metadata, false);
});

test("rejects methods other than POST", async () => {
  const response = await handleBackupImportPreviewRequest(
    new Request("https://dashboard.test/api/admin/backups/import/preview", { method: "GET" }),
    { DB: {} },
    auditContext,
  );
  assert.equal(response.status, 405);
  assert.equal((await response.json()).code, "backup_method_not_allowed");
});
