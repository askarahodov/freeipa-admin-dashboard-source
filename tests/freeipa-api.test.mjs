import assert from "node:assert/strict";
import test from "node:test";

import worker from "../dist/server/index.js";

test("normalizes FreeIPA users and groups without exposing credentials", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    calls.push({ url: url.pathname, body: init.body });
    if (url.pathname.endsWith("/login_password")) {
      assert.equal(String(init.body), "user=reader&password=secret");
      return new Response("ok", { headers: { "set-cookie": "ipa_session=token; Path=/ipa" } });
    }
    const method = JSON.parse(String(init.body)).method;
    if (method === "user_find") {
      return Response.json({ result: { result: [{ uid: ["asmirnov"], cn: ["Смирнов Алексей"], mail: ["a@example.test"], nsaccountlock: ["TRUE"], memberof_group: ["devops", "security"] }] }, error: null });
    }
    if (method === "group_find") {
      return Response.json({ result: { result: [{ cn: ["devops"], description: ["Инфраструктура"], member_user: ["asmirnov"], gidnumber: ["1200"] }] }, error: null });
    }
    return new Response("not found", { status: 404 });
  };

  const env = { IPA_URL: "https://ipa.example.test", IPA_USERNAME: "reader", IPA_PASSWORD: "secret" };
  try {
    const usersResponse = await worker.fetch(new Request("https://dashboard.test/api/integrations/users"), env, {});
    assert.equal(usersResponse.status, 200);
    assert.deepEqual(await usersResponse.json(), { mode: "live", users: [{ uid: "asmirnov", name: "Смирнов Алексей", firstName: "", lastName: "", email: "a@example.test", active: false, groups: 2 }] });

    const groupsResponse = await worker.fetch(new Request("https://dashboard.test/api/integrations/groups"), env, {});
    assert.equal(groupsResponse.status, 200);
    assert.deepEqual(await groupsResponse.json(), { mode: "live", source: "group_find", groups: [{ name: "devops", description: "Инфраструктура", members: 1, type: "POSIX" }] });
    assert.equal(calls.length, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("performs FreeIPA CRUD directly without XYOps", async () => {
  const originalFetch = globalThis.fetch;
  const rpcCalls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    assert.ok(!url.pathname.includes("run_event"), "XYOps must not be called for direct FreeIPA actions");
    if (url.pathname.endsWith("/login_password")) return new Response("ok", { headers: { "set-cookie": "ipa_session=token; Path=/ipa" } });
    const payload = JSON.parse(String(init.body));
    rpcCalls.push(payload);
    return Response.json({ result: { result: [{}] }, error: null });
  };
  const env = { IPA_URL: "https://ipa.example.test", IPA_USERNAME: "administrator", IPA_PASSWORD: "secret" };
  const actions = [
    { operation: "user_add", username: "alice", firstName: "Alice", lastName: "Admin", email: "alice@example.test", password: "temporary" },
    { operation: "user_mod", username: "alice", firstName: "Alicia", lastName: "Admin", email: "alicia@example.test" },
    { operation: "user_disable", username: "alice" },
    { operation: "group_add", group: "devops", description: "Infrastructure" },
    { operation: "group_add_member", group: "devops", username: "alice" },
  ];
  try {
    for (const action of actions) {
      const response = await worker.fetch(new Request("https://dashboard.test/api/integrations/freeipa/actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(action),
      }), env, {});
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.direct, true);
      assert.equal(body.ok, true);
      assert.equal(JSON.stringify(body).includes("temporary"), false);
    }
    assert.deepEqual(rpcCalls.map((call) => call.method), ["user_add", "user_mod", "user_disable", "group_add", "group_add_member"]);
    assert.deepEqual(rpcCalls[0].params, [["alice"], { givenname: "Alice", sn: "Admin", mail: "alice@example.test", userpassword: "temporary" }]);
    assert.deepEqual(rpcCalls[4].params, [["devops"], { user: ["alice"] }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("validates direct FreeIPA mutations before making a network request", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("network must not be called"); };
  try {
    const response = await worker.fetch(new Request("https://dashboard.test/api/integrations/freeipa/actions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation: "user_add", username: "invalid user", firstName: "A", lastName: "B" }),
    }), { IPA_URL: "https://ipa.example.test", IPA_USERNAME: "administrator", IPA_PASSWORD: "secret" }, {});
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /логин/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("derives groups from user memberships when group_find is unavailable", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.pathname.endsWith("/login_password")) return new Response("ok", { headers: { "set-cookie": "ipa_session=token; Path=/ipa" } });
    const method = JSON.parse(String(init.body)).method;
    if (method === "group_find") return Response.json({ result: null, error: { message: "not allowed" } });
    if (method === "user_find") return Response.json({ result: { result: [
      { uid: ["alice"], memberof_group: ["devops", "vpn"] },
      { uid: ["bob"], memberof_group: ["devops"] },
    ] }, error: null });
    return new Response("not found", { status: 404 });
  };

  try {
    const response = await worker.fetch(new Request("https://dashboard.test/api/integrations/groups"), { IPA_URL: "https://ipa.example.test", IPA_USERNAME: "reader", IPA_PASSWORD: "secret" }, {});
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      mode: "live",
      source: "user_membership",
      degraded: true,
      groups: [
        { name: "devops", description: "Получено из членства пользователей", members: 2, type: "Directory" },
        { name: "vpn", description: "Получено из членства пользователей", members: 1, type: "Directory" },
      ],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
