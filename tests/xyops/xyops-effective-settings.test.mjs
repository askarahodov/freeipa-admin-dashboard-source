import assert from "node:assert/strict";
import test from "node:test";

import {
  effectiveXyOpsRuntime,
  encryptIntegrationSecrets,
} from "../../worker/integration-settings-runtime.ts";

const encryptionKey = "33".repeat(32);

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

test("effective XYOps runtime preserves environment fallback and file limits", async () => {
  const resolved = await effectiveXyOpsRuntime({
    XYOPS_URL: "https://xyops.env.example.test/",
    XYOPS_API_KEY: "env-key",
    XYOPS_RESULT_FILE_MAX_BYTES: "12345",
  });
  assert.equal(resolved.xyopsUrl, "https://xyops.env.example.test");
  assert.equal(resolved.env.XYOPS_API_KEY, "env-key");
  assert.equal(resolved.env.XYOPS_RESULT_FILE_MAX_BYTES, "12345");
});

test("persisted XYOps URL and encrypted API key override environment", async () => {
  const encrypted = await encryptIntegrationSecrets({ ipaPassword: "ipa-secret", xyopsApiKey: "db-key" }, encryptionKey);
  const resolved = await effectiveXyOpsRuntime({
    DB: fakeDb({
      config_json: JSON.stringify({ demoMode: false, xyopsUrl: "https://xyops.db.example.test" }),
      encrypted_secrets: encrypted,
      updated_at: 123,
    }),
    CONFIG_ENCRYPTION_KEY: encryptionKey,
    XYOPS_URL: "https://xyops.env.example.test",
    XYOPS_API_KEY: "env-key",
    XYOPS_RESULT_FILE_MAX_BYTES: "98765",
  });
  assert.equal(resolved.xyopsUrl, "https://xyops.db.example.test");
  assert.equal(resolved.env.XYOPS_API_KEY, "db-key");
  assert.equal(resolved.env.XYOPS_RESULT_FILE_MAX_BYTES, "98765");
});

test("unreadable persisted XYOps secrets fall back to environment", async () => {
  const resolved = await effectiveXyOpsRuntime({
    DB: fakeDb({
      config_json: JSON.stringify({ demoMode: false, xyopsUrl: "https://xyops.db.example.test" }),
      encrypted_secrets: "broken",
      updated_at: 123,
    }),
    CONFIG_ENCRYPTION_KEY: encryptionKey,
    XYOPS_URL: "https://xyops.env.example.test/",
    XYOPS_API_KEY: "env-key",
  });
  assert.equal(resolved.xyopsUrl, "https://xyops.env.example.test");
  assert.equal(resolved.env.XYOPS_API_KEY, "env-key");
});
