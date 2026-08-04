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

test("Gateway returns stable DNS code without leaking request secrets", async () => {
  const token = "gateway-bearer-sentinel";
  const password = "freeipa-password-sentinel";
  const privateUrl = "https://freeipa.private.example";
  const server = createFreeIpaGateway({
    token,
    fetchImpl: async () => {
      const error = new Error(`${privateUrl} ${password}`);
      error.cause = { code: "ENOTFOUND" };
      throw error;
    },
  });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/rpc`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        ipaUrl: privateUrl,
        username: "freeipa-user-sentinel",
        password,
        method: "user_find",
        args: [""],
        options: { sizelimit: 1 },
      }),
    });

    assert.equal(response.status, 502);
    const payload = await response.json();
    assert.equal(payload.code, "freeipa_dns_failed");
    assert.equal(typeof payload.error, "string");
    const serialized = JSON.stringify(payload);
    for (const secret of [privateUrl, password, token, "freeipa-user-sentinel"]) {
      assert.equal(serialized.includes(secret), false);
    }
  } finally {
    await close(server);
  }
});

test("Gateway classifies rejected FreeIPA credentials without returning upstream content", async () => {
  const server = createFreeIpaGateway({
    token: "gateway-token",
    fetchImpl: async () => new Response("upstream-auth-body-sentinel", { status: 401 }),
  });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/rpc`, {
      method: "POST",
      headers: { authorization: "Bearer gateway-token", "content-type": "application/json" },
      body: JSON.stringify({
        ipaUrl: "https://freeipa.example",
        username: "user",
        password: "password-sentinel",
        method: "user_find",
        args: [""],
        options: { sizelimit: 1 },
      }),
    });
    assert.equal(response.status, 502);
    const payload = await response.json();
    assert.equal(payload.code, "freeipa_auth_rejected");
    assert.equal(JSON.stringify(payload).includes("upstream-auth-body-sentinel"), false);
    assert.equal(JSON.stringify(payload).includes("password-sentinel"), false);
  } finally {
    await close(server);
  }
});
