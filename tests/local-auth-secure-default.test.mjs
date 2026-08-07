import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { bootstrapLocalAdmin } from "../local-auth.ts";

const envExample = await readFile(new URL("../.env.example", import.meta.url), "utf8");

function emptyUsersDb() {
  return {
    prepare(sql) {
      assert.match(sql, /SELECT COUNT\(\*\) AS count FROM portal_users/u);
      return {
        async first() {
          return { count: 0 };
        },
      };
    },
  };
}

test("production env example defaults to local authentication with viewer fallback", () => {
  assert.match(envExample, /^PORTAL_IDENTITY_MODE=local$/mu);
  assert.match(envExample, /^PORTAL_DEFAULT_ROLE=viewer$/mu);
  assert.doesNotMatch(envExample, /^PORTAL_IDENTITY_MODE=static$/mu);
  assert.doesNotMatch(envExample, /^PORTAL_DEFAULT_ROLE=admin$/mu);
});

test("production env example documents bootstrap administrator variables", () => {
  assert.match(envExample, /^PORTAL_BOOTSTRAP_ADMIN_USERNAME=/mu);
  assert.match(envExample, /^PORTAL_BOOTSTRAP_ADMIN_PASSWORD=/mu);
  assert.match(envExample, /^PORTAL_BOOTSTRAP_ADMIN_NAME=/mu);
});

test("empty local-auth database fails closed when bootstrap credentials are missing", async () => {
  await assert.rejects(
    bootstrapLocalAdmin({ DB: emptyUsersDb() }),
    /bootstrap administrator credentials are required/i,
  );
});
