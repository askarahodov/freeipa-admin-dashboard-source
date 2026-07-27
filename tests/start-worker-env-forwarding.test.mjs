import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const requiredKeys = [
  "PORTAL_IDENTITY_MODE",
  "PORTAL_STATIC_IDENTITY",
  "PORTAL_STATIC_NAME",
  "PORTAL_DEFAULT_ROLE",
  "PORTAL_RBAC_JSON",
  "PORTAL_BOOTSTRAP_ADMIN_USERNAME",
  "PORTAL_BOOTSTRAP_ADMIN_PASSWORD",
  "PORTAL_BOOTSTRAP_ADMIN_NAME",
  "PORTAL_SESSION_TTL_HOURS",
];

test("Docker Worker startup forwards all local authentication settings", async () => {
  const source = await readFile(new URL("../scripts/start-worker.mjs", import.meta.url), "utf8");

  for (const key of requiredKeys) {
    assert.match(source, new RegExp(`\\"${key}\\"`), `${key} must be forwarded to the Wrangler env file`);
  }
});
