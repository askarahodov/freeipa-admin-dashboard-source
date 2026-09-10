import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { startNodeWorkerHost } from "../../scripts/node-worker-host.mjs";

const expectedHeaders = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
};

function assertBaselineHeaders(response) {
  for (const [name, value] of Object.entries(expectedHeaders)) {
    assert.equal(response.headers.get(name), value, `${name} must be enforced at the Node host boundary`);
  }
}

async function withRuntime(worker, callback) {
  const root = await mkdtemp(join(tmpdir(), "portal-http-security-"));
  const assetsRoot = join(root, "assets");

  const runtime = await startNodeWorkerHost({ worker, assetsRoot, host: "127.0.0.1", port: 0 });
  try {
    await callback(runtime);
  } finally {
    await runtime.close();
  }
}

test("Node host enforces baseline headers over weaker Worker response values", async () => {
  await withRuntime({
    async fetch() {
      return new Response(JSON.stringify({ ok: true }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "x-content-type-options": "off",
          "x-frame-options": "SAMEORIGIN",
          "referrer-policy": "unsafe-url",
          "permissions-policy": "camera=*",
        },
      });
    },
  }, async (runtime) => {
    const response = await fetch(`http://127.0.0.1:${runtime.address.port}/api/example`);
    assert.equal(response.status, 200);
    assertBaselineHeaders(response);
  });
});

test("Node host preserves the existing diagnostics capability restrictions", async () => {
  await withRuntime({
    async fetch() {
      return new Response("diagnostics", {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "permissions-policy": "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
        },
      });
    },
  }, async (runtime) => {
    const response = await fetch(`http://127.0.0.1:${runtime.address.port}/diagnostics/health`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("permissions-policy"), expectedHeaders["permissions-policy"]);
  });
});

test("Node host applies baseline headers to static assets", async () => {
  const root = await mkdtemp(join(tmpdir(), "portal-http-security-assets-"));
  const assetsRoot = join(root, "assets");
  await mkdir(assetsRoot);
  await writeFile(join(assetsRoot, "app.js"), "console.log('ok');");

  const runtime = await startNodeWorkerHost({
    worker: { async fetch() { return new Response("fallback", { status: 404 }); } },
    assetsRoot,
    host: "127.0.0.1",
    port: 0,
  });
  try {
    const response = await fetch(`http://127.0.0.1:${runtime.address.port}/app.js`);
    assert.equal(response.status, 200);
    assertBaselineHeaders(response);
  } finally {
    await runtime.close();
  }
});

test("Node host applies baseline headers to host-level failures", async () => {
  await withRuntime({
    async fetch() {
      throw new Error("synthetic runtime failure");
    },
  }, async (runtime) => {
    const originalConsoleError = console.error;
    console.error = () => {};
    try {
      const response = await fetch(`http://127.0.0.1:${runtime.address.port}/api/fail`);
      assert.equal(response.status, 500);
      assertBaselineHeaders(response);
    } finally {
      console.error = originalConsoleError;
    }
  });
});
