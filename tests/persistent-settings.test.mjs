import assert from "node:assert/strict";
import test from "node:test";

import worker from "../dist/server/index.js";

class MemoryD1 {
  row = null;

  prepare(sql) {
    let values = [];
    const statement = {
      bind: (...args) => { values = args; return statement; },
      run: async () => {
        if (sql.startsWith("INSERT INTO app_settings")) this.row = { config_json: values[1], encrypted_secrets: values[2], updated_at: values[3] };
        return { success: true };
      },
      first: async () => sql.startsWith("SELECT config_json") ? this.row : null,
    };
    return statement;
  }
}

test("settings require admin auth, encrypt secrets and persist across requests", async () => {
  const db = new MemoryD1();
  const env = { DB: db, ADMIN_TOKEN: "admin-token", CONFIG_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") };

  const unauthorized = await worker.fetch(new Request("https://dashboard.test/api/integrations/settings"), env, {});
  assert.equal(unauthorized.status, 401);

  const saved = await worker.fetch(new Request("https://dashboard.test/api/integrations/settings", {
    method: "PUT",
    headers: { "content-type": "application/json", "x-admin-token": "admin-token" },
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

  const loaded = await worker.fetch(new Request("https://dashboard.test/api/integrations/settings", { headers: { "x-admin-token": "admin-token" } }), env, {});
  assert.equal(loaded.status, 200);
  const loadedBody = await loaded.json();
  assert.equal(loadedBody.freeipa.url, "https://ipa.example.test");
  assert.equal(loadedBody.freeipa.username, "reader");
  assert.equal(loadedBody.xyops.url, "https://xyops.example.test");
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
