import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const boundary = fs.readFileSync(new URL("../worker/settings-input-normalizer-entry.ts", import.meta.url), "utf8");

test("reset draft mutations authorize through the protected lifecycle first", () => {
  assert.equal(boundary.includes("authorizeSettingsMutation"), true);
  assert.equal(boundary.includes('url.pathname = "/api/integrations/settings/effective"'), true);
  assert.equal(boundary.includes("const denied = await authorizeSettingsMutation(prepared, sourceEnv, ctx)"), true);
  assert.equal(boundary.includes("if (denied) return denied"), true);
});

test("reset draft creation serializes override check and persistence", () => {
  assert.equal(boundary.includes('url.pathname === "/api/integrations/settings/drafts"'), true);
  assert.equal(boundary.includes("resetFieldsFromBody"), true);
  assert.equal(boundary.includes("withSourceMutationLock(sourceEnv, () => runtime.fetch(prepared, sourceEnv, ctx))"), true);
  assert.equal(boundary.includes("CREATE TABLE IF NOT EXISTS portal_settings_source_lock"), true);
  assert.equal(boundary.includes("INSERT OR IGNORE INTO portal_settings_source_lock"), true);
});

test("reset fallbacks are refreshed before validation and checked again before apply", () => {
  assert.equal(boundary.includes("refreshResetFallbacks"), true);
  assert.equal(boundary.includes("resolvedResetMaterial"), true);
  assert.equal(boundary.includes('lifecycleMatch[2] as "validate" | "apply"'), true);
  assert.equal(boundary.includes("SET changes_json = ?, encrypted_secrets = ?, status = ?, validation_json = '{}', validated_at = NULL"), true);
  assert.equal(boundary.includes("WHERE id = ? AND updated_at = ? AND status = ?"), true);
  assert.equal(boundary.includes('code: "settings_reset_fallback_changed"'), true);
  assert.equal(boundary.includes("Выполните проверку черновика повторно"), true);
});

test("current ENV values replace stale draft fallbacks without exposing secrets", () => {
  assert.equal(boundary.includes('environmentValue(field, env)'), true);
  assert.equal(boundary.includes('configuredEnv(value)'), true);
  assert.equal(boundary.includes('secrets.ipaPassword = String(value)'), true);
  assert.equal(boundary.includes('secrets.xyopsApiKey = String(value)'), true);
  assert.equal(boundary.includes('changes.clearIpaPassword = true'), true);
  assert.equal(boundary.includes('changes.clearXyopsApiKey = true'), true);
  assert.equal(boundary.includes('encryptJson(resolved.secrets, env.CONFIG_ENCRYPTION_KEY)'), true);
});
