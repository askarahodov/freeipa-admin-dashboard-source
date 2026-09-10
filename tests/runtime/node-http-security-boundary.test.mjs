import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { startNodeWorkerHost } from "../../scripts/node-worker-host.mjs";

async function withHost(env, worker, run) {
  const assetsRoot = await mkdtemp(join(tmpdir(), "portal-http-security-"));
  await writeFile(join(assetsRoot, "asset.txt"), "asset");
  const runtime = await startNodeWorkerHost({ host: "127.0.0.1", port: 0, assetsRoot, env, worker });
  try {
    await run(`http://127.0.0.1:${runtime.address.port}`);
  } finally {
    await runtime.close();
    await rm(assetsRoot, { recursive: true, force: true });
  }
}

function assertBaselineHeaders(response) {
  assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
}

test("Node boundary applies security headers to API responses and static assets", async () => {
  const worker = { fetch: async () => new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } }) };
  await withHost({}, worker, async (base) => {
    const api = await fetch(`${base}/api/example`);
    assertBaselineHeaders(api);
    assert.equal(api.headers.get("strict-transport-security"), null);

    const asset = await fetch(`${base}/asset.txt`);
    assertBaselineHeaders(asset);
    assert.equal(await asset.text(), "asset");
  });
});

test("HSTS is emitted only for authenticated trusted-proxy HTTPS", async () => {
  const env = {
    PORTAL_CLIENT_IP_SOURCE: "trusted-proxy",
    PORTAL_TRUSTED_PROXY_SECRET: "test-proxy-proof",
    PORTAL_HSTS_ENABLED: "true",
  };
  const worker = { fetch: async () => new Response("ok") };
  await withHost(env, worker, async (base) => {
    const forged = await fetch(base, { headers: { "x-forwarded-proto": "https" } });
    assert.equal(forged.headers.get("strict-transport-security"), null);

    const trusted = await fetch(base, { headers: {
      "x-forwarded-proto": "https",
      "x-portal-proxy-secret": "test-proxy-proof",
    } });
    assert.match(trusted.headers.get("strict-transport-security") ?? "", /^max-age=31536000/);
  });
});

test("Node-generated 500 responses retain the security baseline", async () => {
  const worker = { fetch: async () => { throw new Error("synthetic test failure"); } };
  await withHost({}, worker, async (base) => {
    const response = await fetch(`${base}/failure`);
    assert.equal(response.status, 500);
    assertBaselineHeaders(response);
    assert.deepEqual(await response.json(), { error: "runtime_request_failed" });
  });
});
