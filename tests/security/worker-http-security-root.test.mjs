import assert from "node:assert/strict";
import test from "node:test";

import worker from "../../worker/http-security-root-entry.ts";

function context() {
  return {
    waitUntil() {},
    passThroughOnException() {},
  };
}

test("Worker root applies the centralized HTTP security baseline to early health responses", async () => {
  const response = await worker.fetch(new Request("https://portal.example/health/live"), {}, context());
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-security-policy") ?? "", /default-src 'self'/);
  assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
});

test("Worker root emits HSTS only for HTTPS plus explicit opt-in", async () => {
  const https = await worker.fetch(
    new Request("https://portal.example/health/live"),
    { PORTAL_HSTS_ENABLED: "true" },
    context(),
  );
  assert.match(https.headers.get("strict-transport-security") ?? "", /^max-age=31536000/);

  const http = await worker.fetch(
    new Request("http://portal.example/health/live"),
    { PORTAL_HSTS_ENABLED: "true" },
    context(),
  );
  assert.equal(http.headers.get("strict-transport-security"), null);
});
