import assert from "node:assert/strict";
import test from "node:test";

import { readFreeIpaGroups, readFreeIpaUsers } from "../../worker/freeipa-base-read.ts";

const liveEnv = () => ({
  IPA_USERNAME: "reader",
  IPA_PASSWORD: "secret",
});

test("base FreeIPA reads preserve demo and unconfigured envelopes", async () => {
  const demoUsers = await readFreeIpaUsers({ DEMO_MODE: "true" }, null);
  assert.equal(demoUsers.status, 200);
  assert.deepEqual(await demoUsers.json(), { mode: "demo", users: [] });

  const unconfiguredGroups = await readFreeIpaGroups({}, null);
  assert.equal(unconfiguredGroups.status, 200);
  assert.deepEqual(await unconfiguredGroups.json(), { mode: "unconfigured", groups: [] });
});

test("base FreeIPA users preserve normalized live projection", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.pathname.endsWith("/login_password")) {
      assert.equal(String(init.body), "user=reader&password=secret");
      return new Response("ok", { headers: { "set-cookie": "ipa_session=token; Path=/ipa" } });
    }
    const payload = JSON.parse(String(init.body));
    assert.equal(payload.method, "user_find");
    return Response.json({ result: { result: [{
      uid: ["asmirnov"],
      cn: ["Смирнов Алексей"],
      givenname: ["Алексей"],
      sn: ["Смирнов"],
      mail: ["a@example.test"],
      nsaccountlock: ["TRUE"],
      memberof_group: ["devops", "security"],
    }] }, error: null });
  };
  try {
    const response = await readFreeIpaUsers(liveEnv(), "https://ipa.example.test");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { mode: "live", users: [{
      uid: "asmirnov",
      name: "Смирнов Алексей",
      firstName: "Алексей",
      lastName: "Смирнов",
      email: "a@example.test",
      active: false,
      groups: 2,
      groupNames: ["devops", "security"],
    }] });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("base FreeIPA groups preserve membership fallback", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.pathname.endsWith("/login_password")) return new Response("ok", { headers: { "set-cookie": "ipa_session=token; Path=/ipa" } });
    const payload = JSON.parse(String(init.body));
    if (payload.method === "group_find") return Response.json({ result: null, error: { message: "not allowed" } });
    if (payload.method === "user_find") return Response.json({ result: { result: [
      { uid: ["alice"], memberof_group: ["devops", "vpn"] },
      { uid: ["bob"], memberof_group: ["devops"] },
    ] }, error: null });
    throw new Error(`unexpected method: ${payload.method}`);
  };
  try {
    const response = await readFreeIpaGroups(liveEnv(), "https://ipa.example.test");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      mode: "live",
      source: "user_membership",
      degraded: true,
      groups: [
        { name: "devops", description: "Получено из членства пользователей", members: 2, memberUids: ["alice", "bob"], type: "Directory" },
        { name: "vpn", description: "Получено из членства пользователей", members: 1, memberUids: ["alice"], type: "Directory" },
      ],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
