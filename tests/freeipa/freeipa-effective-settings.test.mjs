import assert from "node:assert/strict";
import test from "node:test";

import {
  effectiveFreeIpaRuntime,
  encryptIntegrationSecrets,
} from "../../worker/integration-settings-runtime.ts";

const encryptionKey = "11".repeat(32);

function fakeDb(row) {
  return {
    prepare(sql) {
      assert.match(sql, /FROM app_settings/);
      return {
        bind(id) {
          assert.equal(id, "main");
          return { first: async () => row };
        },
      };
    },
  };
}

test("effective FreeIPA runtime preserves environment fallback semantics", async () => {
  const source = {
    DEMO_MODE: "yes",
    IPA_URL: "https://ipa.example.test/",
    IPA_USERNAME: "env-reader",
    IPA_PASSWORD: "env-secret",
    IPA_NODE_GATEWAY_URL: "http://gateway.internal",
    IPA_NODE_GATEWAY_TOKEN: "gateway-token",
  };
  const resolved = await effectiveFreeIpaRuntime(source);
  assert.equal(resolved.ipaUrl, "https://ipa.example.test");
  assert.equal(resolved.env.DEMO_MODE, "true");
  assert.equal(resolved.env.IPA_USERNAME, "env-reader");
  assert.equal(resolved.env.IPA_PASSWORD, "env-secret");
  assert.equal(resolved.env.IPA_NODE_GATEWAY_TOKEN, "gateway-token");
});

test("persisted FreeIPA settings override environment while Gateway credentials stay server-only", async () => {
  const encrypted = await encryptIntegrationSecrets({ ipaPassword: "db-secret", xyopsApiKey: "xy-secret" }, encryptionKey);
  const DB = fakeDb({
    config_json: JSON.stringify({
      demoMode: false,
      ipaUrl: "https://ipa.db.example.test",
      ipaUsername: "db-reader",
      xyopsUrl: "https://xyops.example.test",
    }),
    encrypted_secrets: encrypted,
    updated_at: 123,
  });
  const resolved = await effectiveFreeIpaRuntime({
    DB,
    CONFIG_ENCRYPTION_KEY: encryptionKey,
    DEMO_MODE: "true",
    IPA_URL: "https://ipa.env.example.test",
    IPA_USERNAME: "env-reader",
    IPA_PASSWORD: "env-secret",
    IPA_NODE_GATEWAY_URL: "http://gateway.internal",
    IPA_NODE_GATEWAY_TOKEN: "gateway-token",
  });
  assert.equal(resolved.ipaUrl, "https://ipa.db.example.test");
  assert.equal(resolved.env.DEMO_MODE, "false");
  assert.equal(resolved.env.IPA_USERNAME, "db-reader");
  assert.equal(resolved.env.IPA_PASSWORD, "db-secret");
  assert.equal(resolved.env.IPA_NODE_GATEWAY_URL, "http://gateway.internal");
  assert.equal(resolved.env.IPA_NODE_GATEWAY_TOKEN, "gateway-token");
});

test("unreadable persisted secrets fail closed to the legacy environment fallback", async () => {
  const DB = fakeDb({
    config_json: JSON.stringify({ demoMode: false, ipaUrl: "https://ipa.db.example.test", ipaUsername: "db-reader" }),
    encrypted_secrets: "broken",
    updated_at: 123,
  });
  const resolved = await effectiveFreeIpaRuntime({
    DB,
    CONFIG_ENCRYPTION_KEY: encryptionKey,
    IPA_URL: "https://ipa.env.example.test/",
    IPA_USERNAME: "env-reader",
    IPA_PASSWORD: "env-secret",
  });
  assert.equal(resolved.ipaUrl, "https://ipa.env.example.test");
  assert.equal(resolved.env.IPA_USERNAME, "env-reader");
  assert.equal(resolved.env.IPA_PASSWORD, "env-secret");
});
