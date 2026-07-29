import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const lifecycleUrl = new URL("../worker/settings-lifecycle-entry.ts", import.meta.url);
const revisionsUrl = new URL("../worker/settings-revisions-entry.ts", import.meta.url);
const lifecycle = fs.readFileSync(lifecycleUrl, "utf8");
const revisions = fs.readFileSync(revisionsUrl, "utf8");
const diagnostics = fs.readFileSync(new URL("../worker/diagnostics-entry.ts", import.meta.url), "utf8");
const localBoundary = fs.readFileSync(new URL("../worker/local-secure-entry.ts", import.meta.url), "utf8");
const authorization = fs.readFileSync(new URL("../admin-session-authorization.ts", import.meta.url), "utf8");
const wizard = fs.readFileSync(new URL("../app/SettingsLifecycleWizard.tsx", import.meta.url), "utf8");
const layout = fs.readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../app/settings-lifecycle.css", import.meta.url), "utf8");

test("settings lifecycle runs behind the existing local admin security boundary", () => {
  assert.equal(diagnostics.includes('import localRuntime from "./settings-revisions-entry"'), true);
  assert.equal(revisions.includes('import localRuntime from "./local-secure-entry"'), true);
  assert.equal(localBoundary.includes('import secureRuntime from "./settings-lifecycle-entry"'), true);
  assert.equal(authorization.includes('"/api/integrations/settings/effective"'), true);
  assert.equal(authorization.includes('"/api/integrations/settings/drafts"'), true);
  assert.equal(authorization.includes('"/api/integrations/settings/revisions"'), true);
  assert.equal(authorization.includes('pathname.startsWith("/api/integrations/settings/drafts/")'), true);
  assert.equal(localBoundary.includes("sameOriginAdminMutation(request)"), true);
  assert.equal(localBoundary.includes("headers.delete(\"x-admin-token\")"), true);
  assert.equal(revisions.includes('session?.role === "admin"'), true);
  assert.equal(revisions.includes('secretsMatch(request.headers.get("x-admin-token"), env.ADMIN_TOKEN)'), true);
  assert.equal(revisions.includes('request.headers.get("oai-authenticated-user-email")'), false);
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

test("revision history records safe snapshots and rolls back only the revision it applied", () => {
  assert.equal(revisions.includes("CREATE TABLE IF NOT EXISTS portal_settings_revisions"), true);
  assert.equal(revisions.includes('reason: "automatic_rollback"'), true);
  assert.equal(revisions.includes('code: "settings_post_apply_health_failed"'), true);
  assert.equal(revisions.includes('code: "settings_rollback_conflict"'), true);
  assert.equal(revisions.includes("currentAfterHealth?.revision !== after.revision"), true);
  assert.equal(revisions.includes('status = ?, updated_at = ? WHERE id = ?'), true);
  assert.equal(revisions.includes("encrypted_secrets TEXT NOT NULL"), true);
  assert.equal(revisions.includes("function publicConfig(configJson: string)"), true);
  assert.equal(revisions.includes("encryptedSecrets:"), true);
  assert.equal(revisions.includes("encrypted_secrets"), true);
  assert.equal(revisions.includes("publicRevision(row)"), true);
});

test("visual wizard enforces draft, validation and apply instead of direct settings writes", () => {
  assert.equal(layout.includes("<SettingsLifecycleWizard />"), true);
  assert.equal(wizard.includes('api("/api/integrations/settings/drafts"'), true);
  assert.equal(wizard.includes('/validate`'), true);
  assert.equal(wizard.includes('/apply`'), true);
  assert.equal(wizard.includes("Черновик → проверка → применение"), true);
  assert.equal(wizard.includes("SourceBadge"), true);
  assert.equal(styles.includes('html[data-settings-lifecycle-wizard="ready"] .settings-savebar'), true);
  assert.equal(wizard.includes('fetch("/api/integrations/settings", { method: "PUT"'), false);
});

test("settings lifecycle TypeScript parses under the repository Node baseline", () => {
  for (const url of [lifecycleUrl, revisionsUrl]) {
    const result = spawnSync(process.execPath, ["--experimental-strip-types", "--check", fileURLToPath(url)], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }
});
