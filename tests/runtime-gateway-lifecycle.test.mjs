import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { startRuntimeGateway } from "../runtime/runtime-gateway.mjs";

function testGateway() {
  let closeCalls = 0;
  const server = createServer((request, response) => {
    response.statusCode = 204;
    response.end();
  });
  const originalClose = server.close.bind(server);
  server.close = (callback) => {
    closeCalls += 1;
    return originalClose(callback);
  };
  return { server, get closeCalls() { return closeCalls; } };
}

test("runtime gateway listens on loopback and injects URL plus opaque token", async () => {
  const fixture = testGateway();
  const seen = [];
  const runtime = await startRuntimeGateway({
    env: { IPA_URL: "https://ipa.example.test" },
    requestedPort: 0,
    tokenFactory() { return "a".repeat(64); },
    createGateway({ token }) {
      seen.push(token);
      return fixture.server;
    },
  });

  assert.deepEqual(seen, ["a".repeat(64)]);
  assert.equal(runtime.env.IPA_URL, "https://ipa.example.test");
  assert.equal(runtime.env.IPA_NODE_GATEWAY_TOKEN, "a".repeat(64));
  assert.match(runtime.env.IPA_NODE_GATEWAY_URL, /^http:\/\/127\.0\.0\.1:\d+$/u);
  assert.equal(runtime.address.host, "127.0.0.1");
  assert.ok(Number.isInteger(runtime.address.port) && runtime.address.port > 0);

  await runtime.close();
});

test("runtime gateway close is idempotent", async () => {
  const fixture = testGateway();
  const runtime = await startRuntimeGateway({
    env: {},
    tokenFactory: () => "b".repeat(64),
    createGateway: () => fixture.server,
  });

  await runtime.close();
  await runtime.close();
  assert.equal(fixture.closeCalls, 1);
});

test("runtime gateway rejects invalid ports before creating a server", async () => {
  let creates = 0;
  await assert.rejects(
    () => startRuntimeGateway({
      requestedPort: 70000,
      tokenFactory: () => "c".repeat(64),
      createGateway() { creates += 1; return testGateway().server; },
    }),
    /requestedPort must be an integer between 0 and 65535/u,
  );
  assert.equal(creates, 0);
});

test("runtime gateway rejects empty or weak runtime tokens", async () => {
  await assert.rejects(
    () => startRuntimeGateway({
      tokenFactory: () => "short",
      createGateway: () => testGateway().server,
    }),
    /gateway token/u,
  );
});

test("runtime gateway requires an explicit gateway factory", async () => {
  await assert.rejects(
    () => startRuntimeGateway({ tokenFactory: () => "d".repeat(64) }),
    /createGateway must be a function/u,
  );
});
