import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  handleBackupHttpRequest,
  SANITIZED_BACKUP_EXPORT_PATH,
} from "../../worker/backup-http-entry.ts";

const assignments = JSON.stringify({
  "viewer@example.test": "viewer",
  "admin@example.test": "admin",
});

const env = {
  PORTAL_DEFAULT_ROLE: "viewer",
  PORTAL_RBAC_JSON: assignments,
};

function request(identity, method = "POST", path = SANITIZED_BACKUP_EXPORT_PATH) {
  return new Request(`https://dashboard.test${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "oai-authenticated-user-email": identity,
    },
    body: method === "POST" ? JSON.stringify({ domains: ["settings"] }) : undefined,
  });
}

test("sanitized backup owner fails closed before invoking the export handler", async () => {
  let invoked = false;
  const response = await handleBackupHttpRequest(
    request("viewer@example.test"),
    env,
    {
      exportHandler: async () => {
        invoked = true;
        return new Response("unexpected", { status: 200 });
      },
    },
  );

  assert.equal(response?.status, 403);
  assert.equal(invoked, false);
  assert.equal((await response.json()).requiredPermission, "backup.export");
});

test("sanitized backup owner preserves admin identity in the audit context", async () => {
  let observed = null;
  const response = await handleBackupHttpRequest(
    request("admin@example.test"),
    env,
    {
      exportHandler: async (_request, _env, context) => {
        observed = context;
        return new Response(JSON.stringify({ ok: true }), {
          status: 202,
          headers: { "content-type": "application/json" },
        });
      },
    },
  );

  assert.equal(response?.status, 202);
  assert.equal(observed?.actor.identity, "admin@example.test");
  assert.equal(observed?.actor.role, "admin");
});

test("sanitized backup owner preserves method handling and unrelated-route passthrough", async () => {
  const methodResponse = await handleBackupHttpRequest(request("admin@example.test", "GET"), env);
  assert.equal(methodResponse?.status, 405);
  assert.equal((await methodResponse.json()).code, "backup_method_not_allowed");

  const unrelated = await handleBackupHttpRequest(
    request("admin@example.test", "GET", "/api/integrations/status"),
    env,
  );
  assert.equal(unrelated, null);
});

test("#634A gives sanitized export one post-security HTTP owner", () => {
  const ownerUrl = new URL("../../worker/backup-http-entry.ts", import.meta.url);
  const secureUrl = new URL("../../worker/secure-entry.ts", import.meta.url);
  const centralUrl = new URL("../../worker/index.ts", import.meta.url);
  const routesUrl = new URL("../../src/auth/portal-route-contract.ts", import.meta.url);

  const owner = fs.readFileSync(ownerUrl, "utf8");
  const secure = fs.readFileSync(secureUrl, "utf8");
  const central = fs.readFileSync(centralUrl, "utf8");
  const routes = fs.readFileSync(routesUrl, "utf8");

  assert.equal(secure.includes('import runtime from "./backup-http-entry.ts"'), true);
  assert.equal(owner.includes('import runtime from "./freeipa-http-entry.ts"'), true);
  assert.equal(owner.includes('requirePortalPermission(request, env, "backup.export")'), true);
  assert.equal(owner.includes("createAuditContext"), true);
  assert.equal(central.includes('url.pathname === "/api/admin/backups/export"'), false);
  assert.equal(central.includes('handleBackupExportRequest'), false);
  assert.match(routes, /id: "backup\.export\.sanitized".*owner: "worker\/backup-http-entry\.ts"/);

  for (const url of [ownerUrl, secureUrl, centralUrl]) {
    const result = spawnSync(process.execPath, ["--experimental-strip-types", "--check", fileURLToPath(url)], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }
});
