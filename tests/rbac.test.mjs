import assert from "node:assert/strict";
import test from "node:test";

import worker from "../dist/server/index.js";

const assignments = JSON.stringify({
  "viewer@example.test": "viewer",
  "operator@example.test": "operator",
  "admin@example.test": "admin",
});

function request(path, email, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("oai-authenticated-user-email", email);
  return new Request(`https://dashboard.test${path}`, { ...init, headers });
}

test("status exposes the effective portal role and permissions", async () => {
  const response = await worker.fetch(request("/api/integrations/status", "operator@example.test"), {
    DEMO_MODE: "true",
    PORTAL_DEFAULT_ROLE: "viewer",
    PORTAL_RBAC_JSON: assignments,
  }, {});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.access, {
    identity: "operator@example.test",
    role: "operator",
    permissions: ["directory.read", "freeipa.write", "xyops.run"],
  });
});

test("viewer cannot mutate FreeIPA or launch XYOps through direct API calls", async () => {
  const env = { DEMO_MODE: "true", PORTAL_DEFAULT_ROLE: "viewer", PORTAL_RBAC_JSON: assignments };
  const freeipa = await worker.fetch(request("/api/integrations/freeipa/actions", "viewer@example.test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operation: "user_disable", username: "alice" }),
  }), env, {});
  assert.equal(freeipa.status, 403);
  assert.equal((await freeipa.json()).requiredPermission, "freeipa.write");

  const xyops = await worker.fetch(request("/api/integrations/catalog/run", "viewer@example.test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ eventId: "backup-postgres", values: {} }),
  }), env, {});
  assert.equal(xyops.status, 403);
  assert.equal((await xyops.json()).requiredPermission, "xyops.run");
});

test("operator can manage FreeIPA but destructive deletes require admin", async () => {
  const env = { DEMO_MODE: "true", PORTAL_DEFAULT_ROLE: "viewer", PORTAL_RBAC_JSON: assignments };
  const update = await worker.fetch(request("/api/integrations/freeipa/actions", "operator@example.test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operation: "user_disable", username: "alice" }),
  }), env, {});
  assert.equal(update.status, 200);

  const remove = await worker.fetch(request("/api/integrations/freeipa/actions", "operator@example.test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operation: "user_del", username: "alice" }),
  }), env, {});
  assert.equal(remove.status, 403);
  assert.equal((await remove.json()).requiredPermission, "freeipa.delete");
});

test("default role remains admin for backward compatibility", async () => {
  const response = await worker.fetch(new Request("https://dashboard.test/api/integrations/status"), { DEMO_MODE: "true" }, {});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.access.role, "admin");
  assert.ok(body.access.permissions.includes("settings.manage"));
});
