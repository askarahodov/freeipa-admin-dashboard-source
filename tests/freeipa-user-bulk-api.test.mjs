import assert from "node:assert/strict";
import test from "node:test";

import worker from "../dist/server/index.js";
import { markSchemaTestBypass } from "../worker/schema-migrations-boundary.ts";

function operatorEnv(values = {}) {
  return markSchemaTestBypass({
    PORTAL_IDENTITY_MODE: "static",
    PORTAL_STATIC_IDENTITY: "operator@example.test",
    PORTAL_DEFAULT_ROLE: "viewer",
    PORTAL_RBAC_JSON: JSON.stringify({ "operator@example.test": "operator" }),
    IPA_URL: "https://ipa.example.test",
    IPA_USERNAME: "administrator",
    IPA_PASSWORD: "secret",
    ...values,
  });
}

test("executes bounded bulk enable through existing FreeIPA actions", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.pathname.endsWith("/login_password")) return new Response("ok", { headers: { "set-cookie": "ipa_session=token; Path=/ipa" } });
    const payload = JSON.parse(String(init.body));
    calls.push(payload);
    return Response.json({ result: { result: payload.method === "user_find" ? [] : [{}] }, error: null });
  };

  try {
    const response = await worker.fetch(new Request("https://dashboard.test/api/integrations/freeipa/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "enable", users: ["alice", "bob", "alice", "carol"] }),
    }), operatorEnv(), {});
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual({ requested: body.requested, succeeded: body.succeeded, failed: body.failed, ok: body.ok }, { requested: 3, succeeded: 3, failed: 0, ok: true });
    assert.deepEqual(new Set(body.results.map((item) => item.uid)), new Set(["alice", "bob", "carol"]));
    assert.equal(body.results.every((item) => item.ok && item.runId), true);
    assert.equal(calls.filter((call) => call.method === "user_find").length, 1);
    assert.deepEqual(new Set(calls.filter((call) => call.method === "user_enable").map((call) => call.params[0][0])), new Set(["alice", "bob", "carol"]));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
