import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const authorization = fs.readFileSync(new URL("../admin-session-authorization.ts", import.meta.url), "utf8");
const runtime = fs.readFileSync(new URL("../worker/local-secure-entry.ts", import.meta.url), "utf8");
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
];

test("all administrative settings endpoints use the shared session authorization boundary", () => {
  for (const path of protectedPaths) assert.equal(authorization.includes(`"${path}"`), true, path);
  assert.equal(runtime.includes("isAdminIntegrationPath(url.pathname)"), true);
  assert.equal(runtime.includes("headers.delete(\"x-admin-token\")"), true);
  assert.equal(runtime.includes("headers.set(\"x-admin-token\", internalToken)"), true);
  assert.equal(runtime.includes("delegatedEnv(sourceEnv, session, internalToken)"), true);
});

test("local session mutations require same-origin while service token access stays available", () => {
  assert.equal(authorization.includes('request.headers.get("origin")'), true);
  assert.equal(authorization.includes("new URL(origin).origin === new URL(request.url).origin"), true);
  assert.equal(runtime.includes("sameOriginAdminMutation(request)"), true);
  assert.equal(runtime.includes("serviceAdminTokenAuthorized(request, sourceEnv.ADMIN_TOKEN)"), true);
  assert.equal(runtime.includes("service-admin@portal.local"), true);
});

test("settings UI uses a non-secret session marker and hides token fields for local admins", () => {
  assert.equal(layout.includes("__local_admin_session__"), true);
  assert.equal(layout.includes("<LocalAdminSessionBridge />"), true);
  assert.equal(bridge.includes('fetch("/api/auth/session"'), true);
  assert.equal(bridge.includes('data.portalAdminAuthorization = "session"'), true);
  assert.equal(bridge.includes("Повторный ADMIN_TOKEN не требуется"), true);
  assert.equal(styles.includes('html[data-portal-admin-authorization="session"] .settings-access'), true);
  assert.equal(styles.includes(".policy-toolbar > label"), true);
  assert.equal(styles.includes(".route-editor > label:last-of-type"), true);
});

test("the browser bridge never receives or reads the configured service token", () => {
  assert.equal(bridge.includes("x-admin-token"), false);
  assert.equal(bridge.includes("ADMIN_TOKEN="), false);
  assert.equal(bridge.includes("process.env"), false);
  assert.equal(authorization.includes("LOCAL_ADMIN_SESSION_MARKER"), true);
});
