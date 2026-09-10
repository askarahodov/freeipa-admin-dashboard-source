import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("secure entry creates canonical context only after mechanism trust resolution", async () => {
  const source = await readFile(new URL("../../worker/secure-entry.ts", import.meta.url), "utf8");

  assert.match(source, /import \{ resolvedAuthRequestContext \} from "\.\.\/src\/auth\/resolved-auth-request-context\.ts";/u);
  assert.match(source, /const securedRequest = new Request\(request, \{ headers \}\);/u);
  assert.match(source, /identity && mode !== "anonymous"\s*\? resolvedAuthRequestContext\(\{/u);
  assert.match(source, /role: requestRole\(securedRequest, env\),/u);
  assert.match(source, /authMode: mode,/u);

  const trustIndex = source.indexOf("const trusted = await secretsMatch");
  const contextIndex = source.indexOf("? resolvedAuthRequestContext({");
  assert.ok(trustIndex >= 0 && contextIndex > trustIndex, "proxy trust verification must happen before canonical context creation");
});

test("secure entry reuses canonical identity and correlation only for audit metadata", async () => {
  const source = await readFile(new URL("../../worker/secure-entry.ts", import.meta.url), "utf8");

  assert.match(source, /requestContext\s*\? createAuditContext\(\{ identity: requestContext\.identity, role: requestContext\.role, groups: \[\.\.\.requestContext\.groups\] \}, requestContext\.correlationId\)/u);
  assert.match(source, /if \(requestRole\(request, env\) !== "admin"\)/u);
  assert.match(source, /if \(!env\.ADMIN_TOKEN \|\| !await secretsMatch\(request\.headers\.get\("x-admin-token"\), env\.ADMIN_TOKEN\)\)/u);
  assert.match(source, /return runtime\.fetch\(secured\.request, secured\.env, ctx\);/u);

  const roleGate = source.indexOf('if (requestRole(request, env) !== "admin")');
  const tokenGate = source.indexOf('if (!env.ADMIN_TOKEN || !await secretsMatch');
  const auditUse = source.indexOf("const audit = requestContext");
  assert.ok(roleGate >= 0 && tokenGate > roleGate && auditUse > tokenGate, "existing role and service-admin token gates must remain before audit context use");
});

test("anonymous or failed identity resolution keeps the existing fail-closed path", async () => {
  const source = await readFile(new URL("../../worker/secure-entry.ts", import.meta.url), "utf8");

  assert.match(source, /if \(!identity\) \{\s*env\.PORTAL_DEFAULT_ROLE = "viewer";\s*env\.PORTAL_RBAC_JSON = anonymousRbac\(sourceEnv\.PORTAL_RBAC_JSON\);\s*\}/u);
  assert.match(source, /: null;/u);
});
