import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const lifecycleUrl = new URL("../worker/settings-lifecycle-entry.ts", import.meta.url);
const lifecycle = fs.readFileSync(lifecycleUrl, "utf8");
const localBoundary = fs.readFileSync(new URL("../worker/local-secure-entry.ts", import.meta.url), "utf8");
const authorization = fs.readFileSync(new URL("../admin-session-authorization.ts", import.meta.url), "utf8");

test("settings lifecycle runs behind the existing local admin security boundary", () => {
  assert.equal(localBoundary.includes('import secureRuntime from "./settings-lifecycle-entry"'), true);
  assert.equal(authorization.includes('"/api/integrations/settings/effective"'), true);
  assert.equal(authorization.includes('"/api/integrations/settings/drafts"'), true);
  assert.equal(authorization.includes('pathname.startsWith("/api/integrations/settings/drafts/")'), true);
  assert.equal(localBoundary.includes("sameOriginAdminMutation(request)"), true);
  assert.equal(localBoundary.includes("headers.delete(\"x-admin-token\")"), true);
});

test("draft lifecycle persists encrypted secret changes and never exposes their values", () => {
  assert.equal(lifecycle.includes("CREATE TABLE IF NOT EXISTS portal_settings_drafts"), true);
  assert.equal(lifecycle.includes("encryptDraftSecrets(secrets, env.CONFIG_ENCRYPTION_KEY)"), true);
  assert.equal(lifecycle.includes('ipaPasswordChanged: Boolean(secrets.ipaPassword)'), true);
  assert.equal(lifecycle.includes('xyopsApiKeyChanged: Boolean(secrets.xyopsApiKey)'), true);
  assert.equal(lifecycle.includes('after: "replace", secret: true'), true);
  assert.equal(lifecycle.includes("settings: { ...changes, ...secrets }"), false);
});

test("validation and apply enforce optimistic locking", () => {
  assert.equal(lifecycle.includes("base_revision INTEGER NOT NULL"), true);
  assert.equal(lifecycle.includes('code: "settings_revision_conflict"'), true);
  assert.equal(lifecycle.includes('row.status !== "validated"'), true);
  assert.equal(lifecycle.includes('status = ?, applied_at = ?, updated_at = ?'), true);
  assert.equal(lifecycle.includes('action === "validate"'), true);
  assert.equal(lifecycle.includes('action === "apply"'), true);
});

test("effective settings report per-field ENV or database source without secret values", () => {
  for (const envName of ["DEMO_MODE", "IPA_URL", "IPA_USERNAME", "IPA_PASSWORD", "XYOPS_URL", "XYOPS_API_KEY"]) {
    assert.equal(lifecycle.includes(`"${envName}"`), true, envName);
  }
  assert.equal(lifecycle.includes("envConfigured"), true);
  assert.equal(lifecycle.includes("overridden"), true);
  assert.equal(lifecycle.includes("passwordConfigured"), true);
  assert.equal(lifecycle.includes("apiKeyConfigured"), true);
});

test("settings lifecycle TypeScript parses under the repository Node baseline", () => {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "--check", fileURLToPath(lifecycleUrl)], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
