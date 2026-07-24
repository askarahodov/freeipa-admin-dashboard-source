import assert from "node:assert/strict";
import test from "node:test";

import { normalizeFreeIpaUserQuery, queryFreeIpaUsers } from "../freeipa-user-query.ts";

const users = [
  { uid: "zvolkov", name: "Волков Захар", firstName: "Захар", lastName: "Волков", email: "z@example.test", active: true, groups: 2, groupNames: ["devops", "vpn"] },
  { uid: "asmirnov", name: "Смирнов Алексей", firstName: "Алексей", lastName: "Смирнов", email: "a@example.test", active: false, groups: 1, groupNames: ["security"] },
  { uid: "bivanova", name: "Иванова Борислава", firstName: "Борислава", lastName: "Иванова", email: "b@example.test", active: true, groups: 1, groupNames: ["devops"] },
  { uid: "cpetrov", name: "Петров Сергей", firstName: "Сергей", lastName: "Петров", email: "c@example.test", active: true, groups: 0, groupNames: [] },
];

test("clamps an out-of-range page and keeps equal sort values stable by uid", () => {
  const query = normalizeFreeIpaUserQuery(new URLSearchParams({ sort: "groups", direction: "desc", page: "99", pageSize: "10" }));
  const result = queryFreeIpaUsers(users, query);

  assert.equal(result.pagination.page, 1);
  assert.equal(result.users[0].groups, 2);
  assert.equal(result.users.at(-1).groups, 0);
  assert.deepEqual(result.users.filter((user) => user.groups === 1).map((user) => user.uid), ["asmirnov", "bivanova"]);
});
