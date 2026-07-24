import assert from "node:assert/strict";
import test from "node:test";

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
