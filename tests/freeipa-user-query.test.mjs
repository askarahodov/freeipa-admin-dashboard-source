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
  assert.ok(query.q.length <= 160);
  assert.deepEqual(
    { status: query.status, group: query.group, sort: query.sort, direction: query.direction, page: query.page, pageSize: query.pageSize },
    { status: "all", group: "devops", sort: "uid", direction: "asc", page: 1, pageSize: 25 },
  );
});

test("filters by search, activity and group before server pagination", () => {
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
  assert.deepEqual(new Set(result.users.map((user) => user.uid)), new Set(["bivanova", "zvolkov"]));
  assert.deepEqual(result.filters.availableGroups, ["devops", "security", "vpn"]);
  assert.deepEqual(result.summary, { total: 4, active: 3, disabled: 1, filtered: 2 });
  assert.deepEqual(result.pagination, { page: 1, pageSize: 10, total: 2, totalPages: 1, from: 1, to: 2 });
});

test("clamps an out-of-range page and keeps equal sort values stable by uid", () => {
  const query = normalizeFreeIpaUserQuery(new URLSearchParams({ sort: "groups", direction: "desc", page: "99", pageSize: "10" }));
  const result = queryFreeIpaUsers(users, query);
  assert.equal(result.pagination.page, 1);
  assert.equal(result.users[0].groups, 2);
  assert.equal(result.users.at(-1).groups, 0);
  assert.deepEqual(result.users.filter((user) => user.groups === 1).map((user) => user.uid), ["asmirnov", "bivanova"]);
});

test("extends the users API with one normalized user_find call", async () => {
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
    assert.equal(body.users.length, 2);
    assert.equal(body.users.every((user) => user.active && user.groupNames.includes("devops")), true);
    assert.equal(body.pagination.total, 2);
    assert.equal(body.summary.total, 3);
    assert.deepEqual(new Set(body.filters.availableGroups), new Set(["devops", "security", "vpn"]));
    assert.deepEqual(methods, ["user_find"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("user browser reuses legacy mutations and exposes server query controls", () => {
  const component = fs.readFileSync(new URL("../app/FreeIpaUserBrowser.tsx", import.meta.url), "utf8");
  const wrapper = fs.readFileSync(new URL("../worker/freeipa-user-query-entry.ts", import.meta.url), "utf8");
  const layout = fs.readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
  const vite = fs.readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");

  for (const value of ["q:", "status:", "group:", "sort:", "direction:", "page:", "pageSize:"]) {
    assert.equal(component.includes(value), true, value);
  }
  for (const value of ["legacyUserButton", "clickLegacyCreate", "legacyCreateButton", "Только просмотр", "Редактировать"]) {
    assert.equal(component.includes(value), true, value);
  }
  assert.equal(component.includes("/api/integrations/freeipa/actions"), false);
  assert.equal(wrapper.includes("normalizeFreeIpaUserQuery"), true);
  assert.equal(wrapper.includes("queryFreeIpaUsers"), true);
  assert.equal(layout.includes("<FreeIpaUserBrowser />"), true);
  assert.equal(vite.includes("worker/freeipa-user-query-entry.ts"), true);
});
