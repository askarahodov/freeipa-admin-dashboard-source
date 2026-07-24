import assert from "node:assert/strict";
import test from "node:test";

import worker from "../dist/server/index.js";

function operatorEnv(values = {}) {
  return {
    PORTAL_IDENTITY_MODE: "static",
    PORTAL_STATIC_IDENTITY: "operator@example.test",
    PORTAL_DEFAULT_ROLE: "viewer",
    PORTAL_RBAC_JSON: JSON.stringify({ "operator@example.test": "operator" }),
    IPA_URL: "https://ipa.example.test",
    IPA_USERNAME: "administrator",
    IPA_PASSWORD: "secret",
    ...values,
  };
}

function rpcPayload(init) {
  return JSON.parse(String(init.body));
}

test("executes bounded bulk enable through existing FreeIPA actions", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.pathname.endsWith("/login_password")) return new Response("ok", { headers: { "set-cookie": "ipa_session=token; Path=/ipa" } });
    const payload = rpcPayload(init);
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

test("returns per-user partial results for bulk group membership", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.pathname.endsWith("/login_password")) return new Response("ok", { headers: { "set-cookie": "ipa_session=token; Path=/ipa" } });
    const payload = rpcPayload(init);
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
    }), operatorEnv(), {});
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

test("rejects viewers and oversized selections before FreeIPA mutations", async () => {
  const originalFetch = globalThis.fetch;
  let externalCalls = 0;
  globalThis.fetch = async () => { externalCalls += 1; throw new Error("network must not be called"); };
  try {
    const viewerResponse = await worker.fetch(new Request("https://dashboard.test/api/integrations/freeipa/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "disable", users: ["alice"] }),
    }), { PORTAL_IDENTITY_MODE: "static", PORTAL_STATIC_IDENTITY: "viewer@example.test", PORTAL_DEFAULT_ROLE: "viewer" }, {});
    assert.equal(viewerResponse.status, 403);

    const oversizedResponse = await worker.fetch(new Request("https://dashboard.test/api/integrations/freeipa/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "disable", users: Array.from({ length: 51 }, (_, index) => `user${index}`) }),
    }), operatorEnv(), {});
    assert.equal(oversizedResponse.status, 400);
    assert.match((await oversizedResponse.json()).error, /не более 50/);
    assert.equal(externalCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("exports the complete filtered set as formula-safe UTF-8 CSV", async () => {
  const originalFetch = globalThis.fetch;
  const methods = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.pathname.endsWith("/login_password")) return new Response("ok", { headers: { "set-cookie": "ipa_session=token; Path=/ipa" } });
    const payload = rpcPayload(init);
    methods.push(payload.method);
    return Response.json({ result: { result: [
      { uid: ["alice"], cn: ["=HYPERLINK(\"https://invalid.test\")"], mail: ["alice@example.test"], memberof_group: ["devops"] },
      { uid: ["bob"], cn: ["Bob User"], mail: ["bob@example.test"], nsaccountlock: ["TRUE"], memberof_group: ["security"] },
      { uid: ["carol"], cn: ["Carol User"], mail: ["carol@example.test"], memberof_group: ["devops", "vpn"] },
    ] }, error: null });
  };

  try {
    const response = await worker.fetch(new Request("https://dashboard.test/api/integrations/users/export.csv?status=active&group=devops&sort=uid&direction=asc"), operatorEnv(), {});
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /text\/csv/);
    assert.equal(response.headers.get("x-exported-users"), "2");
    assert.match(response.headers.get("content-disposition"), /freeipa-users-/);
    const csv = await response.text();
    assert.equal(csv.startsWith("\uFEFF"), true);
    assert.match(csv, /"Логин";"Имя";"Email"/);
    assert.match(csv, /"alice";"'=HYPERLINK/);
    assert.match(csv, /"carol"/);
    assert.doesNotMatch(csv, /"bob"/);
    assert.deepEqual(methods, ["user_find"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
