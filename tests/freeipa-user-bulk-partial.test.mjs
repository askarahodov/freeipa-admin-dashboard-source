import assert from "node:assert/strict";
import test from "node:test";

import worker from "../dist/server/index.js";
import { markSchemaTestBypass } from "../worker/schema-migrations-boundary.ts";

const env = markSchemaTestBypass({
  PORTAL_IDENTITY_MODE: "static",
  PORTAL_STATIC_IDENTITY: "operator@example.test",
  PORTAL_DEFAULT_ROLE: "viewer",
  PORTAL_RBAC_JSON: JSON.stringify({ "operator@example.test": "operator" }),
  IPA_URL: "https://ipa.example.test",
  IPA_USERNAME: "administrator",
  IPA_PASSWORD: "secret",
});

test("returns per-user partial results for bulk group membership", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.pathname.endsWith("/login_password")) return new Response("ok", { headers: { "set-cookie": "ipa_session=token; Path=/ipa" } });
    const payload = JSON.parse(String(init.body));
    if (payload.method === "user_find") return Response.json({ result: { result: [] }, error: null });
    const uid = payload.params?.[1]?.user?.[0];
    if (uid === "bob") return Response.json({ result: null, error: { message: "already a member" } });
    return Response.json({ result: { result: [{}] }, error: null });
  };

  try {
    const response = await worker.fetch(new Request("https://dashboard.test/api/integrations/freeipa/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "add_to_group", group: "devops", users: ["alice", "bob"] }),
    }), env, {});
    assert.equal(response.status, 207);
    const body = await response.json();
    assert.deepEqual({ requested: body.requested, succeeded: body.succeeded, failed: body.failed, ok: body.ok }, { requested: 2, succeeded: 1, failed: 1, ok: false });
    assert.equal(body.results.find((item) => item.uid === "alice").ok, true);
    assert.match(body.results.find((item) => item.uid === "bob").error, /already a member/);
    assert.equal(body.group, "devops");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
