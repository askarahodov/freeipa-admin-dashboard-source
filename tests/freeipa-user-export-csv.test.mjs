import assert from "node:assert/strict";
import test from "node:test";

import worker from "../dist/server/index.js";

const env = {
  PORTAL_IDENTITY_MODE: "static",
  PORTAL_STATIC_IDENTITY: "operator@example.test",
  PORTAL_DEFAULT_ROLE: "viewer",
  PORTAL_RBAC_JSON: JSON.stringify({ "operator@example.test": "operator" }),
  IPA_URL: "https://ipa.example.test",
  IPA_USERNAME: "administrator",
  IPA_PASSWORD: "secret",
};

test("exports the complete filtered set as formula-safe UTF-8 CSV", async () => {
  const originalFetch = globalThis.fetch;
  const methods = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.pathname.endsWith("/login_password")) return new Response("ok", { headers: { "set-cookie": "ipa_session=token; Path=/ipa" } });
    const payload = JSON.parse(String(init.body));
    methods.push(payload.method);
    return Response.json({ result: { result: [
      { uid: ["alice"], cn: ["=HYPERLINK(\"https://invalid.test\")"], mail: ["alice@example.test"], memberof_group: ["devops"] },
      { uid: ["bob"], cn: ["Bob User"], mail: ["bob@example.test"], nsaccountlock: ["TRUE"], memberof_group: ["security"] },
      { uid: ["carol"], cn: ["Carol User"], mail: ["carol@example.test"], memberof_group: ["devops", "vpn"] },
    ] }, error: null });
  };

  try {
    const response = await worker.fetch(new Request("https://dashboard.test/api/integrations/users/export.csv?status=active&group=devops&sort=uid&direction=asc"), env, {});
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /text\/csv/);
    assert.equal(response.headers.get("x-exported-users"), "2");
    assert.match(response.headers.get("content-disposition"), /freeipa-users-/);
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.deepEqual(Array.from(bytes.slice(0, 3)), [0xef, 0xbb, 0xbf]);
    const csv = new TextDecoder("utf-8").decode(bytes);
    assert.match(csv, /"Логин";"Имя";"Email"/);
    assert.match(csv, /"alice";"'=HYPERLINK/);
    assert.match(csv, /"carol"/);
    assert.doesNotMatch(csv, /"bob"/);
    assert.deepEqual(methods, ["user_find"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
