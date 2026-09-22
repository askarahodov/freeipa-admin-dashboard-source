import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  effectiveIntegrationRuntime,
  encryptIntegrationSecrets,
} from "../../worker/integration-settings-runtime.ts";
import { handleIntegrationStatusRequest } from "../../worker/integration-status-http.ts";

test("effective integration runtime reads one persisted snapshot for both integrations", async () => {
  const key = "11".repeat(32);
  const encrypted = await encryptIntegrationSecrets({
    ipaPassword: "persisted-ipa-secret",
    xyopsApiKey: "persisted-xyops-secret",
  }, key);
  let reads = 0;
  const env = {
    CONFIG_ENCRYPTION_KEY: key,
    DEMO_MODE: "false",
    IPA_URL: "https://env-ipa.example",
    IPA_USERNAME: "env-user",
    IPA_PASSWORD: "env-password",
    XYOPS_URL: "https://env-xyops.example",
    XYOPS_API_KEY: "env-key",
    DB: {
      prepare() {
        reads += 1;
        return {
          bind() {
            return {
              async first() {
                return {
                  config_json: JSON.stringify({
                    demoMode: true,
                    ipaUrl: "https://persisted-ipa.example",
                    ipaUsername: "persisted-user",
                    xyopsUrl: "https://persisted-xyops.example",
                  }),
                  encrypted_secrets: encrypted,
                  updated_at: 123,
                };
              },
            };
          },
        };
      },
    },
  };

  const result = await effectiveIntegrationRuntime(env);
  assert.equal(reads, 1);
  assert.equal(result.ipaUrl, "https://persisted-ipa.example");
  assert.equal(result.xyopsUrl, "https://persisted-xyops.example");
  assert.equal(result.env.DEMO_MODE, "true");
  assert.equal(result.env.IPA_USERNAME, "persisted-user");
  assert.equal(result.env.IPA_PASSWORD, "persisted-ipa-secret");
  assert.equal(result.env.XYOPS_API_KEY, "persisted-xyops-secret");
});

test("integration status preserves probe and access response semantics", async () => {
  const calls = [];
  const request = new Request("https://portal.example/api/integrations/status", {
    headers: {
      "oai-authenticated-user-email": "operator@example.test",
      "oai-authenticated-user-groups": "ops",
    },
  });
  const baseEnv = {
    PORTAL_DEFAULT_ROLE: "operator",
    CONFIG_ENCRYPTION_KEY: "configured",
    DB: {},
  };

  const response = await handleIntegrationStatusRequest(request, baseEnv, {
    async resolveRuntime(env) {
      return {
        env: {
          ...env,
          DEMO_MODE: "false",
          IPA_USERNAME: "svc",
          IPA_PASSWORD: "secret",
          XYOPS_API_KEY: "key",
        },
        ipaUrl: "https://ipa.example",
        xyopsUrl: "https://xyops.example",
      };
    },
    async probeFreeIpa(_env, url) {
      calls.push(["ipa", url]);
    },
    async probeXyOps(url) {
      calls.push(["xyops", url]);
      return true;
    },
  });

  assert.ok(response);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.mode, "live");
  assert.equal(payload.viewer, "operator@example.test");
  assert.equal(payload.access.identity, "operator@example.test");
  assert.equal(payload.access.role, "operator");
  assert.equal(payload.persistence.available, true);
  assert.equal(payload.persistence.configured, true);
  assert.deepEqual(payload.freeipa, { configured: true, reachable: true, error: null });
  assert.deepEqual(payload.xyops, { configured: true, reachable: true });
  assert.deepEqual(calls, [
    ["ipa", "https://ipa.example"],
    ["xyops", "https://xyops.example"],
  ]);
});

test("demo integration status skips external probes and non-GET falls through", async () => {
  let probes = 0;
  const env = { PORTAL_DEFAULT_ROLE: "viewer" };
  const put = await handleIntegrationStatusRequest(
    new Request("https://portal.example/api/integrations/status", { method: "PUT" }),
    env,
  );
  assert.equal(put, null);

  const response = await handleIntegrationStatusRequest(
    new Request("https://portal.example/api/integrations/status"),
    env,
    {
      async resolveRuntime(source) {
        return {
          env: {
            ...source,
            DEMO_MODE: "true",
            IPA_USERNAME: "svc",
            IPA_PASSWORD: "secret",
            XYOPS_API_KEY: "key",
          },
          ipaUrl: "https://ipa.example",
          xyopsUrl: "https://xyops.example",
        };
      },
      async probeFreeIpa() {
        probes += 1;
      },
      async probeXyOps() {
        probes += 1;
        return true;
      },
    },
  );
  const payload = await response.json();
  assert.equal(payload.mode, "demo");
  assert.equal(payload.freeipa.reachable, false);
  assert.equal(payload.xyops.reachable, false);
  assert.equal(probes, 0);
});

test("#635 C4 gives integration status one explicit post-security owner", () => {
  const operations = fs.readFileSync(new URL("../../worker/operations-http-entry.ts", import.meta.url), "utf8");
  const central = fs.readFileSync(new URL("../../worker/index.ts", import.meta.url), "utf8");
  const routes = fs.readFileSync(new URL("../../src/auth/portal-route-contract.ts", import.meta.url), "utf8");

  const dispatch = operations.indexOf("handleIntegrationStatusRequest(request, sourceEnv)");
  const fallback = operations.indexOf("integrationRuntime.fetch(request, sourceEnv, ctx)", dispatch);
  assert.ok(dispatch >= 0 && fallback > dispatch, "status must run immediately before central fallback");
  assert.equal(central.includes('url.pathname === "/api/integrations/status"'), false);
  assert.match(routes, /id: "integration\.status".*owner: "worker\/integration-status-http\.ts"/);
});
