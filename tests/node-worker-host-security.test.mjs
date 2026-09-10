import assert from "node:assert/strict";
import test from "node:test";

import { resolveRuntimeOrigin } from "../scripts/node-worker-host.mjs";
import { localSessionCookie } from "../src/auth/local-auth.ts";

function request(headers = {}) {
  return { headers: { host: "127.0.0.1:3001", ...headers } };
}

const trustedEnv = {
  PORTAL_CLIENT_IP_SOURCE: "trusted-proxy",
  PORTAL_TRUSTED_PROXY_SECRET: "test-proxy-proof",
};

test("forged forwarded origin is ignored without trusted proxy proof", () => {
  const origin = resolveRuntimeOrigin(request({
    "x-forwarded-proto": "https",
    "x-forwarded-host": "portal.example.test",
  }), "127.0.0.1", 3001, trustedEnv);

  assert.equal(origin, "http://127.0.0.1:3001");
  assert.doesNotMatch(localSessionCookie(new Request(`${origin}/login`), "token", 60), /; Secure/);
});

test("wrong proxy proof cannot influence origin", () => {
  const origin = resolveRuntimeOrigin(request({
    "x-forwarded-proto": "https",
    "x-forwarded-host": "portal.example.test",
    "x-portal-proxy-secret": "wrong-proof",
  }), "127.0.0.1", 3001, trustedEnv);

  assert.equal(origin, "http://127.0.0.1:3001");
});

test("trusted proxy proof enables validated forwarded HTTPS origin", () => {
  const origin = resolveRuntimeOrigin(request({
    "x-forwarded-proto": "https",
    "x-forwarded-host": "portal.example.test",
    "x-portal-proxy-secret": "test-proxy-proof",
  }), "127.0.0.1", 3001, trustedEnv);

  assert.equal(origin, "https://portal.example.test");
  const cookie = localSessionCookie(new Request(`${origin}/login`), "token", 60);
  assert.match(cookie, /; HttpOnly; SameSite=Strict;/);
  assert.match(cookie, /; Secure$/);
});

test("trusted proof fails closed for malformed forwarded origin", () => {
  for (const headers of [
    { "x-forwarded-proto": "https,http", "x-forwarded-host": "portal.example.test" },
    { "x-forwarded-proto": "https", "x-forwarded-host": "portal.example.test,attacker.example" },
    { "x-forwarded-proto": "ftp", "x-forwarded-host": "portal.example.test" },
  ]) {
    const origin = resolveRuntimeOrigin(request({
      ...headers,
      "x-portal-proxy-secret": "test-proxy-proof",
    }), "127.0.0.1", 3001, trustedEnv);
    assert.equal(origin, "http://127.0.0.1:3001");
  }
});

test("trusted forwarded origin is disabled unless trusted-proxy mode is explicit", () => {
  const origin = resolveRuntimeOrigin(request({
    "x-forwarded-proto": "https",
    "x-forwarded-host": "portal.example.test",
    "x-portal-proxy-secret": "test-proxy-proof",
  }), "127.0.0.1", 3001, {
    PORTAL_TRUSTED_PROXY_SECRET: "test-proxy-proof",
  });

  assert.equal(origin, "http://127.0.0.1:3001");
});
