import assert from "node:assert/strict";
import test from "node:test";
import { createFreeIpaGateway } from "../scripts/freeipa-gateway.mjs";

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Gateway did not bind a TCP port");
  return `http://127.0.0.1:${address.port}`;
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve));
}

test("Gateway health requires its bearer token and never contacts FreeIPA", async () => {
  const token = "gateway-health-token";
  let upstreamCalls = 0;
  const server = createFreeIpaGateway({
    token,
    fetchImpl: async () => {
      upstreamCalls += 1;
      throw new Error("FreeIPA must not be contacted by Gateway health");
    },
  });
  const baseUrl = await listen(server);

  try {
    const unauthorized = await fetch(`${baseUrl}/health`);
    assert.equal(unauthorized.status, 401);
    assert.deepEqual(await unauthorized.json(), { ok: false, code: "gateway_authorization_required" });

    const authorized = await fetch(`${baseUrl}/health`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(authorized.status, 200);
    assert.equal(authorized.headers.get("cache-control"), "no-store");
    assert.deepEqual(await authorized.json(), { ok: true, code: "gateway_ready" });
    assert.equal(upstreamCalls, 0);
  } finally {
    await close(server);
  }
});
