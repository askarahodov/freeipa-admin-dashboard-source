import assert from "node:assert/strict";
import test from "node:test";

import { createFreeIpaGateway, runFreeIpaRpc } from "../scripts/freeipa-gateway.mjs";

test("Node Gateway performs the documented FreeIPA password and JSON-RPC flow", async () => {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url: String(url), init });
    if (String(url).endsWith("/ipa/session/login_password")) return new Response("", { status: 200, headers: { "set-cookie": "ipa_session=abc123; Path=/ipa; Secure; HttpOnly" } });
    return Response.json({ result: { result: [{ uid: ["alice"] }] }, error: null });
  };
  const result = await runFreeIpaRpc({ ipaUrl: "https://ipa.example.test", username: "reader", password: "secret", method: "user_find", args: [""], options: { sizelimit: 1 } }, fetchImpl);
  assert.deepEqual(result, [{ uid: ["alice"] }]);
  assert.equal(requests.length, 2);
  assert.match(String(requests[0].init.body), /user=reader&password=secret/);
  assert.equal(requests[1].init.headers.cookie, "ipa_session=abc123");
  assert.deepEqual(JSON.parse(requests[1].init.body), { method: "user_find", params: [[""], { sizelimit: 1 }], id: 0 });
});

test("Node Gateway permits explicitly supported FreeIPA mutations", async () => {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url: String(url), init });
    if (String(url).endsWith("/ipa/session/login_password")) return new Response("", { status: 200, headers: { "set-cookie": "ipa_session=abc123; Path=/ipa" } });
    return Response.json({ result: { result: [{}] }, error: null });
  };
  await runFreeIpaRpc({ ipaUrl: "https://ipa.example.test", username: "administrator", password: "secret", method: "user_add", args: ["alice"], options: { givenname: "Alice", sn: "Admin" } }, fetchImpl);
  assert.deepEqual(JSON.parse(requests[1].init.body), { method: "user_add", params: [["alice"], { givenname: "Alice", sn: "Admin" }], id: 0 });
});

test("Node Gateway requires its ephemeral bearer token", async () => {
  const server = createFreeIpaGateway({ token: "test-token", fetchImpl: async () => { throw new Error("must not run"); } });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/rpc`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer wrong-token" }, body: "{}" });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "Unauthorized" });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
