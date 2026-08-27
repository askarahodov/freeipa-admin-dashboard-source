import assert from "node:assert/strict";
import test from "node:test";

import { normalizeFreeIpaUserQuery, queryFreeIpaUsers } from "../src/freeipa/freeipa-user-query.ts";

const users = [
  { uid: "zvolkov", name: "Волков Захар", firstName: "Захар", lastName: "Волков", email: "z@example.test", active: true, groups: 2, groupNames: ["devops", "vpn"] },
  { uid: "asmirnov", name: "Смирнов Алексей", firstName: "Алексей", lastName: "Смирнов", email: "a@example.test", active: false, groups: 1, groupNames: ["security"] },
  { uid: "bivanova", name: "Иванова Борислава", firstName: "Борислава", lastName: "Иванова", email: "b@example.test", active: true, groups: 1, groupNames: ["devops"] },
  { uid: "cpetrov", name: "Петров Сергей", firstName: "Сергей", lastName: "Петров", email: "c@example.test", active: true, groups: 0, groupNames: [] },
];

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
