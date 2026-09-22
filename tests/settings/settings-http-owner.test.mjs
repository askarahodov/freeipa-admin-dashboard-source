import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import test from "node:test";

const ownerUrl = new URL("../../worker/settings-http.ts", import.meta.url);
const secureUrl = new URL("../../worker/secure-entry.ts", import.meta.url);
const centralUrl = new URL("../../worker/index.ts", import.meta.url);
const owner = fs.readFileSync(ownerUrl, "utf8");
const secure = fs.readFileSync(secureUrl, "utf8");
const central = fs.readFileSync(centralUrl, "utf8");
const routes = fs.readFileSync(new URL("../../src/auth/portal-route-contract.ts", import.meta.url), "utf8");

test("#633 checkpoint A gives settings read/test one explicit post-security HTTP owner", () => {
  assert.equal(owner.includes("export async function handleSettingsHttpRequest"), true);
  assert.equal(owner.includes('request.method === "GET" && url.pathname === "/api/integrations/settings"'), true);
  assert.equal(owner.includes('url.pathname === "/api/integrations/settings/test"'), true);
  assert.equal(owner.includes('requirePortalPermission(request, env, "settings.manage")'), true);
  assert.equal(owner.includes("serviceAdminTokenAuthorized(request, env.ADMIN_TOKEN)"), true);
  assert.equal(owner.includes("assertStoredRoutesReadable(config.routes)"), true);
  assert.equal(owner.includes("freeIpaRpc("), true);
  assert.equal(owner.includes("xyopsPayloadSucceeded(payload)"), true);
  assert.equal(owner.includes('action: "settings.connection_test"'), true);

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

test("secure identity normalization runs before extracted settings dispatch", () => {
  const contextIndex = secure.indexOf("const secured = await secureContext(request, sourceEnv)");
  const ownerIndex = secure.indexOf("await handleSettingsHttpRequest(secured.request, secured.env)");
  const downstreamIndex = secure.indexOf("return runtime.fetch(secured.request, secured.env, ctx)");
  assert.ok(contextIndex >= 0, "secure context normalization must remain present");
  assert.ok(ownerIndex > contextIndex, "settings owner must run only after secure context normalization");
  assert.ok(downstreamIndex > ownerIndex, "non-owned requests must continue to downstream runtime");
});

test("canonical route metadata points both extracted routes at the settings HTTP owner", () => {
  assert.match(routes, /id: "settings\.read".*owner: "worker\/settings-http\.ts"/);
  assert.match(routes, /id: "settings\.test".*owner: "worker\/settings-http\.ts"/);
  assert.match(routes, /id: "settings\.update".*owner: "worker\/settings-source-safe-entry\.ts"/);
});

test("settings owner, secure boundary and central Worker parse under the repository Node TypeScript baseline", () => {
  for (const url of [ownerUrl, secureUrl, centralUrl]) {
    const result = spawnSync(process.execPath, ["--experimental-strip-types", "--check", fileURLToPath(url)], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }
});
