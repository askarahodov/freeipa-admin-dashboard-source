import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createExecutionContext,
  createStaticAssetsFetcher,
} from "../scripts/node-runtime-http.mjs";

test("execution context drains waitUntil work", async () => {
  const ctx = createExecutionContext();
  let completed = false;

  ctx.waitUntil(Promise.resolve().then(() => {
    completed = true;
  }));

  await ctx.drain();
  assert.equal(completed, true);
});

test("execution context ignores passThroughOnException without throwing", () => {
  const ctx = createExecutionContext();
  assert.doesNotThrow(() => ctx.passThroughOnException());
});

test("static asset fetcher serves immutable files with content type", async () => {
  const root = await mkdtemp(join(tmpdir(), "portal-assets-"));
  await mkdir(join(root, "assets"));
  await writeFile(join(root, "assets", "app.js"), "console.log('ok');\n", "utf8");

  const assets = createStaticAssetsFetcher(root);
  const response = await assets.fetch(new Request("http://portal/assets/app.js"));

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /javascript/u);
  assert.match(response.headers.get("cache-control") ?? "", /public/u);
  assert.equal(await response.text(), "console.log('ok');\n");
});

test("static asset fetcher rejects traversal and missing files", async () => {
  const root = await mkdtemp(join(tmpdir(), "portal-assets-"));
  await writeFile(join(root, "index.html"), "safe", "utf8");
  const assets = createStaticAssetsFetcher(root);

  const traversal = await assets.fetch(new Request("http://portal/%2e%2e/%2e%2e/etc/passwd"));
  assert.equal(traversal.status, 404);

  const missing = await assets.fetch(new Request("http://portal/missing.js"));
  assert.equal(missing.status, 404);
});
