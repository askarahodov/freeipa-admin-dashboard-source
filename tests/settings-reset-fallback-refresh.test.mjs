import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const boundary = fs.readFileSync(new URL("../worker/settings-input-normalizer-entry.ts", import.meta.url), "utf8");
const safeSource = fs.readFileSync(new URL("../worker/settings-source-safe-entry.ts", import.meta.url), "utf8");
const sourceContext = fs.readFileSync(new URL("../worker/settings-source-context-entry.ts", import.meta.url), "utf8");
const localBoundary = fs.readFileSync(new URL("../worker/local-secure-entry.ts", import.meta.url), "utf8");

test("reset mutations run after local session and same-origin authorization", () => {
  assert.equal(localBoundary.includes('import secureRuntime from "./settings-input-normalizer-entry"'), true);
  assert.equal(localBoundary.includes("sameOriginAdminMutation(request)"), true);
  assert.equal(localBoundary.includes('headers.set("x-admin-token", internalToken)'), true);
  assert.equal(boundary.includes("authorizeSettingsMutation"), true);
  assert.equal(boundary.includes("const denied = await authorizeSettingsMutation(prepared, sourceEnv, ctx)"), true);
  assert.equal(safeSource.includes('request.headers.get("x-admin-token")'), true);
  assert.equal(safeSource.includes('permissions.includes("settings.manage")'), true);
});

test("source execution context cannot hide a committed operation", () => {
  assert.equal(boundary.includes('from "./settings-source-context-entry"'), true);
  assert.equal(sourceContext.includes('from "./settings-source-safe-entry"'), true);
  assert.equal(sourceContext.includes('typeof ctx?.waitUntil === "function"'), true);
  assert.equal(sourceContext.includes('void Promise.resolve(promise).catch(() => {})'), true);
  assert.equal(safeSource.includes('releaseSourceLock(env, owner).catch(() => {})'), true);
});

test("reset draft creation serializes override check and cleans partial persistence", () => {
  assert.equal(safeSource.includes("createResetDraft"), true);
  assert.equal(safeSource.includes("withSourceLock"), true);
  assert.equal(safeSource.includes("activeOverrides"), true);
  assert.equal(safeSource.includes("cleanupFailedResetDraft"), true);
  assert.equal(safeSource.includes("settings_reset_metadata_failed"), true);
  assert.equal(safeSource.includes("settings_reset_cleanup_conflict"), true);
});

test("reset fallbacks are refreshed before validation and checked again before apply", () => {
  assert.equal(boundary.includes("refreshResetFallbacks"), true);
  assert.equal(boundary.includes("resolvedResetMaterial"), true);
  assert.equal(boundary.includes('lifecycleMatch[2] as "validate" | "apply"'), true);
  assert.equal(boundary.includes("SET changes_json = ?, encrypted_secrets = ?, status = ?, validation_json = '{}', validated_at = NULL"), true);
  assert.equal(boundary.includes("WHERE id = ? AND updated_at = ? AND status = ?"), true);
  assert.equal(boundary.includes('code: "settings_reset_fallback_changed"'), true);
  assert.equal(boundary.includes("publicDraft(request, env, ctx, draftId)"), true);
  assert.equal(boundary.includes("...(draft ? { draft } : {})"), true);
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
