import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const lifecycleUrl = new URL("../worker/settings-lifecycle-entry.ts", import.meta.url);
const revisionsUrl = new URL("../worker/settings-revisions-entry.ts", import.meta.url);
const workflowUrl = new URL("../.github/workflows/e2e-auth.yml", import.meta.url);
const lifecycle = fs.readFileSync(lifecycleUrl, "utf8");
const revisions = fs.readFileSync(revisionsUrl, "utf8");
const diagnostics = fs.readFileSync(new URL("../worker/diagnostics-entry.ts", import.meta.url), "utf8");
const localBoundary = fs.readFileSync(new URL("../worker/local-secure-entry.ts", import.meta.url), "utf8");
const authorization = fs.readFileSync(new URL("../admin-session-authorization.ts", import.meta.url), "utf8");
const wizard = fs.readFileSync(new URL("../app/SettingsLifecycleWizard.tsx", import.meta.url), "utf8");
const layout = fs.readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../app/settings-lifecycle.css", import.meta.url), "utf8");
const workflow = fs.readFileSync(workflowUrl, "utf8");

test("settings lifecycle runs behind token and portal RBAC boundaries", () => {
  assert.equal(diagnostics.includes('import localRuntime from "./settings-revisions-entry"'), true);
  assert.equal(revisions.includes('import localRuntime from "./local-secure-entry"'), true);
  assert.equal(localBoundary.includes('import secureRuntime from "./settings-lifecycle-entry"'), true);
  assert.equal(authorization.includes('"/api/integrations/settings/effective"'), true);
  assert.equal(authorization.includes('"/api/integrations/settings/drafts"'), true);
  assert.equal(authorization.includes('"/api/integrations/settings/revisions"'), true);
  assert.equal(authorization.includes('pathname.startsWith("/api/integrations/settings/drafts/")'), true);
  assert.equal(localBoundary.includes("sameOriginAdminMutation(request)"), true);
  assert.equal(localBoundary.includes('headers.delete("x-admin-token")'), true);
  assert.equal(lifecycle.includes('"/api/integrations/status"'), true);
  assert.equal(lifecycle.includes('permissions.includes("settings.manage")'), true);
  assert.equal(lifecycle.includes('access.identity'), true);
  assert.equal(lifecycle.includes('request.headers.get("oai-authenticated-user-email")'), false);
  assert.equal(revisions.includes('access?.permissions.includes("settings.manage")'), true);
});

test("draft lifecycle persists encrypted secret changes and cancellation clears them", () => {
  assert.equal(lifecycle.includes("CREATE TABLE IF NOT EXISTS portal_settings_drafts"), true);
  assert.equal(lifecycle.includes("encryptDraftSecrets(secrets, env.CONFIG_ENCRYPTION_KEY)"), true);
  assert.equal(lifecycle.includes('ipaPasswordChanged: Boolean(secrets.ipaPassword)'), true);
  assert.equal(lifecycle.includes('xyopsApiKeyChanged: Boolean(secrets.xyopsApiKey)'), true);
  assert.equal(lifecycle.includes('after: "replace", secret: true'), true);
  assert.equal(lifecycle.includes('encrypted_secrets = \'\''), true);
  assert.equal(lifecycle.includes('action === "cancel"'), true);
  assert.equal(lifecycle.includes('status IN (\'draft\',\'validated\',\'invalid\')'), true);
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

test("effective settings report per-field ENV or database source without secret values", () => {
  for (const envName of ["DEMO_MODE", "IPA_URL", "IPA_USERNAME", "IPA_PASSWORD", "XYOPS_URL", "XYOPS_API_KEY"]) {
    assert.equal(lifecycle.includes(`"${envName}"`), true, envName);
  }
  assert.equal(lifecycle.includes("envConfigured"), true);
  assert.equal(lifecycle.includes("overridden"), true);
  assert.equal(lifecycle.includes("passwordConfigured"), true);
  assert.equal(lifecycle.includes("apiKeyConfigured"), true);
});

test("revision history consumes the exact applied snapshot and rolls back with CAS", () => {
  assert.equal(revisions.includes("CREATE TABLE IF NOT EXISTS portal_settings_revisions"), true);
  assert.equal(revisions.includes("consumeApplyCommit"), true);
  assert.equal(revisions.includes('payload.applyCommitId'), true);
  assert.equal(revisions.includes('reason: "automatic_rollback"'), true);
  assert.equal(revisions.includes('code: "settings_post_apply_health_failed"'), true);
  assert.equal(revisions.includes('code: "settings_rollback_conflict"'), true);
  assert.equal(revisions.includes('DELETE FROM app_settings WHERE id = ? AND updated_at = ?'), true);
  assert.equal(revisions.includes('UPDATE app_settings SET config_json = ?, encrypted_secrets = ?, updated_at = ? WHERE id = ? AND updated_at = ?'), true);
  assert.equal(revisions.includes("function publicConfig(configJson: string)"), true);
  assert.equal(revisions.includes("encrypted_secrets TEXT NOT NULL"), true);
  assert.equal(revisions.includes("publicRevision(row)"), true);
});

test("visual wizard preserves failed validation details and cancels server drafts", () => {
  assert.equal(layout.includes("<SettingsLifecycleWizard />"), true);
  assert.equal(wizard.includes('api("/api/integrations/settings/drafts"'), true);
  assert.equal(wizard.includes('/validate`'), true);
  assert.equal(wizard.includes('/apply`'), true);
  assert.equal(wizard.includes('/cancel`'), true);
  assert.equal(wizard.includes("if (detail.payload?.draft) setDraft(detail.payload.draft)"), true);
  assert.equal(wizard.includes("Черновик → проверка → применение"), true);
  assert.equal(wizard.includes("SourceBadge"), true);
  assert.equal(styles.includes('html[data-settings-lifecycle-wizard="ready"] .settings-savebar'), true);
  assert.equal(wizard.includes('fetch("/api/integrations/settings", { method: "PUT"'), false);
});

test("rollback changes trigger Auth E2E", () => {
  assert.equal(workflow.includes('"worker/settings-lifecycle-entry.ts"'), true);
  assert.equal(workflow.includes('"worker/settings-revisions-entry.ts"'), true);
  assert.equal(workflow.includes('"app/SettingsLifecycleWizard.tsx"'), true);
});

test("settings lifecycle TypeScript parses under the repository Node baseline", () => {
  for (const url of [lifecycleUrl, revisionsUrl]) {
    const result = spawnSync(process.execPath, ["--experimental-strip-types", "--check", fileURLToPath(url)], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }
});
