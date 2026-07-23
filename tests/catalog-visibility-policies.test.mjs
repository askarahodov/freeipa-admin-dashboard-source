import assert from "node:assert/strict";
import test from "node:test";

import worker from "../dist/server/index.js";

class PolicyD1 {
  policy = null;

  prepare(sql) {
    let values = [];
    const statement = {
      bind: (...args) => { values = args; return statement; },
      run: async () => {
        if (sql.startsWith("INSERT INTO catalog_visibility_policies")) {
          this.policy = { policy_json: values[1], updated_at: values[2] };
        }
        return { success: true, meta: { changes: 1 } };
      },
      first: async () => {
        if (sql.includes("FROM catalog_visibility_policies")) return this.policy;
        return null;
      },
      all: async () => ({ results: [] }),
    };
    return statement;
  }
}

const policy = {
  version: 1,
  defaultEffect: "deny",
  adminBypass: true,
  rules: [
    { id: "ops-databases", effect: "allow", groups: ["ops"], categories: ["Databases"] },
    { id: "hide-secret", effect: "deny", groups: ["ops"], processes: ["secret-job"] },
    { id: "bob-secret", effect: "allow", users: ["bob@example.test"], processes: ["secret-job"] },
  ],
};

function envFor(identity, groups = "", role = "operator", db) {
  return {
    DB: db,
    XYOPS_URL: "https://xyops.example.test",
    XYOPS_API_KEY: "xyops-secret",
    ADMIN_TOKEN: "admin-secret",
    PORTAL_IDENTITY_MODE: "static",
    PORTAL_STATIC_IDENTITY: identity,
    PORTAL_STATIC_GROUPS: groups,
    PORTAL_DEFAULT_ROLE: "viewer",
    PORTAL_RBAC_JSON: JSON.stringify({ [identity]: role }),
    PORTAL_CATALOG_POLICIES_JSON: JSON.stringify(policy),
  };
}

async function getCatalog(env, headers = {}) {
  const response = await worker.fetch(new Request("https://portal.test/api/integrations/catalog", { headers }), env, {});
  return { response, payload: await response.json() };
}

test("filters catalog and blocks direct launch/options/rerun bypasses", async () => {
  const originalFetch = globalThis.fetch;
  let runCalls = 0;
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.pathname.endsWith("/get_events/v1")) return Response.json({ events: [
      { id: "db-backup", title: "Database backup", category: "Databases", user_fields: [{ id: "database", title: "Database", required: true, options_source: { endpoint: "/api/app/options/v1" } }] },
      { id: "secret-job", title: "Secret process", category: "Databases", user_fields: [] },
      { id: "network-job", title: "Network process", category: "Networks", user_fields: [] },
    ] });
    if (url.pathname.endsWith("/run_event/v1")) { runCalls += 1; return Response.json({ id: `job_${runCalls}`, status: "queued" }); }
    if (url.pathname.endsWith("/options/v1")) return Response.json({ options: ["one"] });
    return new Response("not found", { status: 404 });
  };

  try {
    const alice = envFor("alice@example.test", "ops");
    let result = await getCatalog(alice);
    assert.equal(result.response.status, 200);
    assert.deepEqual(result.payload.events.map((item) => item.id), ["db-backup"]);

    let response = await worker.fetch(new Request("https://portal.test/api/integrations/catalog/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventId: "secret-job", values: {} }),
    }), alice, {});
    assert.equal(response.status, 404);
    assert.equal(runCalls, 0);

    response = await worker.fetch(new Request("https://portal.test/api/integrations/catalog/options?eventId=secret-job&fieldKey=database"), alice, {});
    assert.equal(response.status, 404);

    response = await worker.fetch(new Request("https://portal.test/api/integrations/catalog/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventId: "db-backup", values: { database: "billing" } }),
    }), alice, {});
    assert.equal(response.status, 202);
    assert.equal(runCalls, 1);

    const bob = envFor("bob@example.test", "");
    result = await getCatalog(bob);
    assert.deepEqual(result.payload.events.map((item) => item.id), ["secret-job"]);

    const noGroups = envFor("mallory@example.test", "");
    result = await getCatalog(noGroups, { "oai-authenticated-user-groups": "ops" });
    assert.deepEqual(result.payload.events, [], "untrusted incoming groups header must be removed");

    const admin = envFor("admin@example.test", "", "admin");
    result = await getCatalog(admin);
    assert.deepEqual(result.payload.events.map((item) => item.id).sort(), ["db-backup", "network-job", "secret-job"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("admin API validates and persists policy JSON", async () => {
  const db = new PolicyD1();
  const env = envFor("admin@example.test", "", "admin", db);
  delete env.PORTAL_CATALOG_POLICIES_JSON;

  let response = await worker.fetch(new Request("https://portal.test/api/integrations/catalog/policies", {
    method: "PUT",
    headers: { "content-type": "application/json", "x-admin-token": "admin-secret" },
    body: JSON.stringify({ policy }),
  }), env, {});
  assert.equal(response.status, 200);
  let payload = await response.json();
  assert.equal(payload.policy.defaultEffect, "deny");
  assert.equal(payload.policy.rules.length, 3);

  response = await worker.fetch(new Request("https://portal.test/api/integrations/catalog/policies", {
    headers: { "x-admin-token": "admin-secret" },
  }), env, {});
  assert.equal(response.status, 200);
  payload = await response.json();
  assert.equal(payload.source, "database");
  assert.equal(payload.policy.rules[0].id, "ops-databases");

  response = await worker.fetch(new Request("https://portal.test/api/integrations/catalog/policies", {
    method: "PUT",
    headers: { "content-type": "application/json", "x-admin-token": "admin-secret" },
    body: JSON.stringify({ policy: { defaultEffect: "invalid", rules: [] } }),
  }), env, {});
  assert.equal(response.status, 400);
});
