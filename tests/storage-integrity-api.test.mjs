import assert from "node:assert/strict";
import test from "node:test";

import { handleStorageIntegrityRequest } from "../worker/storage-integrity-entry.ts";

function access(role = "admin") {
  return {
    role,
    identity: `${role}@local.portal`,
    groups: role === "admin" ? ["portal-admins"] : [],
    permissions: [],
  };
}

function report(state = "healthy") {
  const unavailable = state === "unavailable";
  const degraded = state === "degraded";
  return {
    contractVersion: "1",
    generatedAt: 1_754_400_000_000,
    durationMs: 12,
    state,
    quickCheck: unavailable
      ? { state: "unavailable", code: "storage_quick_check_unavailable" }
      : degraded
        ? { state: "failed", code: "storage_quick_check_failed" }
        : { state: "healthy", code: "storage_quick_check_ok" },
    indexes: unavailable
      ? {
        expected: 19,
        present: 0,
        missing: 0,
        mismatched: 0,
        unexpected: 0,
        code: "storage_indexes_unavailable",
      }
      : degraded
        ? {
          expected: 19,
          present: 18,
          missing: 1,
          mismatched: 1,
          unexpected: 1,
          code: "storage_indexes_degraded",
        }
        : {
          expected: 19,
          present: 19,
          missing: 0,
          mismatched: 0,
          unexpected: 0,
          code: "storage_indexes_ready",
        },
  };
}

const context = {
  correlationId: "cor_abcdef0123456789abcdef0123456789",
  actor: { identity: "admin@local.portal", role: "admin", groups: ["portal-admins"] },
};

test("storage integrity handler ignores unrelated routes and accepts only POST", async () => {
  let inspected = 0;
  const dependencies = {
    access: () => access("admin"),
    inspect: async () => { inspected += 1; return report(); },
  };

  assert.equal(
    await handleStorageIntegrityRequest(
      new Request("https://portal.test/health/live", { method: "POST" }),
      {},
      dependencies,
    ),
    null,
  );

  for (const method of ["GET", "PUT", "DELETE"]) {
    const response = await handleStorageIntegrityRequest(
      new Request("https://portal.test/api/admin/storage/integrity/check", { method }),
      {},
      dependencies,
    );
    assert.ok(response);
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "POST");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), {
      ok: false,
      code: "storage_integrity_method_not_allowed",
    });
  }
  assert.equal(inspected, 0);
});

test("viewer and operator are denied before integrity inspection or audit context", async () => {
  for (const role of ["viewer", "operator"]) {
    let inspected = 0;
    let contexts = 0;
    const response = await handleStorageIntegrityRequest(
      new Request("https://portal.test/api/admin/storage/integrity/check", { method: "POST" }),
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
      code: "storage_integrity_forbidden",
      requiredRole: "admin",
      role,
    });
    assert.equal(inspected, 0);
    assert.equal(contexts, 0);
  }
});

test("admin receives healthy integrity report and bounded success audit", async () => {
  const audits = [];
  let current = 1_754_400_000_100;
  const response = await handleStorageIntegrityRequest(
    new Request("https://portal.test/api/admin/storage/integrity/check", { method: "POST" }),
    { DB: {} },
    {
      access: () => access("admin"),
      createContext: () => context,
      inspect: async () => report("healthy"),
      appendAudit: async (_env, auditContext, event) => {
        audits.push({ auditContext, event });
        return null;
      },
      now: () => {
        const value = current;
        current += 999_999;
        return value;
      },
    },
  );

  assert.ok(response);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-correlation-id"), context.correlationId);
  const payload = await response.json();
  assert.equal(payload.contractVersion, "1");
  assert.equal(payload.state, "healthy");
  assert.equal(payload.correlationId, context.correlationId);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].auditContext, context);
  assert.deepEqual(audits[0].event, {
    action: "storage.integrity.check",
    resourceType: "portal-storage",
    outcome: "success",
    metadata: {
      state: "healthy",
      durationMs: 60_000,
      quickCheckCode: "storage_quick_check_ok",
      indexCode: "storage_indexes_ready",
      expected: 19,
      present: 19,
      missing: 0,
      mismatched: 0,
      unexpected: 0,
    },
  });

  const serialized = JSON.stringify({ payload, audits });
  for (const forbidden of [
    "sqlite_schema",
    "CREATE INDEX",
    "portal_users",
    "/var/lib",
    "password",
    "bearer-secret",
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("degraded integrity remains HTTP 200 and unavailable integrity is HTTP 503", async () => {
  for (const [state, expectedStatus] of [["degraded", 200], ["unavailable", 503]]) {
    const audits = [];
    const response = await handleStorageIntegrityRequest(
      new Request("https://portal.test/api/admin/storage/integrity/check", { method: "POST" }),
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
    assert.equal(
      audits[0].errorCode,
      state === "unavailable" ? "storage_integrity_unavailable" : undefined,
    );
  }
});

test("unexpected evaluator failure returns fixed unavailable payload without raw details", async () => {
  const secret = "file:///var/lib/private.sqlite CREATE INDEX private_secret bearer-token-sentinel";
  const audits = [];
  const response = await handleStorageIntegrityRequest(
    new Request("https://portal.test/api/admin/storage/integrity/check", { method: "POST" }),
    {},
    {
      access: () => access("admin"),
      createContext: () => context,
      inspect: async () => { throw new Error(secret); },
      appendAudit: async (_env, _context, event) => { audits.push(event); return null; },
      now: () => 1_754_400_000_500,
    },
  );

  assert.ok(response);
  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.deepEqual(payload, {
    contractVersion: "1",
    generatedAt: 1_754_400_000_500,
    state: "unavailable",
    code: "storage_integrity_unavailable",
    correlationId: context.correlationId,
  });
  assert.equal(audits.length, 1);
  assert.equal(audits[0].outcome, "failure");
  assert.equal(audits[0].errorCode, "storage_integrity_unavailable");
  const serialized = JSON.stringify({ payload, audits });
  for (const forbidden of ["private.sqlite", "CREATE INDEX", "private_secret", "bearer-token-sentinel"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("audit failure never replaces the integrity response", async () => {
  const response = await handleStorageIntegrityRequest(
    new Request("https://portal.test/api/admin/storage/integrity/check", { method: "POST" }),
    {},
    {
      access: () => access("admin"),
      createContext: () => context,
      inspect: async () => report("healthy"),
      appendAudit: async () => { throw new Error("audit-secret-sentinel"); },
    },
  );
  assert.ok(response);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).state, "healthy");
});
