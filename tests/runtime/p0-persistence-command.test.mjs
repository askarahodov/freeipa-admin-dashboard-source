import assert from "node:assert/strict";
import test from "node:test";

import { buildP0DashboardPersistenceCommand } from "../../scripts/p0-persistence-command.mjs";

const input = {
  composeFile: "compose.yaml",
  composeEnvFile: ".env.acceptance",
  composeService: "dashboard",
};

test("P0 persistence restart command targets only the configured dashboard service", () => {
  assert.deepEqual(buildP0DashboardPersistenceCommand({ ...input, action: "restart" }), {
    command: "docker",
    args: ["compose", "--env-file", ".env.acceptance", "-f", "compose.yaml", "restart", "dashboard"],
  });
});

test("P0 persistence recreate command preserves the image and named volume contract", () => {
  assert.deepEqual(buildP0DashboardPersistenceCommand({ ...input, action: "recreate" }), {
    command: "docker",
    args: [
      "compose",
      "--env-file",
      ".env.acceptance",
      "-f",
      "compose.yaml",
      "up",
      "-d",
      "--no-deps",
      "--no-build",
      "--force-recreate",
      "dashboard",
    ],
  });
});

test("P0 persistence command fails closed for unknown action or unsafe service name", () => {
  assert.throws(
    () => buildP0DashboardPersistenceCommand({ ...input, action: "remove" }),
    /p0_persistence_action_invalid/u,
  );
  assert.throws(
    () => buildP0DashboardPersistenceCommand({ ...input, action: "restart", composeService: "--all" }),
    /p0_persistence_compose_service_invalid/u,
  );
});
