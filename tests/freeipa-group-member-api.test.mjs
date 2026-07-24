import assert from "node:assert/strict";
import test from "node:test";

import worker from "../dist/server/index.js";

const env = {
  PORTAL_IDENTITY_MODE: "static",
  PORTAL_STATIC_IDENTITY: "viewer@example.test",
  PORTAL_DEFAULT_ROLE: "viewer",
  IPA_URL: "https://ipa.example.test",
  IPA_USERNAME: "reader",
  IPA_PASSWORD: "secret",
};

function rpcPayload(init) {
  return JSON.parse(String(init.body));
}

test("loads and paginates members through existing groups and users APIs", async () => {
  const originalFetch = globalThis.fetch;
  const methods = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.pathname.endsWith("/login_password")) return new Response("ok", { headers: { "set-cookie": "ipa_session=token; Path=/ipa" } });
    const payload = rpcPayload(init);
    methods.push(payload.method);
    if (payload.method === "group_find") {
      return Response.json({ result: { result: [{ cn: ["devops"], description: ["Infrastructure"], member_user: ["alice", "bob", "ghost"], gidnumber: ["1200"] }] }, error: null });
    }
    if (payload.method === "user_find") {
      return Response.json({ result: { result: [
        { uid: ["alice"], cn: ["Alice Admin"], mail: ["alice@example.test"], memberof_group: ["devops"] },
        { uid: ["bob"], cn: ["Bob User"], mail: ["bob@example.test"], nsaccountlock: ["TRUE"], memberof_group: ["devops"] },
      ] }, error: null });
    }
    return new Response("not found", { status: 404 });
  };

  try {
    const response = await worker.fetch(new Request("https://dashboard.test/api/integrations/groups/members?group=devops&status=all&sort=status&direction=asc&page=1&pageSize=2"), env, {});
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.mode, "live");
    assert.equal(body.group.name, "devops");
    assert.deepEqual(body.members.map((member) => member.uid), ["alice", "bob"]);
    assert.deepEqual(body.pagination, { page: 1, pageSize: 2, total: 3, totalPages: 2, from: 1, to: 2 });
    assert.deepEqual(body.summary, { total: 3, active: 1, disabled: 1, unknown: 1, filtered: 3 });
    assert.deepEqual(new Set(methods), new Set(["group_find", "user_find"]));
    assert.equal(methods.filter((method) => method === "group_find").length, 1);
    assert.equal(methods.filter((method) => method === "user_find").length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("returns unknown members and applies server search", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.pathname.endsWith("/login_password")) return new Response("ok", { headers: { "set-cookie": "ipa_session=token; Path=/ipa" } });
    const payload = rpcPayload(init);
    if (payload.method === "group_find") return Response.json({ result: { result: [{ cn: ["devops"], member_user: ["ghost"] }] }, error: null });
    if (payload.method === "user_find") return Response.json({ result: { result: [] }, error: null });
    return new Response("not found", { status: 404 });
  };

  try {
    const response = await worker.fetch(new Request("https://dashboard.test/api/integrations/groups/members?group=devops&q=ghost&status=unknown&page=1&pageSize=10"), env, {});
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.members, [{ uid: "ghost", name: "ghost", email: "", active: null }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects invalid and missing groups", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (input, init = {}) => {
    calls += 1;
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.pathname.endsWith("/login_password")) return new Response("ok", { headers: { "set-cookie": "ipa_session=token; Path=/ipa" } });
    const payload = rpcPayload(init);
    if (payload.method === "group_find") return Response.json({ result: { result: [{ cn: ["security"], member_user: [] }] }, error: null });
    if (payload.method === "user_find") return Response.json({ result: { result: [] }, error: null });
    return new Response("not found", { status: 404 });
  };

  try {
    const invalid = await worker.fetch(new Request("https://dashboard.test/api/integrations/groups/members?group=invalid%20group"), env, {});
    assert.equal(invalid.status, 400);
    assert.equal(calls, 0);

    const missing = await worker.fetch(new Request("https://dashboard.test/api/integrations/groups/members?group=devops"), env, {});
    assert.equal(missing.status, 404);
    assert.match((await missing.json()).error, /не найдена/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
