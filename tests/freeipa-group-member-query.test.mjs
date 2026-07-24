import assert from "node:assert/strict";
import test from "node:test";

import { normalizeFreeIpaGroupMemberQuery, queryFreeIpaGroupMembers } from "../freeipa-group-member-query.ts";

const group = {
  name: "devops",
  description: "Infrastructure",
  members: 5,
  memberUids: ["zvolkov", "asmirnov", "ghost", "bivanova", "carol"],
  type: "POSIX",
};

const users = [
  { uid: "zvolkov", name: "Волков Захар", firstName: "Захар", lastName: "Волков", email: "z@example.test", active: true, groups: 1, groupNames: ["devops"] },
  { uid: "asmirnov", name: "Смирнов Алексей", firstName: "Алексей", lastName: "Смирнов", email: "a@example.test", active: false, groups: 1, groupNames: ["devops"] },
  { uid: "bivanova", name: "Иванова Борислава", firstName: "Борислава", lastName: "Иванова", email: "b@example.test", active: true, groups: 1, groupNames: ["devops"] },
  { uid: "carol", name: "Carol User", firstName: "Carol", lastName: "User", email: "carol@example.test", active: true, groups: 1, groupNames: ["devops"] },
];

test("normalizes member query parameters", () => {
  const query = normalizeFreeIpaGroupMemberQuery(new URLSearchParams("q=alice&status=unknown&sort=status&direction=desc&page=4&pageSize=50"));
  assert.deepEqual(query, { q: "alice", status: "unknown", sort: "status", direction: "desc", page: 4, pageSize: 50 });

  const fallback = normalizeFreeIpaGroupMemberQuery(new URLSearchParams("status=broken&sort=broken&direction=broken&page=-1&pageSize=17"));
  assert.deepEqual(fallback, { q: "", status: "all", sort: "uid", direction: "asc", page: 1, pageSize: 25 });
});

test("filters, sorts and paginates group members", () => {
  const result = queryFreeIpaGroupMembers(group, users, {
    q: "example.test",
    status: "active",
    sort: "uid",
    direction: "asc",
    page: 2,
    pageSize: 2,
  });

  assert.deepEqual(result.members.map((member) => member.uid), ["zvolkov"]);
  assert.deepEqual(result.pagination, { page: 2, pageSize: 2, total: 3, totalPages: 2, from: 3, to: 3 });
  assert.deepEqual(result.summary, { total: 5, active: 3, disabled: 1, unknown: 1, filtered: 3 });
  assert.deepEqual(result.group.memberUids, group.memberUids, "FreeIPA order must be preserved for legacy mutation mapping");
});

test("keeps missing user records as unknown members", () => {
  const result = queryFreeIpaGroupMembers(group, users, {
    q: "ghost",
    status: "unknown",
    sort: "uid",
    direction: "asc",
    page: 1,
    pageSize: 10,
  });

  assert.deepEqual(result.members, [{ uid: "ghost", name: "ghost", email: "", active: null }]);
  assert.equal(result.pagination.total, 1);
  assert.equal(result.summary.unknown, 1);
});
