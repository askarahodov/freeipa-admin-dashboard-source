import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const lifecycleUrl = new URL("../worker/settings-lifecycle-entry.ts", import.meta.url);
const revisionsUrl = new URL("../worker/settings-revisions-entry.ts", import.meta.url);
const sourceUrl = new URL("../worker/settings-source-entry.ts", import.meta.url);
const safeSourceUrl = new URL("../worker/settings-source-safe-entry.ts", import.meta.url);
const sourceContextUrl = new URL("../worker/settings-source-context-entry.ts", import.meta.url);
const normalizerEntryUrl = new URL("../worker/settings-input-normalizer-entry.ts", import.meta.url);
const normalizerUrl = new URL("../worker/settings-input-normalizer.ts", import.meta.url);
const workflowUrl = new URL("../.github/workflows/e2e-auth.yml", import.meta.url);
const lifecycle = fs.readFileSync(lifecycleUrl, "utf8");
const revisions = fs.readFileSync(revisionsUrl, "utf8");
const source = fs.readFileSync(sourceUrl, "utf8");
const safeSource = fs.readFileSync(safeSourceUrl, "utf8");
const sourceContext = fs.readFileSync(sourceContextUrl, "utf8");
const normalizerEntry = fs.readFileSync(normalizerEntryUrl, "utf8");
const diagnostics = fs.readFileSync(new URL("../worker/diagnostics-entry.ts", import.meta.url), "utf8");
const localBoundary = fs.readFileSync(new URL("../worker/local-secure-entry.ts", import.meta.url), "utf8");
const authorization = fs.readFileSync(new URL("../admin-session-authorization.ts", import.meta.url), "utf8");
const wizard = fs.readFileSync(new URL("../app/SettingsLifecycleWizard.tsx", import.meta.url), "utf8");
const layout = fs.readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../app/settings-lifecycle.css", import.meta.url), "utf8");
const resetStyles = fs.readFileSync(new URL("../app/settings-source-resets.css", import.meta.url), "utf8");
const workflow = fs.readFileSync(workflowUrl, "utf8");
const { normalizeSettingsRequestBody } = await import(normalizerUrl.href);

test("settings lifecycle runs behind revision, local auth, origin, normalizer and source authorization", () => {
  assert.equal(diagnostics.includes('import localRuntime from "./settings-revisions-entry"'), true);
  assert.equal(revisions.includes('import localRuntime from "./local-secure-entry"'), true);
  assert.equal(localBoundary.includes('import secureRuntime from "./settings-input-normalizer-entry"'), true);
  assert.equal(normalizerEntry.includes('import runtime, { authorizeSettingsMutation } from "./settings-source-context-entry"'), true);
  assert.equal(sourceContext.includes('import runtime, { authorizeSettingsMutation } from "./settings-source-safe-entry"'), true);
  assert.equal(safeSource.includes('import sourceRuntime from "./settings-source-entry"'), true);
  assert.equal(safeSource.includes('import lifecycleRuntime from "./settings-lifecycle-entry"'), true);
  assert.equal(source.includes('import lifecycleRuntime from "./settings-lifecycle-entry"'), true);
  assert.equal(authorization.includes('"/api/integrations/settings/effective"'), true);
  assert.equal(authorization.includes('pathname.startsWith("/api/integrations/settings/drafts/")'), true);
  assert.equal(localBoundary.includes("sameOriginAdminMutation(request)"), true);
  assert.equal(localBoundary.includes("localAdminSessionToken(session)"), true);
  assert.equal(localBoundary.includes("delegatedEnv(sourceEnv, session, internalToken)"), true);
  assert.equal(safeSource.includes('permissions.includes("settings.manage")'), true);
  assert.equal(safeSource.includes("isOperationalIntegrationRequest"), true);
  assert.equal(safeSource.includes("dynamicInheritedEnv"), true);
  assert.equal(sourceContext.includes('typeof ctx?.waitUntil === "function"'), true);
  assert.equal(lifecycle.includes('request.headers.get("oai-authenticated-user-email")'), false);
});

test("legacy settings inputs do not create accidental secret overrides", () => {
  assert.deepEqual(normalizeSettingsRequestBody("/api/integrations/settings", "PUT", {
    demoMode: false, ipaPassword: "   ", xyopsApiKey: "", clearIpaPassword: false, clearXyopsApiKey: false,
  }), { demoMode: false });
  assert.deepEqual(normalizeSettingsRequestBody("/api/integrations/settings", "PUT", {
    ipaPassword: "", clearIpaPassword: true, xyopsApiKey: "replacement",
  }), { clearIpaPassword: true, xyopsApiKey: "replacement" });
});

test("empty reset arrays are stripped before lifecycle validation", () => {
  assert.deepEqual(normalizeSettingsRequestBody("/api/integrations/settings/drafts", "POST", {
    baseRevision: 10, changes: { demoMode: true, resetFields: [] },
  }), { baseRevision: 10, changes: { demoMode: true } });
  assert.deepEqual(normalizeSettingsRequestBody("/api/integrations/settings/drafts", "POST", {
    baseRevision: 10, demoMode: true, resetFields: [],
  }), { baseRevision: 10, demoMode: true });
  assert.deepEqual(normalizeSettingsRequestBody("/api/integrations/settings/drafts", "POST", {
    baseRevision: 10, changes: { resetFields: ["ipaUrl"] },
  }), { baseRevision: 10, changes: { resetFields: ["ipaUrl"] } });
});

test("draft lifecycle persists encrypted secret changes and cancellation clears them", () => {
  assert.equal(lifecycle.includes("CREATE TABLE IF NOT EXISTS portal_settings_drafts"), true);
  assert.equal(lifecycle.includes("encryptDraftSecrets(secrets, env.CONFIG_ENCRYPTION_KEY)"), true);
  assert.equal(lifecycle.includes('ipaPasswordChanged: Boolean(secrets.ipaPassword)'), true);
  assert.equal(lifecycle.includes('xyopsApiKeyChanged: Boolean(secrets.xyopsApiKey)'), true);
  assert.equal(lifecycle.includes('after: "replace"'), true);
  assert.equal(lifecycle.includes("encrypted_secrets = ''"), true);
  assert.equal(lifecycle.includes('action === "cancel"'), true);
  assert.equal(lifecycle.includes("status IN ('draft','validated','invalid')"), true);
});

test("validation and apply use an atomic revision CAS and a single applying claim", () => {
  assert.equal(lifecycle.includes("base_revision INTEGER NOT NULL"), true);
  assert.equal(lifecycle.includes('code: "settings_revision_conflict"'), true);
  assert.equal(lifecycle.includes('row.status !== "validated"'), true);
  assert.equal(lifecycle.includes('status = ?, updated_at = ? WHERE id = ? AND status = ?'), true);
  assert.equal(lifecycle.includes('"applying"'), true);
  assert.equal(lifecycle.includes('WHERE id = ? AND updated_at = ?'), true);
  assert.equal(lifecycle.includes('INSERT OR IGNORE INTO app_settings'), true);
  assert.equal(lifecycle.includes('CREATE TABLE IF NOT EXISTS portal_settings_apply_commits'), true);
  assert.equal(lifecycle.includes('applyCommitId: committed.commitId'), true);
});

test("leaving demo mode validates integrations that become live", () => {
  assert.equal(lifecycle.includes('active.demoMode === true && changes.demoMode === false'), true);
  assert.equal(lifecycle.includes('if (ipaUrl || ipaUsername || ipaPasswordConfigured) result.push("freeipa")'), true);
  assert.equal(lifecycle.includes('if (xyopsUrl || xyopsApiKeyConfigured) result.push("xyops")'), true);
});

test("D1 overrides can return to dynamic ENV or default through the lifecycle", () => {
  assert.equal(source.includes('type SettingField = "demoMode"'), true);
  assert.equal(source.includes('function overrideSet('), true);
  assert.equal(source.includes('for (const field of resets) result.delete(field)'), true);
  assert.equal(source.includes('attachOverridesToAppliedRevision'), true);
  assert.equal(source.includes('trySynchronizeInheritedSettings'), true);
  assert.equal(revisions.includes('settings.override.reset_applied'), true);
  assert.equal(safeSource.includes('function createResetDraft('), true);
  assert.equal(safeSource.includes('settings_field_not_overridden'), true);
  assert.equal(safeSource.includes('settings.override.reset_requested'), true);
});

test("source mutations are serialized, cleanup-safe and rollback remains tracked", () => {
  assert.equal(source.includes("CREATE TABLE IF NOT EXISTS portal_settings_source_lock"), true);
  assert.equal(source.includes("sourceMetadataConflict: !attached"), true);
  assert.equal(revisions.includes('payload.sourceMetadataConflict === true'), true);
  assert.equal(safeSource.includes("withSourceLock"), true);
  assert.equal(safeSource.includes('releaseSourceLock(env, owner).catch(() => {})'), true);
  assert.equal(safeSource.includes("bestEffortReleaseEnv"), true);
  assert.equal(safeSource.includes("cleanupFailedResetDraft"), true);
  assert.equal(safeSource.includes("DELETE FROM portal_settings_drafts WHERE id = ? AND status IN ('draft','validated','invalid')"), true);
});

test("operational requests dynamically inherit ENV and admin writes emit compensation audit", () => {
  assert.equal(safeSource.includes("isOperationalIntegrationRequest"), true);
  assert.equal(safeSource.includes("dynamicInheritedEnv"), true);
  assert.equal(safeSource.includes("return lifecycleRuntime.fetch(request, operationalEnv, ctx)"), true);
  assert.equal(safeSource.includes('settings.updated.compensated_rollback'), true);
  assert.equal(safeSource.includes('routes.updated.compensated_rollback'), true);
  assert.equal(safeSource.includes("auditCompensation"), true);
});

test("source metadata attachment requires the exact active revision and apply snapshot", () => {
  assert.equal(source.includes('if (!row || !commit) return false'), true);
  assert.equal(source.includes('UPDATE app_settings SET config_json = ? WHERE id = ? AND updated_at = ?'), true);
  assert.equal(source.includes('UPDATE portal_settings_apply_commits SET config_json = ? WHERE id = ? AND revision = ?'), true);
  assert.equal(source.includes('resultChanges(results[0]) === 1 && resultChanges(results[1]) === 1'), true);
  assert.equal(revisions.includes("consumeApplyCommit"), true);
  assert.equal(revisions.includes("rollbackSnapshotCas"), true);
});

test("reset metadata is retained until terminal or conflict handling", () => {
  assert.equal(source.includes('DELETE FROM portal_settings_draft_resets WHERE created_at <'), false);
  assert.equal(source.includes('await deleteResetFields(sourceEnv, draftId)'), true);
  assert.equal(source.includes("conflictPayload(payload)"), true);
  assert.equal(source.includes('action === "cancel" && effectiveResponse.ok'), true);
});

test("reset to an unconfigured default intentionally disables its integration", () => {
  assert.equal(source.includes('function disabledResetServices('), true);
  assert.equal(source.includes('function promoteIntentionalDisableValidation('), true);
  assert.equal(source.includes('skippedServices: Array.from(disabled)'), true);
  assert.equal(source.includes('configuredEnv(value) ? String(value) : ""'), true);
  assert.equal(normalizerEntry.includes('configuredEnv(value)'), true);
});

test("direct settings and route writes preserve source metadata", () => {
  assert.equal(source.includes('url.pathname === "/api/integrations/settings"'), true);
  assert.equal(source.includes('url.pathname === "/api/integrations/routes"'), true);
  assert.equal(source.includes("directSettingsOverrides"), true);
  assert.equal(source.includes("attachOverridesToActiveRevision"), true);
  assert.equal(safeSource.includes("auditCompensation"), true);
});

test("effective settings report per-field source, conflicts and reset metadata without secret values", () => {
  for (const envName of ["DEMO_MODE", "IPA_URL", "IPA_USERNAME", "IPA_PASSWORD", "XYOPS_URL", "XYOPS_API_KEY"]) assert.equal(source.includes(`"${envName}"`), true, envName);
  assert.equal(source.includes("envConfigured"), true);
  assert.equal(source.includes("overridden"), true);
  assert.equal(source.includes("resettable"), true);
  assert.equal(source.includes("fallbackSource"), true);
  assert.equal(source.includes("overrideCount"), true);
  assert.equal(source.includes("conflictCount"), true);
  assert.equal(source.includes("secret: true"), true);
  assert.equal(source.includes("decryptObject"), true);
});

test("revision history finalizes reset audit and response after health checks", () => {
  assert.equal(revisions.includes("CREATE TABLE IF NOT EXISTS portal_settings_revisions"), true);
  assert.equal(revisions.includes("resetFieldsFromPayload"), true);
  assert.equal(revisions.includes('settings.override.reset_applied'), true);
  assert.equal(revisions.includes('settings.override.reset_rolled_back'), true);
  assert.equal(revisions.includes('resetFields, health'), true);
  assert.equal(revisions.includes('reason: "automatic_rollback"'), true);
  assert.equal(revisions.includes('code: "settings_post_apply_health_failed"'), true);
  assert.equal(revisions.includes('code: "settings_rollback_conflict"'), true);
});

test("visual wizard refreshes invalidated draft state and stages resets instead of direct writes", () => {
  assert.equal(layout.includes("<SettingsLifecycleWizard />"), true);
  assert.equal(layout.includes('import "./settings-source-resets.css"'), true);
  assert.equal(wizard.includes('api("/api/integrations/settings/drafts"'), true);
  assert.equal(wizard.match(/if \(detail\.payload\?\.draft\) setDraft\(detail\.payload\.draft\)/g)?.length >= 2, true);
  assert.equal(wizard.includes("D1 overrides"), true);
  assert.equal(wizard.includes("Конфликты"), true);
  assert.equal(wizard.includes("settings-reset"), true);
  assert.equal(resetStyles.includes(".settings-source-toolbar"), true);
  assert.equal(resetStyles.includes(".settings-reset.selected"), true);
  assert.equal(styles.includes('html[data-settings-lifecycle-wizard="ready"] .settings-savebar'), true);
  assert.equal(wizard.includes('fetch("/api/integrations/settings", { method: "PUT"'), false);
});

test("rollback and source reset changes trigger Auth E2E", () => {
  for (const path of [
    "worker/settings-lifecycle-entry.ts",
    "worker/settings-source-entry.ts",
    "worker/settings-source-safe-entry.ts",
    "worker/settings-source-context-entry.ts",
    "worker/settings-revisions-entry.ts",
    "worker/settings-input-normalizer-entry.ts",
    "worker/settings-input-normalizer.ts",
    "tests/settings-source-runtime-safety.test.mjs",
    "app/SettingsLifecycleWizard.tsx",
    "app/settings-source-resets.css",
  ]) assert.equal(workflow.includes(`"${path}"`), true, path);
});

test("settings lifecycle TypeScript parses under the repository Node baseline", () => {
  for (const url of [lifecycleUrl, sourceUrl, safeSourceUrl, sourceContextUrl, revisionsUrl, normalizerEntryUrl, normalizerUrl]) {
    const result = spawnSync(process.execPath, ["--experimental-strip-types", "--check", fileURLToPath(url)], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }
});