import assert from "node:assert/strict";
import test from "node:test";

import worker from "../dist/server/index.js";

class PresentationD1 {
  presentation = null;
  audits = [];

  prepare(sql) {
    let values = [];
    const statement = {
      bind: (...args) => { values = args; return statement; },
      run: async () => {
        if (sql.startsWith("INSERT INTO process_presentation_sets")) {
          this.presentation = { metadata_json: values[1], updated_at: values[2] };
          return { success: true, meta: { changes: 1 } };
        }
        if (sql.startsWith("INSERT INTO portal_audit_events")) {
          this.audits.push({ action: values[6], resource_type: values[7], resource_id: values[8], metadata_json: values[16] });
          return { success: true, meta: { changes: 1 } };
        }
        return { success: true, meta: { changes: 0 } };
      },
      first: async () => {
        if (sql.includes("FROM process_presentation_sets")) return this.presentation;
        if (sql.includes("FROM app_settings")) return null;
        return null;
      },
      all: async () => ({ results: [] }),
    };
    return statement;
  }
}

const metadata = {
  version: 1,
  processes: {
    alpha: { title: "Понятный Alpha", description: "Пользовательское описание", category: "Самообслуживание", icon: "backup", order: 20, help: "Подробная инструкция" },
    beta: { order: -10, icon: "database" },
    production: { category: "Безопасный раздел", title: "Переименованный production" },
  },
};

function env(identity = "admin@example.test", extra = {}) {
  return {
    PORTAL_IDENTITY_MODE: "static",
    PORTAL_STATIC_IDENTITY: identity,
    PORTAL_DEFAULT_ROLE: "viewer",
    PORTAL_RBAC_JSON: JSON.stringify({ "admin@example.test": "admin", "operator@example.test": "operator" }),
    ADMIN_TOKEN: "admin-secret",
    XYOPS_URL: "https://xyops.example.test",
    XYOPS_API_KEY: "xyops-secret",
    PORTAL_PROCESS_METADATA_JSON: JSON.stringify(metadata),
    ...extra,
  };
}

async function request(runtimeEnv, path, options = {}) {
  return worker.fetch(new Request(`https://portal.test${path}`, options), runtimeEnv, {});
}

const catalogResponse = {
  events: [
    { id: "alpha", title: "Source Alpha", description: "Source description", category: "General", user_fields: [] },
    { id: "beta", title: "Source Beta", description: "", category: "General", user_fields: [] },
    { id: "production", title: "Source Production", description: "", category: "Production", user_fields: [] },
  ],
};

test("applies presentation metadata after authorization and preserves XYOps execution ownership", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.pathname.endsWith("/get_events/v1")) return Response.json(catalogResponse);
    if (url.pathname.endsWith("/run_event/v1")) return Response.json({ error: "Concurrent limit reached" }, { status: 429, headers: { "retry-after": "120" } });
    return new Response("not found", { status: 404 });
  };

  try {
    let response = await request(env("operator@example.test"), "/api/integrations/catalog");
    assert.equal(response.status, 200);
    let payload = await response.json();
    assert.deepEqual(payload.events.map((item) => item.id), ["beta", "production", "alpha"]);
    const alpha = payload.events.find((item) => item.id === "alpha");
    assert.equal(alpha.title, "Понятный Alpha");
    assert.equal(alpha.description, "Пользовательское описание");
    assert.equal(alpha.category, "Самообслуживание");
    assert.equal(alpha.icon, "backup");
    assert.equal(alpha.order, 20);
    assert.equal(alpha.help, "Подробная инструкция");
    assert.equal(alpha.presentationOverridden, true);
    assert.match(alpha.schemaVersion, /^v1-/);

    const denySourceCategory = {
      version: 1,
      defaultEffect: "allow",
      adminBypass: false,
      rules: [{ id: "deny-production", effect: "deny", users: [], groups: [], roles: ["operator"], categories: ["Production"], processes: [] }],
    };
    response = await request(env("operator@example.test", { PORTAL_CATALOG_POLICIES_JSON: JSON.stringify(denySourceCategory) }), "/api/integrations/catalog");
    payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.events.some((item) => item.id === "production"), false, "presentation category must not bypass source-category visibility policy");

    response = await request(env("operator@example.test"), "/api/integrations/catalog/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventId: "beta", values: {}, targets: [] }),
    });
    assert.equal(response.status, 429);
    payload = await response.json();
    assert.equal(payload.retryAfter, "120");
    assert.equal(payload.xyopsStatus, 429);
    assert.match(payload.error, /Concurrent limit reached|огранич/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("persists presentation metadata through admin-only API and audits the change", async () => {
  const db = new PresentationD1();
  const adminEnv = env("admin@example.test", { DB: db, PORTAL_PROCESS_METADATA_JSON: undefined });
  const operatorEnv = env("operator@example.test", { DB: db, PORTAL_PROCESS_METADATA_JSON: undefined });

  let response = await request(operatorEnv, "/api/integrations/catalog/presentation", {
    method: "PUT",
    headers: { "content-type": "application/json", "x-admin-token": "admin-secret" },
    body: JSON.stringify({ metadata }),
  });
  assert.equal(response.status, 403);

  response = await request(adminEnv, "/api/integrations/catalog/presentation", {
    method: "PUT",
    headers: { "content-type": "application/json", "x-admin-token": "admin-secret" },
    body: JSON.stringify({ metadata }),
  });
  assert.equal(response.status, 200);
  let payload = await response.json();
  assert.equal(payload.source, "database");
  assert.equal(payload.metadata.processes.alpha.icon, "backup");
  assert.ok(db.audits.some((item) => item.action === "catalog.presentation.updated"));

  response = await request(adminEnv, "/api/integrations/catalog/presentation", { headers: { "x-admin-token": "admin-secret" } });
  assert.equal(response.status, 200);
  payload = await response.json();
  assert.equal(payload.source, "database");
  assert.equal(payload.metadata.processes.alpha.title, "Понятный Alpha");

  response = await request(adminEnv, "/api/integrations/catalog/presentation", {
    method: "PUT",
    headers: { "content-type": "application/json", "x-admin-token": "admin-secret" },
    body: JSON.stringify({ metadata: { version: 1, processes: { alpha: { icon: "not valid icon!" } } } }),
  });
  assert.equal(response.status, 400);
});
