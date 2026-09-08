import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const script = path.resolve("scripts/local-auth-acceptance.mjs");

function run(extraEnv = {}) {
  return spawnSync(process.execPath, [script], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      PORTAL_TEST_BASE_URL: "http://127.0.0.1:1",
      PORTAL_TEST_CONFIRM: "",
      PORTAL_TEST_ADMIN_USERNAME: "",
      PORTAL_TEST_ADMIN_PASSWORD: "",
      ...extraEnv,
    },
  });
}

test("refuses to mutate the local user database without explicit confirmation", () => {
  const result = run({
    PORTAL_TEST_ADMIN_USERNAME: "admin",
    PORTAL_TEST_ADMIN_PASSWORD: "not-used-password",
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /PORTAL_TEST_CONFIRM=YES/);
  assert.doesNotMatch(result.stderr, /not-used-password/);
});

test("requires administrator credentials before making network calls", () => {
  const result = run({ PORTAL_TEST_CONFIRM: "YES" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /PORTAL_TEST_ADMIN_USERNAME/);
  assert.doesNotMatch(result.stderr, /ECONNREFUSED|fetch failed/i);
});

test("rejects non-http target URLs before making network calls", () => {
  const result = run({
    PORTAL_TEST_CONFIRM: "YES",
    PORTAL_TEST_ADMIN_USERNAME: "admin",
    PORTAL_TEST_ADMIN_PASSWORD: "not-used-password",
    PORTAL_TEST_BASE_URL: "file:///tmp/portal",
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /http:\/\/ or https:\/\//);
  assert.doesNotMatch(result.stderr, /not-used-password/);
});

test("treats session cookies as secrets and logs only safe login details", () => {
  const source = fs.readFileSync(script, "utf8");
  assert.match(source, /secrets\.add\(cookie\)/);
  assert.match(source, /stepResult\(await login\(adminUsername, adminPassword\), "authenticated"\)/);
  assert.match(source, /stepResult\(await login\(viewer\.username, viewerPassword\), "authenticated"\)/);
  assert.doesNotMatch(source, /adminCookie\s*=\s*await step\([^\n]+login\(adminUsername, adminPassword\)\)\);/);
});