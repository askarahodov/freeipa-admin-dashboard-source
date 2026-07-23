import assert from "node:assert/strict";
import test from "node:test";

import worker from "../dist/server/index.js";

const assignments = JSON.stringify({
  "viewer@example.test": "viewer",
  "operator@example.test": "operator",
  "admin@example.test": "admin",
});

const workspaceEnv = {
  DEMO_MODE: "true",
  PORTAL_IDENTITY_MODE: "workspace",
  PORTAL_DEFAULT_ROLE: "viewer",
  PORTAL_RBAC_JSON: assignments,
};

function request(path, email, init = {}) {
  const headers = new Headers(init.headers);
  if (email) headers.set("oai-authenticated-user-email", email);
  return new Request(`https://dashboard.test${path}`, { ...init, headers });
}

test("status exposes the effective portal role and permissions", async () => {
  const response = await worker.fetch(request("/api/integrations/status", "operator@example.test"), workspaceEnv, {});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.access, {
    identity: "operator@example.test",
    role: "operator",
    permissions: ["directory.read", "freeipa.write", "xyops.run"],
  });
});

test("viewer cannot mutate FreeIPA or launch XYOps through direct API calls", async () => {
  const freeipa = await worker.fetch(request("/api/integrations/freeipa/actions", "viewer@example.test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operation: "user_disable", username: "alice" }),
  }), workspaceEnv, {});
  assert.equal(freeipa.status, 403);
  assert.equal((await freeipa.json()).requiredPermission, "freeipa.write");

  const xyops = await worker.fetch(request("/api/integrations/catalog/run", "viewer@example.test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ eventId: "backup-postgres", values: {} }),
  }), workspaceEnv, {});
  assert.equal(xyops.status, 403);
  assert.equal((await xyops.json()).requiredPermission, "xyops.run");
});

test("operator can manage FreeIPA but destructive deletes require admin", async () => {
  const update = await worker.fetch(request("/api/integrations/freeipa/actions", "operator@example.test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operation: "user_disable", username: "alice" }),
  }), workspaceEnv, {});
  assert.equal(update.status, 200);

  const remove = await worker.fetch(request("/api/integrations/freeipa/actions", "operator@example.test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operation: "user_del", username: "alice" }),
  }), workspaceEnv, {});
  assert.equal(remove.status, 403);
  assert.equal((await remove.json()).requiredPermission, "freeipa.delete");
});

test("anonymous requests are viewer even when legacy defaults grant admin", async () => {
  const response = await worker.fetch(new Request("https://dashboard.test/api/integrations/status"), {
    DEMO_MODE: "true",
    PORTAL_DEFAULT_ROLE: "admin",
    PORTAL_RBAC_JSON: JSON.stringify({ "*": "admin", "portal-user": "admin" }),
  }, {});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.access.identity, "portal-user");
  assert.equal(body.access.role, "viewer");
  assert.deepEqual(body.access.permissions, ["directory.read"]);
});

test("proxy mode ignores forged workspace identity and requires its shared secret", async () => {
  const env = {
    DEMO_MODE: "true",
    PORTAL_IDENTITY_MODE: "proxy",
    PORTAL_DEFAULT_ROLE: "viewer",
    PORTAL_RBAC_JSON: assignments,
    PORTAL_PROXY_SHARED_SECRET: "proxy-secret",
  };
  const trusted = await worker.fetch(request("/api/integrations/status", "admin@example.test", {
    headers: {
      "x-auth-request-email": "operator@example.test",
      "x-auth-request-user": "Portal Operator",
      "x-portal-proxy-secret": "proxy-secret",
    },
  }), env, {});
  assert.equal(trusted.status, 200);
  const trustedBody = await trusted.json();
  assert.equal(trustedBody.access.identity, "operator@example.test");
  assert.equal(trustedBody.access.role, "operator");

  const untrusted = await worker.fetch(request("/api/integrations/status", "admin@example.test", {
    headers: { "x-auth-request-email": "admin@example.test" },
  }), env, {});
  assert.equal(untrusted.status, 200);
  const untrustedBody = await untrusted.json();
  assert.equal(untrustedBody.access.identity, "portal-user");
  assert.equal(untrustedBody.access.role, "viewer");
});

test("static mode supports an explicit identity for isolated local development", async () => {
  const response = await worker.fetch(new Request("https://dashboard.test/api/integrations/status"), {
    DEMO_MODE: "true",
    PORTAL_IDENTITY_MODE: "static",
    PORTAL_STATIC_IDENTITY: "admin@example.test",
    PORTAL_DEFAULT_ROLE: "viewer",
    PORTAL_RBAC_JSON: assignments,
  }, {});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.access.identity, "admin@example.test");
  assert.equal(body.access.role, "admin");
});
