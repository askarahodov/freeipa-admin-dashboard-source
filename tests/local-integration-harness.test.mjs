import assert from "node:assert/strict";
import test from "node:test";

import { assertMutationAllowed, createTestNames, parseBoolean, parseDotEnv, parseJson, redact } from "../scripts/local-integration-smoke.mjs";

test("parses local test environment values without executing shell syntax", () => {
  const parsed = parseDotEnv(`
# comment
LOCAL_TEST_MUTATIONS=false
LOCAL_TEST_XYOPS_VALUES_JSON={"database":"billing"}
QUOTED="value with spaces"
`);
  assert.equal(parsed.LOCAL_TEST_MUTATIONS, "false");
  assert.deepEqual(parseJson(parsed.LOCAL_TEST_XYOPS_VALUES_JSON, {}), { database: "billing" });
  assert.equal(parsed.QUOTED, "value with spaces");
  assert.equal(parseBoolean(parsed.LOCAL_TEST_MUTATIONS), false);
});

test("requires explicit double confirmation before real mutations", () => {
  assert.throws(() => assertMutationAllowed({ LOCAL_TEST_MUTATIONS: "false", LOCAL_TEST_CONFIRM_MUTATIONS: "YES", LOCAL_TEST_PREFIX: "portal-test" }, "FreeIPA"));
  assert.throws(() => assertMutationAllowed({ LOCAL_TEST_MUTATIONS: "true", LOCAL_TEST_CONFIRM_MUTATIONS: "NO", LOCAL_TEST_PREFIX: "portal-test" }, "FreeIPA"));
  assert.throws(() => assertMutationAllowed({ LOCAL_TEST_MUTATIONS: "true", LOCAL_TEST_CONFIRM_MUTATIONS: "YES", LOCAL_TEST_PREFIX: "unsafe" }, "FreeIPA"));
  assert.doesNotThrow(() => assertMutationAllowed({ LOCAL_TEST_MUTATIONS: "true", LOCAL_TEST_CONFIRM_MUTATIONS: "YES", LOCAL_TEST_PREFIX: "portal-test" }, "FreeIPA"));
});

test("generates cleanup-safe FreeIPA object names", () => {
  const names = createTestNames("portal-test");
  assert.match(names.username, /^portaltest[a-z0-9]+$/);
  assert.match(names.group, /^portal-test-[a-z0-9]+$/);
  assert.ok(names.username.length <= 30);
  assert.ok(names.group.length <= 48);
  assert.throws(() => createTestNames("production"));
});

test("removes secrets recursively from generated reports", () => {
  assert.deepEqual(redact({ token: "x", nested: { password: "y", status: "ok" }, items: [{ apiKey: "z", id: 1 }] }), {
    nested: { status: "ok" },
    items: [{ id: 1 }],
  });
});
