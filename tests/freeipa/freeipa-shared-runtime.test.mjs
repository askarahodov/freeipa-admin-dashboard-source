import assert from "node:assert/strict";
import test from "node:test";

import { operationRun, saveOperationRun } from "../../worker/operation-run-runtime.ts";
import { portalAccess, requirePortalPermission } from "../../worker/portal-access-runtime.ts";

function request(identity = "operator@example.test") {
  return new Request("https://portal.test/api/integrations/freeipa/actions", {
    headers: {
      "oai-authenticated-user-email": identity,
      "oai-authenticated-user-groups": "ops,security,ops",
    },
  });
}

test("shared portal access preserves canonical role permissions and denial envelope", async () => {
  const env = {
    PORTAL_DEFAULT_ROLE: "viewer",
    PORTAL_RBAC_JSON: JSON.stringify({ "operator@example.test": "operator" }),
  };
  const access = portalAccess(request(), env);
  assert.deepEqual(access, {
    identity: "operator@example.test",
    role: "operator",
    groups: ["ops", "security"],
    permissions: ["directory.read", "freeipa.write", "xyops.run"],
  });
  assert.equal(requirePortalPermission(request(), env, "freeipa.write"), null);
  const denied = requirePortalPermission(request(), env, "freeipa.delete");
  assert.ok(denied instanceof Response);
  assert.equal(denied.status, 403);
  assert.deepEqual(await denied.json(), {
    error: "Недостаточно прав для выполнения операции",
    requiredPermission: "freeipa.delete",
    role: "operator",
  });
});

test("shared operation runtime persists the legacy operation_runs shape without FreeIPA notifications", async () => {
  const writes = [];
  const DB = {
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async run() {
              writes.push({ sql, values });
              return { success: true };
            },
          };
        },
      };
    },
  };
  const run = operationRun({
    request: request("admin@example.test"),
    eventId: "freeipa:user_disable",
    title: "Отключение пользователя FreeIPA",
    kind: "event",
    mode: "demo",
    jobId: "IPA-DEMO-1",
    status: "success",
    values: { uid: "alice" },
  });
  await saveOperationRun({ DB }, run);
  assert.equal(writes.length, 1, "FreeIPA runs must not create XYOps notifications");
  assert.match(writes[0].sql, /^INSERT INTO operation_runs/);
  assert.equal(writes[0].values[0], run.id);
  assert.equal(writes[0].values[1], "IPA-DEMO-1");
  assert.equal(writes[0].values[2], "freeipa:user_disable");
  assert.equal(writes[0].values[7], "admin@example.test");
  assert.equal(writes[0].values[8], "alice");
});
