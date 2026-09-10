import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);

async function readJson(path) {
  return JSON.parse(await readFile(new URL(path, root), "utf8"));
}

async function readText(path) {
  return readFile(new URL(path, root), "utf8");
}

test("npm launcher names separate production from development runtimes", async () => {
  const pkg = await readJson("package.json");

  assert.equal(pkg.scripts.start, "npm run start:production");
  assert.equal(
    pkg.scripts["start:production"],
    "node --experimental-strip-types scripts/start-production.mjs",
  );
  assert.equal(
    pkg.scripts["start:vinext:dev"],
    "WRANGLER_LOG_PATH=.wrangler/wrangler.log vinext start",
  );
  assert.equal(pkg.scripts["start:worker:dev"], "node scripts/start-worker.mjs");
  assert.equal(pkg.scripts["start:docker"], "node scripts/start-docker-compat.mjs");

  assert.doesNotMatch(pkg.scripts.start, /vinext|wrangler|start-worker/u);
  assert.doesNotMatch(pkg.scripts["start:production"], /vinext|wrangler|start-worker/u);
});

test("production image and npm production launcher use the same canonical entrypoint", async () => {
  const dockerfile = await readText("Dockerfile");
  const pkg = await readJson("package.json");

  assert.match(
    dockerfile,
    /CMD \["node", "--experimental-strip-types", "scripts\/start-production\.mjs"\]/u,
  );
  assert.match(pkg.scripts["start:production"], /scripts\/start-production\.mjs/u);
});

test("legacy start:docker compatibility path fails loud about development-only semantics", async () => {
  const source = await readText("scripts/start-docker-compat.mjs");

  assert.match(source, /legacy development compatibility command/u);
  assert.match(source, /not the production Docker entrypoint/u);
  assert.match(source, /start:worker:dev/u);
  assert.match(source, /start-worker\.mjs/u);
});
