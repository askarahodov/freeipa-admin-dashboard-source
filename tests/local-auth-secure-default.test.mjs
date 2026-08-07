import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validateIdentityStartup } from "../scripts/identity-startup-policy.mjs";

const envExample = await readFile(new URL("../.env.example", import.meta.url), "utf8");
const startup = await readFile(new URL("../scripts/start-worker.mjs", import.meta.url), "utf8");
const dockerfile = await readFile(new URL("../Dockerfile", import.meta.url), "utf8");

async function readDevExample() {
  return readFile(new URL("../.env.dev.example", import.meta.url), "utf8");
}

test("production env example defaults to local authentication with viewer fallback", () => {
  assert.match(envExample, /^PORTAL_IDENTITY_MODE=local$/mu);
  assert.match(envExample, /^PORTAL_DEFAULT_ROLE=viewer$/mu);
  assert.doesNotMatch(envExample, /^PORTAL_IDENTITY_MODE=static$/mu);
  assert.doesNotMatch(envExample, /^PORTAL_DEFAULT_ROLE=admin$/mu);
});

test("production env example documents bootstrap administrator variables", () => {
  assert.match(envExample, /^PORTAL_BOOTSTRAP_ADMIN_USERNAME=admin$/mu);
  assert.match(envExample, /^PORTAL_BOOTSTRAP_ADMIN_PASSWORD=replace-with-a-strong-password-at-least-12-characters$/mu);
  assert.match(envExample, /^PORTAL_BOOTSTRAP_ADMIN_NAME=/mu);
});

test("local startup fails closed when bootstrap credentials are missing or placeholders", () => {
  for (const env of [
    { PORTAL_IDENTITY_MODE: "local" },
    { PORTAL_IDENTITY_MODE: "local", PORTAL_BOOTSTRAP_ADMIN_USERNAME: "admin" },
    {
      PORTAL_IDENTITY_MODE: "local",
      PORTAL_BOOTSTRAP_ADMIN_USERNAME: "admin",
      PORTAL_BOOTSTRAP_ADMIN_PASSWORD: "replace-with-a-strong-password-at-least-12-characters",
    },
  ]) {
    assert.throws(() => validateIdentityStartup(env), /bootstrap administrator/i);
  }
});

test("local startup accepts explicit non-placeholder bootstrap credentials", () => {
  assert.deepEqual(validateIdentityStartup({
    PORTAL_IDENTITY_MODE: "local",
    PORTAL_DEFAULT_ROLE: "viewer",
    PORTAL_BOOTSTRAP_ADMIN_USERNAME: "admin",
    PORTAL_BOOTSTRAP_ADMIN_PASSWORD: "correct-horse-battery-staple",
  }), { mode: "local", profile: "production", warnings: [] });
});

test("static identity is isolated behind an explicit development profile", async () => {
  const devExample = await readDevExample();
  assert.match(devExample, /^PORTAL_RUNTIME_PROFILE=development$/mu);
  assert.match(devExample, /^PORTAL_IDENTITY_MODE=static$/mu);
  assert.match(devExample, /^PORTAL_DEFAULT_ROLE=admin$/mu);
  assert.throws(() => validateIdentityStartup({
    PORTAL_IDENTITY_MODE: "static",
    PORTAL_DEFAULT_ROLE: "admin",
  }), /development-only/i);
  assert.equal(validateIdentityStartup({
    PORTAL_RUNTIME_PROFILE: "development",
    PORTAL_IDENTITY_MODE: "static",
    PORTAL_DEFAULT_ROLE: "admin",
  }).warnings.length, 1);
});

test("startup applies identity policy before creating the Gateway", () => {
  const validation = startup.indexOf("validateIdentityStartup(process.env)");
  const gateway = startup.indexOf("const gateway = createFreeIpaGateway");
  assert.notEqual(validation, -1);
  assert.notEqual(gateway, -1);
  assert.ok(validation < gateway, "identity startup policy must run before Gateway startup");
});

test("runtime image includes the identity startup policy module", () => {
  assert.match(dockerfile, /identity-startup-policy\.mjs/u);
});
