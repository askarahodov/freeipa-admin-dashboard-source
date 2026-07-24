import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import worker from "../dist/server/index.js";
import { normalizeFreeIpaUserQuery, queryFreeIpaUsers } from "../freeipa-user-query.ts";

const users = [
  { uid: "zvolkov", name: "Волков Захар", firstName: "Захар", lastName: "Волков", email: "z@example.test", active: true, groups: 2, groupNames: ["devops", "vpn"] },
  { uid: "asmirnov", name: "Смирнов Алексей", firstName: "Алексей", lastName: "Смирнов", email: "a@example.test", active: false, groups: 1, groupNames: ["security"] },
  { uid: "bivanova", name: "Иванова Борислава", firstName: "Борислава", lastName: "Иванова", email: "b@example.test", active: true, groups: 1, groupNames: ["devops"] },
  { uid: "cpetrov", name: "Петров Сергей", firstName: "Сергей", lastName: "Петров", email: "c@example.test", active: true, groups: 0, groupNames: [] },
];

test("normalizes FreeIPA user query parameters with bounded allowlists", () => {
  const query = normalizeFreeIpaUserQuery(new URLSearchParams({
    q: `  devops\u0000${"x".repeat(300)}  `,
    status: "unexpected",
    group: "devops",
    sort: "password",
    direction: "sideways",
    page: "-3",
    pageSize: "999",
  }));
  assert.equal(query.q.startsWith("devops"), true);
  assert.equal(query.q.includes("\u0000"), false);
  assert.equal(query.q.length, 160);
  assert.equal(query.status, "all");
  assert.equal(query.group, "devops");
  assert.equal(query.sort, "uid");
  assert.equal(query.direction, "asc");
  assert.equal(query.page, 1);
  assert.equal(query.pageSize, 25);
});

test("filters by search, activity and group before stable server pagination", () => {
  const query = normalizeFreeIpaUserQuery(new URLSearchParams({
    q: "devops",
    status: "active",
    group: "devops",
    sort: "name",
    direction: "desc",
    page: "1",
    pageSize: "10",
  }));
  const result = queryFreeIpaUsers(users, query);
  assert.deepEqual(result.users.map((user) => user.uid), ["bivanova", "zvolkov"]);
  assert.deepEqual(result.filters.availableGroups, ["devops", "security", "vpn"]);
  assert.deepEqual(result.summary, { total: 4, active: 3, disabled: 1, filtered: 2 });
  assert.deepEqual(result.pagination, { page: 1, pageSize: 10, total: 2, totalPages: 1, from: 1, to: 2 });
});

test("clamps an out-of-range page and sorts numeric group counts", () => {
  const query = normalizeFreeIpaUserQuery(new URLSearchParams({ sort: "groups", direction: "desc", page: "99", pageSize: "10" }));
  const result = queryFreeIpaUsers(users, query);
  assert.equal(result.pagination.page, 1);
  assert.deepEqual(result.users.map((user) => user.uid), ["zvolkov", "asmirnov", "bivanova", "cpetrov"]);
});

test("extends the users API only when query parameters are present", async () => {
  const originalFetch = globalThis.fetch;
  const methods = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.pathname.endsWith("/login_password")) return new Response("ok", { headers: { "set-cookie": "ipa_session=token; Path=/ipa" } });
    const payload = JSON.parse(String(init.body));
    methods.push(payload.method);
    return Response.json({ result: { result: [
      { uid: ["zvolkov"], cn: ["Волков Захар"], mail: ["z@example.test"], memberof_group: ["devops", "vpn"] },
      { uid: ["asmirnov"], cn: ["Смирнов Алексей"], mail: ["a@example.test"], nsaccountlock: ["TRUE"], memberof_group: ["security"] },
      { uid: ["bivanova"], cn: ["Иванова Борислава"], mail: ["b@example.test"], memberof_group: ["devops"] },
    ] }, error: null });
  };

  const env = { IPA_URL: "https://ipa.example.test", IPA_USERNAME: "reader", IPA_PASSWORD: "secret" };
  try {
    const response = await worker.fetch(new Request("https://dashboard.test/api/integrations/users?q=devops&status=active&group=devops&sort=name&direction=asc&page=1&pageSize=10"), env, {});
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.mode, "live");
    assert.deepEqual(body.users.map((user) => user.uid), ["zvolkov", "bivanova"]);
    assert.equal(body.pagination.total, 2);
    assert.equal(body.summary.total, 3);
    assert.deepEqual(body.filters.availableGroups, ["devops", "security", "vpn"]);
    assert.deepEqual(methods, ["user_find"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("user browser keeps mutations in existing handlers and exposes server query controls", () => {
  const component = fs.readFileSync(new URL("../app/FreeIpaUserBrowser.tsx", import.meta.url), "utf8");
  const wrapper = fs.readFileSync(new URL("../worker/freeipa-user-query-entry.ts", import.meta.url), "utf8");
  const layout = fs.readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
  const vite = fs.readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");

  for (const name of ["q", "status", "group", "sort", "direction", "page", "pageSize"]) {
    assert.match(component, new RegExp(`${name}:`), name);
  }
  assert.match(component, /legacyUserButton/);
  assert.match(component, /clickLegacyCreate/);
  assert.match(component, /legacyCreateButton/);
  assert.match(component, /canWrite \?/);
  assert.match(component, /canWrite &&/);
  assert.match(component, /Редактировать/);
  assert.doesNotMatch(component, /api\/integrations\/freeipa\/actions/);
  assert.match(wrapper, /normalizeFreeIpaUserQuery/);
  assert.match(wrapper, /queryFreeIpaUsers/);
  assert.match(layout, /<FreeIpaUserBrowser \/>/);
  assert.match(vite, /worker\/freeipa-user-query-entry\.ts/);
});
