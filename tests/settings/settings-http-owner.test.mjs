import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import test from "node:test";

const lifecycleUrl = new URL("../../worker/settings-lifecycle-entry.ts", import.meta.url);
const centralUrl = new URL("../../worker/index.ts", import.meta.url);
const lifecycle = fs.readFileSync(lifecycleUrl, "utf8");
const central = fs.readFileSync(centralUrl, "utf8");
const routes = fs.readFileSync(new URL("../../src/auth/portal-route-contract.ts", import.meta.url), "utf8");

test("#633 checkpoint A moves settings read and connection-test HTTP ownership out of the central Worker", () => {
  assert.equal(lifecycle.includes("async function handleOwnedSettingsRequest"), true);
  assert.equal(lifecycle.includes('request.method === "GET" && url.pathname === "/api/integrations/settings"'), true);
  assert.equal(lifecycle.includes('request.method === "POST" && url.pathname === "/api/integrations/settings/test"'), true);
  assert.equal(lifecycle.includes('requirePortalPermission(request, env, "settings.manage")'), true);
  assert.equal(lifecycle.includes("serviceAdminTokenAuthorized(request, env.ADMIN_TOKEN)"), true);
  assert.equal(lifecycle.includes("decryptIntegrationSecrets"), true);
  assert.equal(lifecycle.includes("assertStoredRoutesReadable(row.config.routes)"), true);
  assert.equal(lifecycle.includes("freeIpaRpc("), true);
  assert.equal(lifecycle.includes("xyopsPayloadSucceeded(payload)"), true);
  assert.equal(lifecycle.includes('action: "settings.connection_test"'), true);

  assert.equal(
    central.includes('request.method === "GET" && url.pathname === "/api/integrations/settings"'),
    false,
    "central Worker must not retain settings-read HTTP handling",
  );
  assert.equal(
    central.includes('"/api/integrations/settings/test"'),
    false,
    "central Worker must not retain settings connection-test HTTP ownership",
  );
  assert.equal(
    central.includes('request.method === "PUT" && url.pathname === "/api/integrations/settings"'),
    true,
    "legacy direct settings update remains central for the next bounded #633 slice",
  );
});

test("canonical route metadata points both extracted routes at the lifecycle owner", () => {
  assert.match(
    routes,
    /id: "settings\.read".*owner: "worker\/settings-lifecycle-entry\.ts"/,
  );
  assert.match(
    routes,
    /id: "settings\.test".*owner: "worker\/settings-lifecycle-entry\.ts"/,
  );
});

test("lifecycle-owned internal effective/read and validation calls cannot fall back to central read/test handlers", () => {
  assert.match(
    lifecycle,
    /delegatedRequest\.method === "GET" && pathname === "\/api\/integrations\/settings"/,
  );
  assert.match(
    lifecycle,
    /pathname === "\/api\/integrations\/settings\/test"/,
  );
  assert.match(
    lifecycle,
    /return handleOwnedSettingsRequest\(delegatedRequest, env\)/,
  );
});

test("settings owner and central Worker parse under the repository Node TypeScript baseline", () => {
  for (const url of [lifecycleUrl, centralUrl]) {
    const result = spawnSync(process.execPath, ["--experimental-strip-types", "--check", fileURLToPath(url)], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }
});
