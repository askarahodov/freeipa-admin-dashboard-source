import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { localSessionCookie } from "../../src/auth/local-auth.ts";
import { resolveTrustedRequestProtocol } from "../../scripts/trusted-proxy-policy.mjs";
import { startNodeWorkerHost } from "../../scripts/node-worker-host.mjs";

const trustedEnv = {
  PORTAL_CLIENT_IP_SOURCE: "trusted-proxy",
  PORTAL_TRUSTED_PROXY_SECRET: "test-proxy-secret",
};

function headers(values = {}) {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key.toLowerCase(), value]));
}

test("trusted proxy scheme requires configured mode, loopback source and secret", () => {
  assert.equal(resolveTrustedRequestProtocol({
    headers: headers({ "x-forwarded-proto": "https", "x-portal-proxy-secret": "test-proxy-secret" }),
    remoteAddress: "127.0.0.1",
    env: {},
  }), "http");

  assert.equal(resolveTrustedRequestProtocol({
    headers: headers({ "x-forwarded-proto": "https", "x-portal-proxy-secret": "test-proxy-secret" }),
    remoteAddress: "10.0.0.12",
    env: trustedEnv,
  }), "http");

  assert.equal(resolveTrustedRequestProtocol({
    headers: headers({ "x-forwarded-proto": "https", "x-portal-proxy-secret": "wrong" }),
    remoteAddress: "127.0.0.1",
    env: trustedEnv,
  }), "http");
});

test("trusted proxy scheme accepts only a single supported forwarded protocol", () => {
  const base = {
    remoteAddress: "::ffff:127.0.0.1",
    env: trustedEnv,
  };
  assert.equal(resolveTrustedRequestProtocol({ ...base, headers: headers({ "x-forwarded-proto": "https", "x-portal-proxy-secret": "test-proxy-secret" }) }), "https");
  assert.equal(resolveTrustedRequestProtocol({ ...base, headers: headers({ "x-forwarded-proto": "http", "x-portal-proxy-secret": "test-proxy-secret" }) }), "http");
  assert.equal(resolveTrustedRequestProtocol({ ...base, headers: headers({ "x-forwarded-proto": "https,http", "x-portal-proxy-secret": "test-proxy-secret" }) }), "http");
  assert.equal(resolveTrustedRequestProtocol({ ...base, headers: headers({ "x-forwarded-proto": "ftp", "x-portal-proxy-secret": "test-proxy-secret" }) }), "http");
});

test("Node host produces a Secure local session cookie only for the authenticated loopback proxy", async () => {
  const root = await mkdtemp(join(tmpdir(), "portal-trusted-proxy-"));
  const worker = {
    async fetch(request) {
      return new Response(new URL(request.url).protocol, {
        headers: { "set-cookie": localSessionCookie(request, "test-token", 300) },
      });
    },
  };

  const runtime = await startNodeWorkerHost({
    worker,
    assetsRoot: join(root, "assets"),
    env: trustedEnv,
    host: "127.0.0.1",
    port: 0,
  });

  try {
    const trusted = await fetch(`http://127.0.0.1:${runtime.address.port}/login`, {
      headers: {
        "x-forwarded-proto": "https",
        "x-portal-proxy-secret": "test-proxy-secret",
      },
    });
    assert.equal(await trusted.text(), "https:");
    const trustedCookie = trusted.headers.get("set-cookie") ?? "";
    assert.match(trustedCookie, /; HttpOnly; SameSite=Strict;/u);
    assert.match(trustedCookie, /; Secure/u);

    const forged = await fetch(`http://127.0.0.1:${runtime.address.port}/login`, {
      headers: { "x-forwarded-proto": "https" },
    });
    assert.equal(await forged.text(), "http:");
    const forgedCookie = forged.headers.get("set-cookie") ?? "";
    assert.match(forgedCookie, /; HttpOnly; SameSite=Strict;/u);
    assert.doesNotMatch(forgedCookie, /; Secure/u);
  } finally {
    await runtime.close();
  }
});
