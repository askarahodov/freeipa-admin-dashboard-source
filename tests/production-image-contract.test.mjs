import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dockerfile = await readFile(new URL("../Dockerfile", import.meta.url), "utf8");
const runtimeStage = dockerfile.slice(dockerfile.indexOf("FROM node:22-bookworm-slim AS runtime"));

test("production runtime image uses the canonical Node entrypoint", () => {
  assert.match(runtimeStage, /CMD \["node", "--experimental-strip-types", "scripts\/start-production\.mjs"\]/u);
  assert.doesNotMatch(runtimeStage, /start-worker\.mjs/u);
  assert.doesNotMatch(runtimeStage, /wrangler\.js|wrangler dev|--persist-to|\.wrangler/u);
  assert.match(runtimeStage, /\/app\/runtime/gu);
  assert.match(runtimeStage, /\/app\/db/gu);
  assert.match(runtimeStage, /PORTAL_DATA_DIR=\/data/u);
});
