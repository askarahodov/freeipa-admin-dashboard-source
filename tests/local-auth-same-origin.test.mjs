import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const authorization = fs.readFileSync(new URL("../admin-session-authorization.ts", import.meta.url), "utf8");
const runtime = fs.readFileSync(new URL("../worker/local-secure-entry.ts", import.meta.url), "utf8");

function authHandlerSource() {
  const start = runtime.indexOf("async function handleAuthApi");
  const end = runtime.indexOf("\nconst worker =", start);
  assert.ok(start >= 0 && end > start, "handleAuthApi source must be present");
  return runtime.slice(start, end);
}

test("same-origin helper distinguishes browser provenance from non-browser clients", () => {
  assert.match(authorization, /request\.headers\.get\("origin"\)/);
  assert.match(authorization, /request\.headers\.get\("referer"\)/);
  assert.match(authorization, /new URL\(origin\)\.origin === requestOrigin/);
  assert.match(authorization, /new URL\(referer\)\.origin === requestOrigin/);
  assert.match(authorization, /Non-browser API\/service clients commonly omit both browser provenance headers[\s\S]*return true;/);
});

test("local-auth login remains outside the administrative same-origin mutation gate", () => {
  const source = authHandlerSource();
  const login = source.indexOf('url.pathname === "/api/auth/login"');
  const guard = source.indexOf("!sameOriginAdminMutation(request)");
  const logout = source.indexOf('url.pathname === "/api/auth/logout"');
  const admin = source.indexOf("const current = await requireAdmin(env, request)");

  assert.ok(login >= 0, "login route must exist");
  assert.ok(guard > login, "same-origin gate must run after credential login");
  assert.ok(logout > guard, "logout mutation must be protected by same-origin gate");
  assert.ok(admin > guard, "all administrative local-auth mutations must cross the gate before authorization");
  assert.match(source, /Административный local-auth запрос заблокирован проверкой источника/);
});

test("protected local-auth surface includes user, password and session mutations", () => {
  const source = authHandlerSource();
  assert.match(source, /url\.pathname === "\/api\/auth\/users"/);
  assert.match(source, /request\.method === "POST"/);
  assert.match(source, /action === "password" && request\.method === "POST"/);
  assert.match(source, /action === "sessions" && request\.method === "DELETE"/);
  assert.match(source, /!action && request\.method === "PUT"/);
  assert.match(source, /!action && request\.method === "DELETE"/);
});
