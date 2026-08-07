import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  loadWorkerArtifact,
  startNodeWorkerHost,
} from "../scripts/node-worker-host.mjs";

const hostSource = await readFile(new URL("../scripts/node-worker-host.mjs", import.meta.url), "utf8");

test("candidate host loads the immutable Worker artifact directly", () => {
  assert.match(hostSource, /dist\/server\/index\.js/u);
  assert.match(hostSource, /worker\.fetch/u);
  assert.doesNotMatch(hostSource, /wrangler/u);
  assert.doesNotMatch(hostSource, /\bvite\b/u);
  assert.doesNotMatch(hostSource, /\bdev\b/u);
});

test("candidate host owns an ordinary Node HTTP lifecycle", () => {
  assert.match(hostSource, /node:http/u);
  assert.match(hostSource, /SIGTERM/u);
  assert.match(hostSource, /SIGINT/u);
  assert.match(hostSource, /server\.close/u);
});

test("candidate host executes a Worker fetch handler over real HTTP", async () => {
  const root = await mkdtemp(join(tmpdir(), "portal-node-host-"));
  const artifactPath = join(root, "worker.mjs");
  const assetsRoot = join(root, "assets");
  await writeFile(artifactPath, `
    export default {
      async fetch(request, env, ctx) {
        ctx.waitUntil(Promise.resolve());
        return Response.json({ method: request.method, value: env.TEST_VALUE });
      }
    };
  `, "utf8");

  const runtime = await startNodeWorkerHost({
    artifactPath,
    assetsRoot,
    env: { TEST_VALUE: "candidate" },
    host: "127.0.0.1",
    port: 0,
  });

  try {
    assert.ok(runtime.address?.port);
    const response = await fetch(`http://127.0.0.1:${runtime.address.port}/health/live`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { method: "GET", value: "candidate" });
  } finally {
    await runtime.close();
  }
});

test("Worker artifact loader returns the validated default Worker exactly once per explicit load", async () => {
  const root = await mkdtemp(join(tmpdir(), "portal-worker-load-"));
  const artifactPath = join(root, "worker.mjs");
  await writeFile(artifactPath, `
    globalThis.__portalWorkerLoads = (globalThis.__portalWorkerLoads || 0) + 1;
    export default {
      async fetch() { return new Response("ok"); },
      async scheduled() {}
    };
  `, "utf8");

  globalThis.__portalWorkerLoads = 0;
  const worker = await loadWorkerArtifact(artifactPath);
  assert.equal(typeof worker.fetch, "function");
  assert.equal(typeof worker.scheduled, "function");
  assert.equal(globalThis.__portalWorkerLoads, 1);
});

test("candidate host accepts a preloaded Worker without importing another artifact", async () => {
  const root = await mkdtemp(join(tmpdir(), "portal-preloaded-worker-"));
  const missingArtifactPath = join(root, "must-not-be-imported.mjs");
  const worker = {
    async fetch(request, env) {
      return Response.json({ path: new URL(request.url).pathname, value: env.TEST_VALUE });
    },
    async scheduled() {},
  };

  const runtime = await startNodeWorkerHost({
    worker,
    artifactPath: missingArtifactPath,
    assetsRoot: join(root, "assets"),
    env: { TEST_VALUE: "shared" },
    host: "127.0.0.1",
    port: 0,
  });

  try {
    const response = await fetch(`http://127.0.0.1:${runtime.address.port}/health/live`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { path: "/health/live", value: "shared" });
  } finally {
    await runtime.close();
  }
});
