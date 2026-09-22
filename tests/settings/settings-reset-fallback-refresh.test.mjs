import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const safeSource = fs.readFileSync(new URL("../../worker/settings-source-safe-entry.ts", import.meta.url), "utf8");
const localBoundary = fs.readFileSync(new URL("../../worker/local-secure-entry.ts", import.meta.url), "utf8");
const localRouting = fs.readFileSync(new URL("../../worker/middleware/local-security-routing.ts", import.meta.url), "utf8");

test("reset mutations run after local session and same-origin authorization", () => {
  assert.equal(localBoundary.includes('import secureRuntime from "./settings-source-safe-entry"'), true);
  assert.equal(localRouting.includes("sameOriginAdminMutation(request)"), true);
  assert.equal(localRouting.includes('headers.set("x-admin-token", internalToken)'), true);
  assert.equal(localBoundary.includes("handleLocalSecurityRouting(request, sourceEnv, ctx"), true);
  assert.equal(safeSource.includes("authorizeSettingsMutation"), true);
  assert.equal(safeSource.includes("const denied = await authorizeSettingsMutation(prepared, sourceEnv, sourceCtx)"), true);
  assert.equal(safeSource.includes('request.headers.get("x-admin-token")'), true);
  assert.equal(safeSource.includes('permissions.includes("settings.manage")'), true);
});

test("source execution context cannot hide a committed operation", () => {
  assert.equal(fs.existsSync(new URL("../../worker/settings-input-normalizer-entry.ts", import.meta.url)), false);
  assert.equal(fs.existsSync(new URL("../../worker/settings-source-context-entry.ts", import.meta.url)), false);
  assert.equal(safeSource.includes('typeof ctx?.waitUntil === "function"'), true);
  assert.equal(safeSource.includes('void Promise.resolve(promise).catch(() => {})'), true);
  assert.equal(safeSource.includes("const sourceCtx = safeContext(ctx)"), true);
  assert.equal(safeSource.includes("sourceCtx.waitUntil(auditCompensation"), true);
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
  assert.equal(safeSource.includes("refreshResetFallbacks"), true);
  assert.equal(safeSource.includes("resolvedResetMaterial"), true);
  assert.equal(safeSource.includes('lifecycleMatch[2] as "validate" | "apply"'), true);
  assert.equal(safeSource.includes("SET changes_json = ?, encrypted_secrets = ?, status = ?, validation_json = '{}', validated_at = NULL"), true);
  assert.equal(safeSource.includes("WHERE id = ? AND updated_at = ? AND status = ?"), true);
  assert.equal(safeSource.includes('code: "settings_reset_fallback_changed"'), true);
  assert.equal(safeSource.includes("publicDraft(request, env, ctx, draftId)"), true);
  assert.equal(safeSource.includes("...(draft ? { draft } : {})"), true);
});

test("terminal drafts cannot be returned to a mutable state by fallback refresh", () => {
  assert.equal(safeSource.includes('const refreshableDraftStatuses = new Set(["draft", "invalid", "validated"])'), true);
  assert.equal(safeSource.includes('if (!row || !refreshableDraftStatuses.has(String(row.status))) return null'), true);
  assert.equal(safeSource.includes('"applied"'), false);
});

test("current ENV values replace stale draft fallbacks without exposing secrets", () => {
  assert.equal(safeSource.includes('environmentValue(field, env)'), true);
  assert.equal(safeSource.includes('configuredEnv(value)'), true);
  assert.equal(safeSource.includes('secrets.ipaPassword = String(value)'), true);
  assert.equal(safeSource.includes('secrets.xyopsApiKey = String(value)'), true);
  assert.equal(safeSource.includes('changes.clearIpaPassword = true'), true);
  assert.equal(safeSource.includes('changes.clearXyopsApiKey = true'), true);
  assert.equal(safeSource.includes('encryptResetJson(resolved.secrets, env.CONFIG_ENCRYPTION_KEY)'), true);
});
