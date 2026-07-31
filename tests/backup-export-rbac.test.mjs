import assert from "node:assert/strict";
import test from "node:test";

import worker from "../dist/server/index.js";
import { markSchemaTestBypass } from "../worker/schema-migrations-boundary.ts";

const assignments = JSON.stringify({
  "viewer@example.test": "viewer",
  "operator@example.test": "operator",
  "admin@example.test": "admin",
});

function request(email) {
  return new Request("https://dashboard.test/api/integrations/status", {
    headers: { "oai-authenticated-user-email": email },
  });
}

const env = markSchemaTestBypass({
  DEMO_MODE: "true",
  PORTAL_IDENTITY_MODE: "workspace",
  PORTAL_DEFAULT_ROLE: "viewer",
  PORTAL_RBAC_JSON: assignments,
});

test("backup.export is granted only to the default admin role", async () => {
  const viewer = await (await worker.fetch(request("viewer@example.test"), env, {})).json();
  const operator = await (await worker.fetch(request("operator@example.test"), env, {})).json();
  const admin = await (await worker.fetch(request("admin@example.test"), env, {})).json();

  assert.equal(viewer.access.permissions.includes("backup.export"), false);
  assert.equal(operator.access.permissions.includes("backup.export"), false);
  assert.equal(admin.access.permissions.includes("backup.export"), true);
});
