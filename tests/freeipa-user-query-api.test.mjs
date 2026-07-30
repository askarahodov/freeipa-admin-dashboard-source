import assert from "node:assert/strict";
import test from "node:test";

import worker from "../dist/server/index.js";
import { markSchemaTestBypass } from "../worker/schema-migrations-boundary.ts";

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

  const env = markSchemaTestBypass({ IPA_URL: "https://ipa.example.test", IPA_USERNAME: "reader", IPA_PASSWORD: "secret" });
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
