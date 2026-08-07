import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const hostSource = await readFile(new URL("../scripts/node-worker-host.mjs", import.meta.url), "utf8");

test("candidate host loads the immutable Worker artifact directly", () => {
  assert.match(hostSource, /dist\/server\/index\.js/u);
  assert.match(hostSource, /worker\.fetch/u);
  assert.doesNotMatch(hostSource, /wrangler/u);
  assert.doesNotMatch(hostSource, /\bvite\b/u);
  assert.doesNotMatch(hostSource, /\bdev\b/u);
});

test("candidate host owns an ordinary Node HTTP lifecycle", () => {
  assert.match(hostSource, /node:http/u);
  assert.match(hostSource, /SIGTERM/u);
  assert.match(hostSource, /SIGINT/u);
  assert.match(hostSource, /server\.close/u);
});
