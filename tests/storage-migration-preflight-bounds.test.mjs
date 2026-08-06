import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { handleStorageMigrationPreflightRequest } from "../worker/storage-migration-preflight-entry.ts";

const [entrySource, preflightSource, migrationSource] = await Promise.all([
  readFile(new URL("../worker/storage-migration-preflight-entry.ts", import.meta.url), "utf8"),
  readFile(new URL("../storage-migration-preflight.ts", import.meta.url), "utf8"),
  readFile(new URL("../db/portal-migrations.ts", import.meta.url), "utf8"),
]);

test("preflight cancels an oversized streaming body before evaluator work", async () => {
  let cancelled = false;
  let inspected = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(1025));
      controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  const request = new Request("https://portal.example/api/admin/storage/migrations/preflight", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    duplex: "half",
  });
  const response = await handleStorageMigrationPreflightRequest(request, {}, {
    access: () => ({ role: "admin", identity: "admin@example.test", groups: [] }),
    inspect: async () => {
      inspected = true;
      throw new Error("must not inspect");
    },
  });
  assert.equal(response.status, 413);
  assert.equal(cancelled, true);
  assert.equal(inspected, false);
});

test("preflight body parser and both schema inventories are explicitly bounded", () => {
  assert.equal(/request\.text\(\)/.test(entrySource), false);
  assert.match(entrySource, /request\.body\.getReader\(\)/);
  assert.match(entrySource, /reader\.cancel\(\)/);
  assert.match(preflightSource, /sqlite_master[\s\S]*LIMIT 1001/);
  assert.match(migrationSource, /sqlite_master[\s\S]*LIMIT 1001/);
  assert.match(preflightSource, /results\.length > 1000/);
  assert.match(migrationSource, /results\.length > 1000/);
});
