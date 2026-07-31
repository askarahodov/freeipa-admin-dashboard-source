import assert from "node:assert/strict";
import test from "node:test";

import { BackupExportError } from "../backup-export.ts";
import { handleBackupExportRequest } from "../worker/backup-export-entry.ts";

const auditContext = {
  correlationId: "cor_12345678901234567890",
  actor: { identity: "admin@example.test", role: "admin", groups: [] },
};

const db = {};

function request(body, init = {}) {
  return new Request("https://dashboard.test/api/admin/backups/export", {
    method: "POST",
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...init,
  });
}

function registry(exporter) {
  return new Map([[exporter.domain, exporter]]);
}

test("returns selected domain document with attachment and no-store headers", async () => {
  const events = [];
  const response = await handleBackupExportRequest(
    request({ domains: ["settings"] }),
    { DB: db },
    auditContext,
    {
      registry: registry({
        domain: "settings",
        path: "domains/settings.json",
        async export() { return { payload: { records: [{ updatedAt: 1 }] }, records: 1 }; },
      }),
      appendAudit: async (_env, _context, event) => { events.push(event); },
      now: () => 100,
    },
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("content-disposition"), /^attachment; filename="portal-backup-/);
  const body = await response.json();
  assert.deepEqual(body.manifest.domains, ["settings"]);
  assert.deepEqual(Object.keys(body.payloads), ["domains/settings.json"]);
  assert.equal(events[0].action, "backup.export.completed");
  assert.deepEqual(events[0].metadata.domains, ["settings"]);
  assert.equal("payloads" in events[0].metadata, false);
});

test("normalizes malformed, oversized and unavailable database errors", async () => {
  const malformed = await handleBackupExportRequest(request("{"), { DB: db }, auditContext, { registry: new Map(), appendAudit: async () => {} });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).code, "backup_request_invalid");

  const oversized = await handleBackupExportRequest(request({ domains: ["settings"] }, { headers: { "content-length": "5000" } }), { DB: db }, auditContext);
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).code, "backup_request_too_large");

  const unavailable = await handleBackupExportRequest(request({ domains: ["settings"] }), {}, auditContext, {
    registry: new Map(),
    appendAudit: async () => {},
  });
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.json()).code, "backup_database_unavailable");
});

test("returns no partial backup and hides unexpected exporter failures", async () => {
  const events = [];
  const schemaFailure = await handleBackupExportRequest(request({ domains: ["settings"] }), { DB: db }, auditContext, {
    registry: registry({
      domain: "settings",
      path: "domains/settings.json",
      async export() { throw new BackupExportError("backup_schema_incompatible", 409, "Backup schema is incompatible"); },
    }),
    appendAudit: async (_env, _context, event) => { events.push(event); },
  });
  assert.equal(schemaFailure.status, 409);
  assert.equal((await schemaFailure.json()).code, "backup_schema_incompatible");

  const unexpected = await handleBackupExportRequest(request({ domains: ["settings"] }), { DB: db }, auditContext, {
    registry: registry({
      domain: "settings",
      path: "domains/settings.json",
      async export() { throw new Error("SQL secret detail"); },
    }),
    appendAudit: async (_env, _context, event) => { events.push(event); },
  });
  assert.equal(unexpected.status, 500);
  const body = await unexpected.json();
  assert.equal(body.code, "backup_export_failed");
  assert.doesNotMatch(JSON.stringify(body), /SQL secret detail/);
  assert.equal(events.at(-1).errorCode, "backup_export_failed");
  assert.equal("payload" in events.at(-1).metadata, false);
});
