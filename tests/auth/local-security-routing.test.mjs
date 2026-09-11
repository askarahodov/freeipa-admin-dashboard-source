import assert from "node:assert/strict";
import test from "node:test";

import { handleLocalSecurityRouting } from "../../worker/middleware/local-security-routing.ts";
import { STORAGE_INTEGRITY_PATH } from "../../src/storage/integrity/storage-integrity-contract.ts";
import { STORAGE_MIGRATION_PREFLIGHT_PATH } from "../../src/storage/migration/preflight/storage-migration-preflight-contract.ts";

const expectedToken = "fixture-admin-token";
const wrongToken = "fixture-wrong-token";
const localEnv = Object.freeze({
  PORTAL_IDENTITY_MODE: "local",
  ADMIN_TOKEN: expectedToken,
  untouched: "kept",
});
const staticEnv = Object.freeze({
  PORTAL_IDENTITY_MODE: "static",
  ADMIN_TOKEN: expectedToken,
  untouched: "kept",
});
const ctx = Object.freeze({ marker: "ctx" });
const viewerSession = Object.freeze({
  userId: "viewer-id",
  identity: "viewer@portal.local",
  displayName: "Viewer",
  role: "viewer",
  expiresAt: 2_000_000_000_000,
});
const adminSession = Object.freeze({
  userId: "admin-id",
  identity: "admin@portal.local",
  displayName: "Administrator",
  role: "admin",
  expiresAt: 2_000_000_000_000,
});

function request(path, { method = "GET", token, origin, accept } = {}) {
  const headers = new Headers();
  if (token !== undefined) headers.set("x-admin-token", token);
  if (origin !== undefined) headers.set("origin", origin);
  if (accept !== undefined) headers.set("accept", accept);
  return new Request(`https://portal.test${path}`, { method, headers });
}

function harness(overrides = {}) {
  const calls = [];
  const dependencies = {
    async resolveSession(env, req) {
      calls.push(["resolveSession", env, req]);
      return null;
    },
    async handleAuthApi(req, env, url) {
      calls.push(["auth", req, env, url.pathname]);
      return new Response("auth", { status: 209 });
    },
    async handleStorageMigrationPreflight(req, env) {
      calls.push(["preflight", req, env]);
      return null;
    },
    async handleStorageIntegrity(req, env) {
      calls.push(["integrity", req, env]);
      return null;
    },
    async handleStorageStatus(req, env) {
      calls.push(["status", req, env]);
      return null;
    },
    async nextFetch(req, env, runtimeContext) {
      calls.push(["next", req, env, runtimeContext]);
      return new Response("next", { status: 208 });
    },
    ...overrides,
  };
  return { calls, dependencies };
}

async function payload(response) {
  return response.json();
}

test("non-local storage preflight fails closed without a valid service token", async () => {
  const { calls, dependencies } = harness();
  const req = request(STORAGE_MIGRATION_PREFLIGHT_PATH, { token: wrongToken });
  const response = await handleLocalSecurityRouting(req, staticEnv, ctx, dependencies);

  assert.equal(response.status, 401);
  assert.deepEqual(await payload(response), { error: "Требуется токен администратора" });
  assert.deepEqual(calls, []);
});

test("non-local storage preflight preserves service-admin adaptation and request identity", async () => {
  let observed;
  const { dependencies } = harness({
    async handleStorageMigrationPreflight(req, env) {
      observed = { req, env };
      return new Response("preflight", { status: 207 });
    },
  });
  const req = request(STORAGE_MIGRATION_PREFLIGHT_PATH, { token: expectedToken });
  const response = await handleLocalSecurityRouting(req, staticEnv, ctx, dependencies);

  assert.equal(response.status, 207);
  assert.equal(observed.req, req);
  assert.equal(observed.env.PORTAL_IDENTITY_MODE, "static");
  assert.equal(observed.env.PORTAL_STATIC_IDENTITY, "service-admin@portal.local");
  assert.equal(observed.env.PORTAL_DEFAULT_ROLE, "admin");
  assert.equal(observed.env.untouched, "kept");
  assert.equal(staticEnv.PORTAL_STATIC_IDENTITY, undefined);
});

test("non-local ordinary traffic delegates with exact request env and context identities", async () => {
  const { calls, dependencies } = harness();
  const req = request("/api/integrations/catalog");
  const response = await handleLocalSecurityRouting(req, staticEnv, ctx, dependencies);
  const next = calls.find(([name]) => name === "next");

  assert.equal(response.status, 208);
  assert.equal(next[1], req);
  assert.equal(next[2], staticEnv);
  assert.equal(next[3], ctx);
});

test("local auth API dispatch remains ahead of ordinary session resolution", async () => {
  const { calls, dependencies } = harness({
    async resolveSession() {
      throw new Error("session resolution must not run before /api/auth handler");
    },
  });
  const req = request("/api/auth/users", { method: "POST", origin: "https://portal.test" });
  const response = await handleLocalSecurityRouting(req, localEnv, ctx, dependencies);

  assert.equal(response.status, 209);
  assert.equal(calls[0][0], "auth");
});

test("integration health bypasses local session resolution unchanged", async () => {
  const { calls, dependencies } = harness({
    async resolveSession() {
      throw new Error("integration health must stay outside local session resolution");
    },
  });
  const req = request("/api/integrations/health");
  const response = await handleLocalSecurityRouting(req, localEnv, ctx, dependencies);
  const next = calls.find(([name]) => name === "next");

  assert.equal(response.status, 208);
  assert.equal(next[1], req);
  assert.equal(next[2], localEnv);
  assert.equal(next[3], ctx);
});

test("missing or stale local session denies ordinary API before downstream", async () => {
  const { calls, dependencies } = harness();
  const req = request("/api/integrations/catalog");
  const response = await handleLocalSecurityRouting(req, localEnv, ctx, dependencies);

  assert.equal(response.status, 401);
  assert.deepEqual(await payload(response), { error: "Требуется вход в портал" });
  assert.equal(calls.some(([name]) => name === "next"), false);
});

test("missing local session keeps allowlisted service-admin fallback narrow", async () => {
  let next;
  const { dependencies } = harness({
    async nextFetch(req, env, runtimeContext) {
      next = { req, env, runtimeContext };
      return new Response("next", { status: 208 });
    },
  });
  const req = request("/api/integrations/settings", { token: expectedToken });
  const response = await handleLocalSecurityRouting(req, localEnv, ctx, dependencies);

  assert.equal(response.status, 208);
  assert.equal(next.req, req);
  assert.equal(next.runtimeContext, ctx);
  assert.equal(next.env.PORTAL_STATIC_IDENTITY, "service-admin@portal.local");
  assert.equal(next.env.PORTAL_DEFAULT_ROLE, "admin");
  assert.equal(next.env.PORTAL_IDENTITY_MODE, "static");
  assert.equal(next.env.untouched, "kept");
  assert.equal(localEnv.PORTAL_STATIC_IDENTITY, undefined);

  const denied = await handleLocalSecurityRouting(
    request("/api/integrations/catalog", { token: expectedToken }),
    localEnv,
    ctx,
    harness().dependencies,
  );
  assert.equal(denied.status, 401, "valid token must not become a universal API bypass");
});

test("missing local session keeps browser redirect and anonymous fallback contracts", async () => {
  const html = request("/settings?tab=access", { accept: "text/html" });
  const htmlResponse = await handleLocalSecurityRouting(html, localEnv, ctx, harness().dependencies);
  assert.equal(htmlResponse.status, 302);
  assert.equal(new URL(htmlResponse.headers.get("location")).pathname, "/login");
  assert.equal(new URL(htmlResponse.headers.get("location")).searchParams.get("next"), "/settings?tab=access");

  let next;
  const { dependencies } = harness({
    async nextFetch(req, env, runtimeContext) {
      next = { req, env, runtimeContext };
      return new Response("asset", { status: 200 });
    },
  });
  const asset = request("/assets/app.css");
  const assetResponse = await handleLocalSecurityRouting(asset, localEnv, ctx, dependencies);
  assert.equal(assetResponse.status, 200);
  assert.equal(next.req, asset);
  assert.equal(next.runtimeContext, ctx);
  assert.equal(next.env.PORTAL_IDENTITY_MODE, "anonymous");
  assert.equal(next.env.PORTAL_DEFAULT_ROLE, "viewer");
  assert.equal(localEnv.PORTAL_IDENTITY_MODE, "local");
});

test("authenticated viewer delegation strips caller admin token and preserves canonical identity", async () => {
  let next;
  const { dependencies } = harness({
    async resolveSession() {
      return viewerSession;
    },
    async nextFetch(req, env, runtimeContext) {
      next = { req, env, runtimeContext };
      return new Response("next", { status: 208 });
    },
  });
  const req = request("/api/integrations/catalog", { token: "caller-controlled" });
  const response = await handleLocalSecurityRouting(req, localEnv, ctx, dependencies);

  assert.equal(response.status, 208);
  assert.notEqual(next.req, req, "authenticated delegation must use a sanitized Request clone");
  assert.equal(next.req.headers.get("x-admin-token"), null);
  assert.equal(next.runtimeContext, ctx);
  assert.equal(next.env.PORTAL_STATIC_IDENTITY, viewerSession.identity);
  assert.equal(next.env.PORTAL_STATIC_NAME, viewerSession.displayName);
  assert.equal(next.env.PORTAL_DEFAULT_ROLE, "viewer");
  assert.deepEqual(JSON.parse(next.env.PORTAL_RBAC_JSON), { [viewerSession.identity]: "viewer" });
});

test("admin integration mutation checks origin after session resolution and before internal token delegation", async () => {
  let resolveCount = 0;
  let nextCount = 0;
  const { dependencies } = harness({
    async resolveSession() {
      resolveCount += 1;
      return adminSession;
    },
    async nextFetch() {
      nextCount += 1;
      return new Response("next");
    },
  });
  const req = request("/api/integrations/settings", {
    method: "POST",
    token: "caller-controlled",
    origin: "https://evil.test",
  });
  const response = await handleLocalSecurityRouting(req, localEnv, ctx, dependencies);

  assert.equal(resolveCount, 1);
  assert.equal(response.status, 403);
  assert.deepEqual(await payload(response), { error: "Административный запрос заблокирован проверкой источника" });
  assert.equal(nextCount, 0);
});

test("same-origin admin integration derives internal token only after valid session proof", async () => {
  let next;
  const { dependencies } = harness({
    async resolveSession() {
      return adminSession;
    },
    async nextFetch(req, env, runtimeContext) {
      next = { req, env, runtimeContext };
      return new Response("next", { status: 208 });
    },
  });
  const req = request("/api/integrations/settings", {
    method: "POST",
    token: "caller-controlled",
    origin: "https://portal.test",
  });
  const response = await handleLocalSecurityRouting(req, localEnv, ctx, dependencies);
  const expectedInternalToken = `local-session:${adminSession.userId}:${adminSession.expiresAt}`;

  assert.equal(response.status, 208);
  assert.equal(next.runtimeContext, ctx);
  assert.equal(next.req.headers.get("x-admin-token"), expectedInternalToken);
  assert.equal(next.env.ADMIN_TOKEN, expectedInternalToken);
  assert.equal(next.env.PORTAL_STATIC_IDENTITY, adminSession.identity);
  assert.equal(next.env.PORTAL_DEFAULT_ROLE, "admin");
  assert.equal(req.headers.get("x-admin-token"), "caller-controlled", "source request must remain immutable");
  assert.equal(localEnv.ADMIN_TOKEN, expectedToken, "source environment must remain immutable");
});

test("authenticated storage integrity dispatch preserves sanitized request and delegated role", async () => {
  let observed;
  const { dependencies } = harness({
    async resolveSession() {
      return viewerSession;
    },
    async handleStorageIntegrity(req, env) {
      observed = { req, env };
      return new Response("integrity", { status: 207 });
    },
  });
  const req = request(STORAGE_INTEGRITY_PATH, { token: "caller-controlled" });
  const response = await handleLocalSecurityRouting(req, localEnv, ctx, dependencies);

  assert.equal(response.status, 207);
  assert.notEqual(observed.req, req);
  assert.equal(observed.req.headers.get("x-admin-token"), null);
  assert.equal(observed.env.PORTAL_DEFAULT_ROLE, "viewer");
  assert.equal(observed.env.PORTAL_STATIC_IDENTITY, viewerSession.identity);
});
