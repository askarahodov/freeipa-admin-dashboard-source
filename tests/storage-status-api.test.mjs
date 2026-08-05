import assert from "node:assert/strict";
import test from "node:test";

import { handleStorageStatusRequest } from "../worker/storage-status-entry.ts";

function access(role = "admin") {
  return {
    role,
    identity: `${role}@local.portal`,
    groups: role === "admin" ? ["portal-admins"] : [],
    permissions: [],
  };
}

function report(state = "healthy") {
  return {
    contractVersion: "1",
    generatedAt: 1_754_300_000_000,
    state,
    database: {
      available: state !== "unavailable",
      pageCount: state === "unavailable" ? null : 12,
      pageSize: state === "unavailable" ? null : 4096,
      logicalBytes: state === "unavailable" ? null : 49_152,
      code: state === "unavailable" ? "storage_database_unavailable" : "storage_size_available",
    },
    schema: {
      state: state === "unavailable" ? "unknown" : "ready",
      currentVersion: state === "unavailable" ? null : 3,
      latestVersion: state === "unavailable" ? null : 3,
      appliedVersions: state === "unavailable" ? [] : [1, 2, 3],
      pendingVersions: [],
      compatibleDriftCount: 0,
      incompatibleDriftCount: 0,
      errorCode: state === "unavailable" ? "schema_database_unavailable" : null,
    },
    domains: [
      { name: "settings", expectedTables: 4, presentTables: 4, records: 8, code: "storage_domain_counted" },
      { name: "identity", expectedTables: 2, presentTables: 2, records: 5, code: "storage_domain_counted" },
    ],
    encryption: { state: "ready", code: "storage_encryption_ready" },
    lifecycle: { lastBackupAt: null, lastRestoreAt: null, lastCleanupAt: null, code: "storage_lifecycle_available" },
  };
}

const context = {
  correlationId: "cor_0123456789abcdef0123456789abcdef",
  actor: { identity: "admin@local.portal", role: "admin", groups: ["portal-admins"] },
};

test("storage status handler ignores unrelated routes and rejects mutations", async () => {
  let inspected = 0;
  const dependencies = {
    access: () => access("admin"),
    inspect: async () => { inspected += 1; return report(); },
  };
  assert.equal(
    await handleStorageStatusRequest(new Request("https://portal.test/health/live"), {}, dependencies),
    null,
  );
  const response = await handleStorageStatusRequest(
    new Request("https://portal.test/api/admin/storage/status", { method: "POST" }),
    {},
    dependencies,
  );
  assert.ok(response);
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { ok: false, code: "storage_status_method_not_allowed" });
  assert.equal(inspected, 0);
});

test("viewer and operator are denied before storage inspection or audit context", async () => {
  for (const role of ["viewer", "operator"]) {
    let inspected = 0;
    let contexts = 0;
    const response = await handleStorageStatusRequest(
      new Request("https://portal.test/api/admin/storage/status"),
      {},
      {
        access: () => access(role),
        createContext: () => { contexts += 1; return context; },
        inspect: async () => { inspected += 1; return report(); },
      },
    );
    assert.ok(response);
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      ok: false,
      code: "storage_status_forbidden",
      requiredRole: "admin",
      role,
    });
    assert.equal(inspected, 0);
    assert.equal(contexts, 0);
  }
});

test("admin receives versioned healthy status and a bounded success audit event", async () => {
  const audits = [];
  const response = await handleStorageStatusRequest(
    new Request("https://portal.test/api/admin/storage/status"),
    { DB: {} },
    {
      access: () => access("admin"),
      createContext: () => context,
      inspect: async () => report("healthy"),
      appendAudit: async (_env, auditContext, event) => { audits.push({ auditContext, event }); return null; },
      now: () => 1_754_300_000_250,
    },
  );

  assert.ok(response);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-correlation-id"), context.correlationId);
  const payload = await response.json();
  assert.equal(payload.contractVersion, "1");
  assert.equal(payload.correlationId, context.correlationId);
  assert.equal(payload.state, "healthy");
  assert.equal(audits.length, 1);
  assert.equal(audits[0].auditContext, context);
  assert.deepEqual(audits[0].event, {
    action: "storage.inspect",
    resourceType: "portal-storage",
    outcome: "success",
    metadata: {
      state: "healthy",
      schemaVersion: 3,
      domainCount: 2,
      durationMs: 0,
      codes: ["storage_size_available", "storage_encryption_ready", "storage_lifecycle_available"],
    },
  });
  const serialized = JSON.stringify({ payload, audits });
  for (const forbidden of ["portal_users", "sqlite_master", "CONFIG_ENCRYPTION_KEY", "password", "token"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("degraded status remains HTTP 200 while unavailable status is HTTP 503", async () => {
  for (const [state, expectedStatus] of [["degraded", 200], ["unavailable", 503]]) {
    const audits = [];
    const response = await handleStorageStatusRequest(
      new Request("https://portal.test/api/admin/storage/status"),
      {},
      {
        access: () => access("admin"),
        createContext: () => context,
        inspect: async () => report(state),
        appendAudit: async (_env, _context, event) => { audits.push(event); return null; },
      },
    );
    assert.ok(response);
    assert.equal(response.status, expectedStatus);
    assert.equal((await response.json()).state, state);
    assert.equal(audits[0].outcome, state === "unavailable" ? "failure" : "success");
  }
});

test("unexpected inspector failure returns a fixed unavailable response without raw details", async () => {
  const secret = "file:///var/lib/private.sqlite bearer-secret-sentinel";
  const audits = [];
  const response = await handleStorageStatusRequest(
    new Request("https://portal.test/api/admin/storage/status"),
    {},
    {
      access: () => access("admin"),
      createContext: () => context,
      inspect: async () => { throw new Error(secret); },
      appendAudit: async (_env, _context, event) => { audits.push(event); return null; },
      now: () => 1_754_300_000_500,
    },
  );
  assert.ok(response);
  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.equal(payload.state, "unavailable");
  assert.equal(payload.code, "storage_status_unavailable");
  assert.equal(payload.correlationId, context.correlationId);
  assert.equal(audits[0].outcome, "failure");
  assert.equal(audits[0].errorCode, "storage_status_unavailable");
  const serialized = JSON.stringify({ payload, audits });
  assert.equal(serialized.includes("private.sqlite"), false);
  assert.equal(serialized.includes("bearer-secret-sentinel"), false);
});

test("audit failure never replaces the storage response", async () => {
  const response = await handleStorageStatusRequest(
    new Request("https://portal.test/api/admin/storage/status"),
    {},
    {
      access: () => access("admin"),
      createContext: () => context,
      inspect: async () => report("healthy"),
      appendAudit: async () => { throw new Error("audit-database-secret"); },
    },
  );
  assert.ok(response);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).state, "healthy");
});
