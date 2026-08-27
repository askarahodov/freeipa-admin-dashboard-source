import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const compose = await readFile(new URL("../compose.yaml", import.meta.url), "utf8");
const dockerfile = await readFile(new URL("../Dockerfile", import.meta.url), "utf8");
const sqliteStore = await readFile(new URL("../runtime/sqlite-runtime-store.mjs", import.meta.url), "utf8");

test("Compose persists the canonical production SQLite data directory", () => {
  assert.match(dockerfile, /PORTAL_DATA_DIR=\/data/u);
  assert.match(sqliteStore, /String\(value \|\| "\/data"\)/u);
  assert.match(sqliteStore, /return resolve\(dataDirectory, "portal\.sqlite"\)/u);
  assert.match(compose, /dashboard-data:\/data/u);
  assert.doesNotMatch(compose, /dashboard-data:\/app\/\.wrangler/u);
});

test("dashboard and recovery profiles share the same named volume", () => {
  const mounts = [...compose.matchAll(/dashboard-data:([^\s]+)/gu)].map((match) => match[1]);
  assert.deepEqual(mounts, ["/data", "/portal-data"]);
});
