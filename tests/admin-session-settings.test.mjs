import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const authorization = fs.readFileSync(new URL("../admin-session-authorization.ts", import.meta.url), "utf8");
const runtime = fs.readFileSync(new URL("../worker/local-secure-entry.ts", import.meta.url), "utf8");
const selectiveRoot = fs.readFileSync(new URL("../worker/backup-selective-restore-root-entry.ts", import.meta.url), "utf8");
const maintenanceControlRoot = fs.readFileSync(new URL("../worker/maintenance-control-root-entry.ts", import.meta.url), "utf8");
const serviceRoot = fs.readFileSync(new URL("../worker/service-admin-root-entry.ts", import.meta.url), "utf8");
const maintenanceGate = fs.readFileSync(new URL("../worker/maintenance-mode-root-entry.ts", import.meta.url), "utf8");
const schemaRoot = fs.readFileSync(new URL("../worker/schema-migrations-entry.ts", import.meta.url), "utf8");
const viteConfig = fs.readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
const bridge = fs.readFileSync(new URL("../app/LocalAdminSessionBridge.tsx", import.meta.url), "utf8");
const layout = fs.readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../app/local-admin-session.css", import.meta.url), "utf8");

const protectedPaths = [
  "/api/integrations/settings",
  "/api/integrations/settings/test",
  "/api/integrations/catalog/presentation",
  "/api/integrations/catalog/policies",
  "/api/integrations/approval/policies",
  "/api/integrations/routes",
  "/api/integrations/catalog/sync",
  "/api/admin/backups/import/encrypted/prepare-commit",
  "/api/admin/backups/import/encrypted/commit",
  "/api/admin/backups/import/encrypted/cancel",
  "/api/admin/maintenance/status",
  "/api/admin/maintenance/prepare",
  "/api/admin/maintenance/enter",
  "/api/admin/maintenance/verification/start",
  "/api/admin/maintenance/exit",
  "/api/admin/maintenance/complete",
  "/api/admin/maintenance/cancel",
];

test("all administrative settings restore and maintenance endpoints use the shared session authorization boundary", () => {
  for (const path of protectedPaths) assert.equal(authorization.includes(`"${path}"`), true, path);
  assert.equal(runtime.includes("isAdminIntegrationPath(url.pathname)"), true);
  assert.equal(runtime.includes('headers.delete("x-admin-token")'), true);
  assert.equal(runtime.includes('headers.set("x-admin-token", internalToken)'), true);
  assert.equal(runtime.includes("delegatedEnv(sourceEnv, session, internalToken)"), true);
});

test("local session mutations require same-origin while service token access stays behind the maintenance gate", () => {
  assert.equal(authorization.includes('request.headers.get("origin")'), true);
  assert.equal(authorization.includes("new URL(origin).origin === new URL(request.url).origin"), true);
  assert.equal(runtime.includes("sameOriginAdminMutation(request)"), true);
  assert.equal(runtime.includes("service-admin@portal.local"), true);
  assert.equal(viteConfig.includes('main: "./worker/schema-migrations-entry.ts"'), true);
  assert.equal(schemaRoot.includes('import rootRuntime from "./maintenance-mode-root-entry.ts"'), true);
  assert.equal(maintenanceGate.includes('import rootRuntime from "./service-admin-root-entry.ts"'), true);
  assert.equal(serviceRoot.includes("serviceAdminTokenAuthorized(request, sourceEnv.ADMIN_TOKEN)"), true);
  assert.equal(serviceRoot.includes('PORTAL_IDENTITY_MODE: "static"'), true);
  assert.equal(serviceRoot.includes('import rootRuntime from "./maintenance-control-root-entry.ts"'), true);
  assert.equal(maintenanceControlRoot.includes('import rootRuntime from "./backup-selective-restore-root-entry.ts"'), true);
  assert.equal(selectiveRoot.includes('import rootRuntime from "./freeipa-group-member-entry.ts"'), true);
  assert.equal(serviceRoot.includes("resolveLocalSession"), false);
  assert.equal(serviceRoot.includes("env.DB"), false);
});

test("settings UI initializes only after the local admin session is verified", () => {
  assert.equal(layout.includes("__local_admin_session__"), false);
  assert.equal(layout.includes("local-admin-session-bootstrap"), false);
  assert.equal(layout.includes("<LocalAdminSessionBridge />"), true);
  assert.equal(bridge.includes('fetch("/api/auth/session"'), true);
  assert.equal(bridge.includes("new MutationObserver"), true);
  assert.equal(bridge.includes("window.location.reload()"), true);
  assert.equal(bridge.includes('dataset.portalAdminAuthorization = "session"'), true);
  assert.equal(bridge.includes("Повторный ADMIN_TOKEN не требуется"), true);
  assert.equal(styles.includes(".settings-access > label"), true);
  assert.equal(styles.includes(".settings-access {\n  display: none"), false);
  assert.equal(styles.includes(".policy-toolbar > label"), true);
  assert.equal(styles.includes(".route-editor > label:last-of-type"), true);
});

test("the browser bridge never receives or reads the configured service token", () => {
  assert.equal(bridge.includes("x-admin-token"), false);
  assert.equal(bridge.includes("ADMIN_TOKEN="), false);
  assert.equal(bridge.includes("process.env"), false);
  assert.equal(authorization.includes("LOCAL_ADMIN_SESSION_MARKER"), true);
});
