import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { sameOriginAdminMutation } from "../src/auth/admin-session-authorization.ts";

const runtime = fs.readFileSync(new URL("../worker/local-secure-entry.ts", import.meta.url), "utf8");
const sessionRuntime = fs.readFileSync(new URL("../worker/session-management-entry.ts", import.meta.url), "utf8");

function authHandlerSource() {
  const start = runtime.indexOf("async function handleAuthApi");
  const end = runtime.indexOf("\nconst worker =", start);
  assert.ok(start >= 0 && end > start, "handleAuthApi source must be present");
  return runtime.slice(start, end);
}

function request(method, origin) {
  const headers = new Headers();
  if (origin !== undefined) headers.set("origin", origin);
  return new Request("https://portal.example/api/auth/users", { method, headers });
}

test("same-origin helper fails closed for missing malformed and mismatched mutation origins", () => {
  assert.equal(sameOriginAdminMutation(request("POST", undefined)), false);
  assert.equal(sameOriginAdminMutation(request("POST", "not a url")), false);
  assert.equal(sameOriginAdminMutation(request("POST", "https://evil.example")), false);
  assert.equal(sameOriginAdminMutation(request("POST", "https://portal.example")), true);
  assert.equal(sameOriginAdminMutation(request("GET", undefined)), true);
});

test("same-origin comparison uses the request URL origin and does not trust forwarded host headers", () => {
  const headers = new Headers({
    origin: "https://proxy.example",
    "x-forwarded-host": "proxy.example",
    "x-forwarded-proto": "https",
  });
  const proxied = new Request("https://portal.example/api/auth/users", { method: "POST", headers });
  assert.equal(sameOriginAdminMutation(proxied), false);
});

test("local-auth login remains outside the authenticated mutation origin gate", () => {
  const source = authHandlerSource();
  const login = source.indexOf('url.pathname === "/api/auth/login"');
  const guard = source.indexOf("!sameOriginAdminMutation(request)");
  const logout = source.indexOf('url.pathname === "/api/auth/logout"');
  const admin = source.indexOf("const current = await requireAdmin(env, request)");

  assert.ok(login >= 0, "login route must exist");
  assert.ok(guard > login, "origin gate must run after credential login");
  assert.ok(logout > guard, "logout mutation must be protected by origin gate");
  assert.ok(admin > guard, "administrative local-auth mutations must cross the gate before authorization");
  assert.match(source, /Административный local-auth запрос заблокирован проверкой источника/);
});

test("protected local-auth surface includes user, password and per-user session mutations", () => {
  const source = authHandlerSource();
  assert.match(source, /url\.pathname === "\/api\/auth\/users"/);
  assert.match(source, /request\.method === "POST"/);
  assert.match(source, /action === "password" && request\.method === "POST"/);
  assert.match(source, /action === "sessions" && request\.method === "DELETE"/);
  assert.match(source, /!action && request\.method === "PUT"/);
  assert.match(source, /!action && request\.method === "DELETE"/);
});

test("administrative session revocation has an explicit same-origin boundary", () => {
  const match = sessionRuntime.indexOf('url.pathname.match(/^\\/api\\/auth\\/sessions');
  const deleteMethod = sessionRuntime.indexOf('request.method !== "DELETE"', match);
  const guard = sessionRuntime.indexOf("!sameOriginAdminMutation(request)", deleteMethod);
  const revoke = sessionRuntime.indexOf("revokeLocalPortalSession(env, match[1])", guard);
  assert.ok(match >= 0, "session revocation route must exist");
  assert.ok(deleteMethod > match && guard > deleteMethod, "DELETE session route must cross same-origin gate");
  assert.ok(revoke > guard, "session revocation must happen only after same-origin authorization");
});
