import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const entry = await readFile(new URL("../../worker/local-secure-entry.ts", import.meta.url), "utf8");

test("local admin boundary uses the canonical request-context adapter", () => {
  assert.match(entry, /localSessionRequestContext/u);
  assert.match(entry, /requestContext\.correlationId/u);
  assert.match(entry, /requestContext\.identity/u);
  assert.match(entry, /requestContext\.role/u);
  assert.match(entry, /requestContext\.groups/u);
});
