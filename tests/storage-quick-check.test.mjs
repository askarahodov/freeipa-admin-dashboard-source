import assert from "node:assert/strict";
import test from "node:test";

import { inspectStorageQuickCheck } from "../storage-quick-check.ts";

function query(value) {
  const statements = [];
  return {
    statements,
    async first(sql) {
      statements.push(sql);
      if (value instanceof Error) throw value;
      return value;
    },
  };
}

test("shared quick check issues one fixed pragma and accepts only ok", async () => {
  const healthy = query({ quick_check: "  OK  " });
  assert.deepEqual(await inspectStorageQuickCheck(healthy), { state: "healthy" });
  assert.deepEqual(healthy.statements, ["PRAGMA quick_check(1)"]);

  const failed = query({ quick_check: "database path /var/lib/private.sqlite table portal_users corrupt" });
  const result = await inspectStorageQuickCheck(failed);
  assert.deepEqual(result, { state: "failed" });
  assert.equal(JSON.stringify(result).includes("private.sqlite"), false);
  assert.equal(JSON.stringify(result).includes("portal_users"), false);
});

test("shared quick check distinguishes unsupported from unavailable without raw errors", async () => {
  const unsupportedSecret = "no such pragma: quick_check /var/lib/secret.sqlite";
  const unsupported = await inspectStorageQuickCheck(query(new Error(unsupportedSecret)));
  assert.deepEqual(unsupported, { state: "unsupported" });
  assert.equal(JSON.stringify(unsupported).includes("secret.sqlite"), false);

  const unavailableSecret = "D1 connection failed bearer-token-sentinel";
  const unavailable = await inspectStorageQuickCheck(query(new Error(unavailableSecret)));
  assert.deepEqual(unavailable, { state: "unavailable" });
  assert.equal(JSON.stringify(unavailable).includes("bearer-token-sentinel"), false);
});

test("shared quick check treats missing or non-string first value as failed", async () => {
  assert.deepEqual(await inspectStorageQuickCheck(query(null)), { state: "failed" });
  assert.deepEqual(await inspectStorageQuickCheck(query({ quick_check: 1 })), { state: "failed" });
});
