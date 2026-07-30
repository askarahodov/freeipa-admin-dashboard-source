import assert from "node:assert/strict";
import test from "node:test";

import worker from "../dist/server/index.js";

class MemoryD1 {
  row = null;
  lock = null;

  prepare(sql) {
    let values = [];
    const statement = {
      bind: (...args) => { values = args; return statement; },
      run: async () => {
        if (sql.startsWith("DELETE FROM portal_settings_source_lock WHERE id = ? AND acquired_at < ?")) {
          if (this.lock && Number(this.lock.acquiredAt) < Number(values[1])) {
            this.lock = null;
            return { success: true, meta: { changes: 1 } };
          }
          return { success: true, meta: { changes: 0 } };
        }
        if (sql.startsWith("INSERT OR IGNORE INTO portal_settings_source_lock")) {
          if (this.lock) return { success: true, meta: { changes: 0 } };
          this.lock = { owner: values[1], acquiredAt: values[2] };
          return { success: true, meta: { changes: 1 } };
        }
        if (sql.startsWith("DELETE FROM portal_settings_source_lock WHERE id = ? AND owner = ?")) {
          if (this.lock?.owner === values[1]) {
            this.lock = null;
            return { success: true, meta: { changes: 1 } };
          }
          return { success: true, meta: { changes: 0 } };
        }
        if (sql.startsWith("INSERT INTO app_settings")) {
          this.row = { config_json: values[1], encrypted_secrets: values[2], updated_at: values[3] };
          return { success: true, meta: { changes: 1 } };
        }
        if (sql.startsWith("DELETE FROM app_settings WHERE id = ? AND updated_at = ?")) {
          if (this.row && Number(this.row.updated_at) === Number(values[1])) {
            this.row = null;
            return { success: true, meta: { changes: 1 } };
          }
          return { success: true, meta: { changes: 0 } };
        }
        if (sql.startsWith("UPDATE app_settings SET config_json = ? WHERE id = ? AND updated_at = ?")) {
          if (this.row && Number(this.row.updated_at) === Number(values[2])) {
            this.row.config_json = values[0];
            return { success: true, meta: { changes: 1 } };
          }
          return { success: true, meta: { changes: 0 } };
        }
        if (sql.startsWith("UPDATE app_settings SET config_json = ?, encrypted_secrets = ?, updated_at = ? WHERE id = ? AND updated_at = ?")) {
          if (this.row && Number(this.row.updated_at) === Number(values[4])) {
            this.row = { config_json: values[0], encrypted_secrets: values[1], updated_at: values[2] };
            return { success: true, meta: { changes: 1 } };
          }
          return { success: true, meta: { changes: 0 } };
        }
        return { success: true, meta: { changes: 0 } };
      },
      first: async () => {
        if (!sql.startsWith("SELECT config_json")) return null;
        if (sql.includes("updated_at = ?") && this.row && Number(this.row.updated_at) !== Number(values.at(-1))) return null;
        return this.row;
      },
    };
    return statement;
  }
}

function adminEnv(values = {}) {
  return {
    PORTAL_IDENTITY_MODE: "static",
    PORTAL_STATIC_IDENTITY: "admin@example.test",
    PORTAL_DEFAULT_ROLE: "viewer",
    PORTAL_RBAC_JSON: JSON.stringify({ "admin@example.test": "admin" }),
    ...values,
  };
}

const adminHeaders = { "content-type": "application/json", "x-admin-token": "admin-token" };

test("healthcheck does not depend on database or external integrations", async () => {
  const response = await worker.fetch(new Request("https://dashboard.test/api/integrations/health"), {
    DB: { prepare() { throw new Error("database must not be touched"); } },
    IPA_URL: "https://unreachable.example.test",
    XYOPS_URL: "https://unreachable.example.test",
  }, {});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

test("settings require admin auth, encrypt secrets and persist source metadata", async () => {
  const db = new MemoryD1();
  const env = adminEnv({ DB: db, ADMIN_TOKEN: "admin-token", CONFIG_ENCRYPTION_KEY: `  ${Buffer.alloc(32, 7).toString("base64")}  ` });

  const unauthorized = await worker.fetch(new Request("https://dashboard.test/api/integrations/settings"), env, {});
  assert.equal(unauthorized.status, 401);

  const saved = await worker.fetch(new Request("https://dashboard.test/api/integrations/settings", {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({ demoMode: false, ipaUrl: "https://ipa.example.test", ipaUsername: "reader", ipaPassword: "ipa-secret", xyopsUrl: "https://xyops.example.test", xyopsApiKey: "xyops-secret" }),
  }), env, {});
  assert.equal(saved.status, 200);
  const savedBody = await saved.json();
  assert.equal(savedBody.source, "database");
  assert.equal(savedBody.freeipa.passwordConfigured, true);
  assert.equal(savedBody.xyops.apiKeyConfigured, true);
  assert.doesNotMatch(JSON.stringify(savedBody), /ipa-secret|xyops-secret/);
  assert.doesNotMatch(db.row.encrypted_secrets, /ipa-secret|xyops-secret/);
  assert.match(db.row.encrypted_secrets, /^v1\./);
  assert.deepEqual(JSON.parse(db.row.config_json).overrides, ["demoMode", "ipaUrl", "ipaUsername", "ipaPassword", "xyopsUrl", "xyopsApiKey"]);

  const loaded = await worker.fetch(new Request("https://dashboard.test/api/integrations/settings", { headers: { "x-admin-token": "admin-token" } }), env, {});
  assert.equal(loaded.status, 200);
  const loadedBody = await loaded.json();
  assert.equal(loadedBody.freeipa.url, "https://ipa.example.test");
  assert.equal(loadedBody.freeipa.username, "reader");
  assert.equal(loadedBody.xyops.url, "https://xyops.example.test");
  assert.equal(db.lock, null);
});

test("explicit demo mode is required for demo catalog", async () => {
  const unconfigured = await worker.fetch(new Request("https://dashboard.test/api/integrations/catalog"), {}, {});
  assert.equal(unconfigured.status, 200);
  assert.deepEqual(await unconfigured.json().then((body) => ({ mode: body.mode, count: body.events.length })), { mode: "unconfigured", count: 0 });

  const demo = await worker.fetch(new Request("https://dashboard.test/api/integrations/catalog"), { DEMO_MODE: "true" }, {});
  assert.equal(demo.status, 200);
  const demoBody = await demo.json();
  assert.equal(demoBody.mode, "demo");
  assert.ok(demoBody.events.some((event) => event.id === "database-backup"));
});

test("FreeIPA connection test replaces opaque runtime failures with actionable diagnostics", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("internal error; reference = must-not-leak"); };
  try {
    const response = await worker.fetch(new Request("https://dashboard.test/api/integrations/settings/test", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ service: "freeipa", ipaUrl: "https://ipa.example.test", ipaUsername: "reader", ipaPassword: "secret" }),
    }), adminEnv({ ADMIN_TOKEN: "admin-token" }), {});
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.match(body.error, /FreeIPA недоступен из среды портала на этапе «вход»/);
    assert.doesNotMatch(body.error, /reference|must-not-leak/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("FreeIPA connection test uses the Docker Node Gateway when configured", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "http://127.0.0.1:3301/rpc");
    assert.equal(init.headers.authorization, "Bearer gateway-token");
    const body = JSON.parse(init.body);
    assert.deepEqual({ ipaUrl: body.ipaUrl, username: body.username, password: body.password, method: body.method }, { ipaUrl: "https://ipa.example.test", username: "reader", password: "secret", method: "user_find" });
    return Response.json({ result: [{ uid: ["alice"] }] });
  };
  try {
    const response = await worker.fetch(new Request("https://dashboard.test/api/integrations/settings/test", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ service: "freeipa", ipaUrl: "https://ipa.example.test", ipaUsername: "reader", ipaPassword: "secret" }),
    }), adminEnv({ ADMIN_TOKEN: "admin-token", IPA_NODE_GATEWAY_URL: "http://127.0.0.1:3301", IPA_NODE_GATEWAY_TOKEN: "gateway-token" }), {});
    assert.equal(response.status, 200);
    assert.equal((await response.json()).service, "freeipa");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("integration status probes FreeIPA through the Docker Node Gateway", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    assert.equal(String(url), "http://127.0.0.1:3301/rpc");
    const body = JSON.parse(init.body);
    assert.equal(body.method, "user_find");
    assert.equal(body.options.sizelimit, 1);
    return Response.json({ result: [{ uid: ["alice"] }] });
  };
  try {
    const response = await worker.fetch(new Request("https://dashboard.test/api/integrations/status"), {
      IPA_URL: "https://ipa.example.test",
      IPA_USERNAME: "reader",
      IPA_PASSWORD: "secret",
      IPA_NODE_GATEWAY_URL: "http://127.0.0.1:3301",
      IPA_NODE_GATEWAY_TOKEN: "gateway-token",
    }, {});
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.freeipa, { configured: true, reachable: true, error: null });
    assert.deepEqual(calls, ["http://127.0.0.1:3301/rpc"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("automation routes preserve the latest source metadata and omit secret defaults", async () => {
  const db = new MemoryD1();
  const env = adminEnv({ DB: db, ADMIN_TOKEN: "admin-token", CONFIG_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64") });
  const route = {
    key: "disable-user",
    title: "Disable user",
    operation: "user_disable",
    eventId: "event-42",
    schemaVersion: "v1-deadbeef",
    kind: "workflow",
    enabled: true,
    targets: ["freeipa"],
    fields: [
      { key: "username", label: "Username", type: "string", required: true, target: "params", groupPath: ["Identity", "Account"], visibleWhen: { field: "mode", operator: "equals", value: "manual" } },
      { key: "operator_password", label: "Password", type: "password", default: "must-not-persist", target: "input" },
    ],
  };

  const unauthorized = await worker.fetch(new Request("https://dashboard.test/api/integrations/routes", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ routes: [route] }) }), env, {});
  assert.equal(unauthorized.status, 401);

  const saved = await worker.fetch(new Request("https://dashboard.test/api/integrations/routes", { method: "PUT", headers: adminHeaders, body: JSON.stringify({ routes: [route] }) }), env, {});
  assert.equal(saved.status, 200);
  const savedBody = await saved.json();
  assert.equal(savedBody.routes[0].eventId, "event-42");
  assert.equal(savedBody.routes[0].schemaVersion, "v1-deadbeef");
  assert.deepEqual(savedBody.routes[0].fields[0].groupPath, ["Identity", "Account"]);
  assert.deepEqual(savedBody.routes[0].fields[0].visibleWhen, { field: "mode", operator: "equals", value: "manual" });
  assert.equal(savedBody.routes[0].fields[1].default, undefined);
  assert.doesNotMatch(db.row.config_json, /must-not-persist/);
  assert.deepEqual(JSON.parse(db.row.config_json).overrides, []);

  const direct = await worker.fetch(new Request("https://dashboard.test/api/integrations/settings", {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({ demoMode: true }),
  }), env, {});
  assert.equal(direct.status, 200);
  assert.deepEqual(JSON.parse(db.row.config_json).overrides, ["demoMode"]);

  const replaced = await worker.fetch(new Request("https://dashboard.test/api/integrations/routes", { method: "PUT", headers: adminHeaders, body: JSON.stringify({ routes: [] }) }), env, {});
  assert.equal(replaced.status, 200);
  assert.deepEqual(JSON.parse(db.row.config_json).overrides, ["demoMode"]);
  assert.equal(db.lock, null);

  const empty = await worker.fetch(new Request("https://dashboard.test/api/integrations/routes"), env, {});
  assert.deepEqual(await empty.json().then((body) => body.routes), []);
});
