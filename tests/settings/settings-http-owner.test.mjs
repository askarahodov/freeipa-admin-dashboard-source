import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import test from "node:test";

const ownerUrl = new URL("../../worker/settings-http.ts", import.meta.url);
const secureUrl = new URL("../../worker/secure-entry.ts", import.meta.url);
const centralUrl = new URL("../../worker/index.ts", import.meta.url);
const sourceUrl = new URL("../../worker/settings-source-entry.ts", import.meta.url);
const sourceSafeUrl = new URL("../../worker/settings-source-safe-entry.ts", import.meta.url);
const owner = fs.readFileSync(ownerUrl, "utf8");
const secure = fs.readFileSync(secureUrl, "utf8");
const centralExists = fs.existsSync(centralUrl);
const source = fs.readFileSync(sourceUrl, "utf8");
const sourceSafe = fs.readFileSync(sourceSafeUrl, "utf8");
const routes = fs.readFileSync(new URL("../../src/auth/portal-route-contract.ts", import.meta.url), "utf8");

test("#633 checkpoints A/B give settings read/test/direct-write one explicit post-security HTTP owner", () => {
  assert.equal(owner.includes("export async function handleSettingsHttpRequest"), true);
  assert.equal(owner.includes('request.method === "GET" && url.pathname === "/api/integrations/settings"'), true);
  assert.equal(owner.includes('url.pathname === "/api/integrations/settings/test"'), true);
  assert.equal(owner.includes('request.method === "PUT" && url.pathname === "/api/integrations/settings"'), true);
  assert.equal(owner.includes("encryptIntegrationSecrets(settings.secrets"), true);
  assert.equal(owner.includes('action: "settings.updated"'), true);
  assert.equal(owner.includes('requirePortalPermission(request, env, "settings.manage")'), true);
  assert.equal(owner.includes("serviceAdminTokenAuthorized(request, env.ADMIN_TOKEN)"), true);
  assert.equal(owner.includes("assertStoredRoutesReadable(config.routes)"), true);
  assert.equal(owner.includes("freeIpaRpc("), true);
  assert.equal(owner.includes("xyopsPayloadSucceeded(payload)"), true);
  assert.equal(owner.includes('action: "settings.connection_test"'), true);

  assert.equal(centralExists, false, "retired central Worker tail must stay absent");
  assert.equal(
    source.includes('request.method === "PUT" && url.pathname === "/api/integrations/settings"'),
    true,
    "source metadata/CAS wrapper must continue to observe the direct settings write",
  );
  assert.equal(
    sourceSafe.includes('request.method === "PUT" && (url.pathname === "/api/integrations/settings"'),
    true,
    "source authorization/compensation wrapper must remain outside the extracted HTTP owner",
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

test("canonical route metadata points all extracted base settings routes at the settings HTTP owner", () => {
  assert.match(routes, /id: "settings\.read".*owner: "worker\/settings-http\.ts"/);
  assert.match(routes, /id: "settings\.test".*owner: "worker\/settings-http\.ts"/);
  assert.match(routes, /id: "settings\.update".*owner: "worker\/settings-http\.ts"/);
});

test("settings owner and remaining boundaries parse under the repository Node TypeScript baseline", () => {
  for (const url of [ownerUrl, secureUrl, sourceUrl, sourceSafeUrl]) {
    const result = spawnSync(process.execPath, ["--experimental-strip-types", "--check", fileURLToPath(url)], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }
});
