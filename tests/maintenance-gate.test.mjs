import assert from "node:assert/strict";
import test from "node:test";

import {
  handleMaintenanceGate,
  handleMaintenanceScheduledGate,
  PUBLIC_MAINTENANCE_STATUS_PATH,
} from "../worker/maintenance-mode-root-entry.ts";

const operationId = "maintenance_11111111-1111-4111-8111-111111111111";

function row(state, overrides = {}) {
  return {
    id: "main",
    state,
    operationId: state === "inactive" ? null : operationId,
    actorIdentity: state === "inactive" ? null : "admin@example.test",
    actorGroups: state === "inactive" ? [] : ["portal-admins"],
    controllerSecretHash: state === "inactive" ? null : "1".repeat(64),
    createdAt: state === "inactive" ? null : 1_000,
    updatedAt: 2_000,
    expiresAt: state === "entering" ? 901_000 : null,
    completedAt: null,
    failureCode: state === "failed" ? "maintenance_recovery_failed" : null,
    verification: state === "exiting" ? {
      integrity: "ok",
      schema: "ok",
      administratorAccess: "ok",
      settingsDecryption: "ok",
      auditWrite: "ok",
    } : {},
    ...overrides,
  };
}

function request(path, headers = {}) {
  return new Request(`https://portal.example${path}`, { headers });
}

function fixture(state = "inactive", overrides = {}) {
  const calls = [];
  const dependencies = {
    async loadState() {
      calls.push("load");
      if (overrides.loadError) throw new Error("raw maintenance D1 detail");
      return state === "absent" ? null : row(state);
    },
    async nextFetch(req) {
      calls.push(`fetch:${new URL(req.url).pathname}`);
      return new Response("inner", {
        status: overrides.innerStatus ?? 200,
        headers: { "x-inner": "1", "cache-control": "public, max-age=60" },
      });
    },
    async nextScheduled() {
      calls.push("scheduled");
    },
  };
  return { calls, dependencies };
}

test("inactive or absent maintenance state delegates ordinary API traffic", async () => {
  for (const state of ["inactive", "absent"]) {
    const f = fixture(state);
    const response = await handleMaintenanceGate(request("/api/integrations/users"), { DB: {} }, {}, f.dependencies);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "inner");
    assert.deepEqual(f.calls, ["load", "fetch:/api/integrations/users"]);
  }
});

test("non-API assets remain available while maintenance is active", async () => {
  const f = fixture("active");
  const response = await handleMaintenanceGate(request("/settings"), { DB: {} }, {}, f.dependencies);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "inner");
  assert.deepEqual(f.calls, ["fetch:/settings"]);
});

test("blocks every ordinary API before service-admin or inner runtime can run", async () => {
  for (const state of ["entering", "active", "verifying", "exiting", "failed"]) {
    const f = fixture(state);
    const response = await handleMaintenanceGate(
      request("/api/integrations/settings", { "x-admin-token": "valid-service-token" }),
      { DB: {}, ADMIN_TOKEN: "valid-service-token" },
      {},
      f.dependencies,
    );
    assert.equal(response.status, 503, state);
    assert.equal(response.headers.get("retry-after"), "60");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), {
      error: "portal_maintenance_active",
      maintenance: { state, recoveryRequired: true },
    });
    assert.deepEqual(f.calls, ["load"], state);
  }
});

test("public status is safe and does not delegate", async () => {
  const f = fixture("active");
  const response = await handleMaintenanceGate(request(PUBLIC_MAINTENANCE_STATUS_PATH), { DB: {} }, {}, f.dependencies);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    maintenance: true,
    state: "active",
    updatedAt: 2_000,
    recoveryRequired: true,
  });
  assert.deepEqual(f.calls, ["load"]);
  const serialized = JSON.stringify(await (async () => {
    const second = await handleMaintenanceGate(request(PUBLIC_MAINTENANCE_STATUS_PATH), { DB: {} }, {}, fixture("active").dependencies);
    return second.json();
  })());
  for (const forbidden of [operationId, "admin@example.test", "portal-admins", "1".repeat(64)]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("maintenance controls schema status and integration health remain allowlisted", async () => {
  const paths = [
    "/api/admin/maintenance/status",
    "/api/admin/maintenance/prepare",
    "/api/admin/maintenance/enter",
    "/api/admin/maintenance/verification/start",
    "/api/admin/maintenance/exit",
    "/api/admin/maintenance/complete",
    "/api/admin/maintenance/cancel",
    "/api/schema/status",
  ];
  for (const path of paths) {
    const f = fixture("active");
    const response = await handleMaintenanceGate(request(path), { DB: {} }, {}, f.dependencies);
    assert.equal(response.status, 200, path);
    assert.deepEqual(f.calls, [`fetch:${path}`], path);
  }

  const health = fixture("verifying", { innerStatus: 204 });
  const healthResponse = await handleMaintenanceGate(
    request("/api/integrations/health"), { DB: {} }, {}, health.dependencies,
  );
  assert.equal(healthResponse.status, 204);
  assert.equal(healthResponse.headers.get("x-inner"), "1");
  assert.equal(healthResponse.headers.get("x-portal-maintenance-state"), "verifying");
  assert.equal(healthResponse.headers.get("cache-control"), "no-store");
  assert.deepEqual(health.calls, ["load", "fetch:/api/integrations/health"]);
});

test("state read failure fails closed without exposing raw errors", async () => {
  const blocked = fixture("active", { loadError: true });
  const response = await handleMaintenanceGate(request("/api/integrations/users"), { DB: {} }, {}, blocked.dependencies);
  assert.equal(response.status, 503);
  const raw = await response.text();
  assert.deepEqual(JSON.parse(raw), {
    error: "maintenance_state_unavailable",
    maintenance: { state: "failed", recoveryRequired: true },
  });
  assert.equal(raw.includes("raw maintenance"), false);
  assert.deepEqual(blocked.calls, ["load"]);

  const status = fixture("active", { loadError: true });
  const statusResponse = await handleMaintenanceGate(request(PUBLIC_MAINTENANCE_STATUS_PATH), { DB: {} }, {}, status.dependencies);
  assert.equal(statusResponse.status, 200);
  assert.deepEqual(await statusResponse.json(), {
    maintenance: true,
    state: "failed",
    updatedAt: null,
    recoveryRequired: true,
  });

  const health = fixture("active", { loadError: true, innerStatus: 503 });
  const healthResponse = await handleMaintenanceGate(request("/api/integrations/health"), { DB: {} }, {}, health.dependencies);
  assert.equal(healthResponse.status, 503);
  assert.equal(healthResponse.headers.get("x-portal-maintenance-state"), "failed");
  assert.equal(healthResponse.headers.get("cache-control"), "no-store");
});

test("scheduled work runs only while maintenance is inactive", async () => {
  for (const state of ["inactive", "absent"]) {
    const f = fixture(state);
    await handleMaintenanceScheduledGate({}, { DB: {} }, {}, f.dependencies);
    assert.deepEqual(f.calls, ["load", "scheduled"], state);
  }
  for (const state of ["entering", "active", "verifying", "exiting", "failed"]) {
    const f = fixture(state);
    await handleMaintenanceScheduledGate({}, { DB: {} }, {}, f.dependencies);
    assert.deepEqual(f.calls, ["load"], state);
  }
  const failed = fixture("active", { loadError: true });
  await handleMaintenanceScheduledGate({}, { DB: {} }, {}, failed.dependencies);
  assert.deepEqual(failed.calls, ["load"]);
});
