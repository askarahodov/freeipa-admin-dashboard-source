import assert from "node:assert/strict";
import test from "node:test";

import worker from "../dist/server/index.js";
import { markSchemaTestBypass } from "../worker/schema-migrations-boundary.ts";

const operatorEnv = markSchemaTestBypass({
  PORTAL_IDENTITY_MODE: "static",
  PORTAL_STATIC_IDENTITY: "operator@example.test",
  PORTAL_DEFAULT_ROLE: "viewer",
  PORTAL_RBAC_JSON: JSON.stringify({ "operator@example.test": "operator" }),
  IPA_URL: "https://ipa.example.test",
  IPA_USERNAME: "administrator",
  IPA_PASSWORD: "secret",
});

test("rejects viewers and oversized selections before FreeIPA mutations", async () => {
  const originalFetch = globalThis.fetch;
  let externalCalls = 0;
  globalThis.fetch = async () => { externalCalls += 1; throw new Error("network must not be called"); };
  try {
    const viewerResponse = await worker.fetch(new Request("https://dashboard.test/api/integrations/freeipa/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "disable", users: ["alice"] }),
    }), markSchemaTestBypass({ PORTAL_IDENTITY_MODE: "static", PORTAL_STATIC_IDENTITY: "viewer@example.test", PORTAL_DEFAULT_ROLE: "viewer" }), {});
    assert.equal(viewerResponse.status, 403);

    const oversizedResponse = await worker.fetch(new Request("https://dashboard.test/api/integrations/freeipa/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "disable", users: Array.from({ length: 51 }, (_, index) => `user${index}`) }),
    }), operatorEnv, {});
    assert.equal(oversizedResponse.status, 400);
    assert.match((await oversizedResponse.json()).error, /не более 50/);
    assert.equal(externalCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
