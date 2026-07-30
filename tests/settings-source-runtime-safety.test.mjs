import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const safeSourceUrl = new URL("../worker/settings-source-safe-entry.ts", import.meta.url);
const safeSource = fs.readFileSync(safeSourceUrl, "utf8");
const normalizerUrl = new URL("../worker/settings-input-normalizer.ts", import.meta.url);
const { normalizeSettingsRequestBody } = await import(normalizerUrl.href);

test("operational integration requests resolve inherited ENV without writing settings", () => {
  assert.equal(safeSource.includes("dynamicInheritedEnv"), true);
  assert.equal(safeSource.includes("virtualPrepared"), true);
  assert.equal(safeSource.includes("isOperationalIntegrationRequest"), true);
  assert.equal(safeSource.includes('pathname !== "/api/integrations/health"'), true);
  assert.equal(safeSource.includes("const operationalEnv = isOperationalIntegrationRequest(request) ? await dynamicInheritedEnv(sourceEnv) : sourceEnv"), true);
  assert.equal(safeSource.includes("UPDATE app_settings SET config_json"), false);
});

test("source authorization resolves portal RBAC without live connectivity probes", () => {
  assert.equal(safeSource.includes("resolvedAccess"), true);
  assert.equal(safeSource.includes("rolePermissions"), true);
  assert.equal(safeSource.includes('permissions.includes("settings.manage")'), true);
  assert.equal(safeSource.includes('url.pathname = "/api/integrations/status"'), false);
  assert.equal(safeSource.includes("lifecycleRuntime.fetch(new Request(url"), false);
});

test("malformed secret replacements cannot become D1 overrides", () => {
  assert.deepEqual(normalizeSettingsRequestBody("/api/integrations/settings", "PUT", {
    demoMode: true,
    ipaPassword: null,
    xyopsApiKey: 42,
    clearIpaPassword: false,
    clearXyopsApiKey: false,
  }), { demoMode: true });
  assert.deepEqual(normalizeSettingsRequestBody("/api/integrations/settings", "PUT", {
    ipaPassword: " replacement ",
    xyopsApiKey: "key",
    clearIpaPassword: true,
  }), { ipaPassword: " replacement ", xyopsApiKey: "key", clearIpaPassword: true });
});

test("dynamic source runtime parses under the repository Node baseline", () => {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "--check", fileURLToPath(safeSourceUrl)], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
