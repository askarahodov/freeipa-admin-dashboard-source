import assert from "node:assert/strict";
import test from "node:test";

import { normalizeFreeIpaUserQuery } from "../freeipa-user-query.ts";

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
