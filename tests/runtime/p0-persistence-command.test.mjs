import assert from "node:assert/strict";
import test from "node:test";

import { buildP0DashboardPersistenceCommand } from "../../scripts/p0-persistence-command.mjs";

const digest = `sha256:${"e".repeat(64)}`;
const image = `registry.example.test/admin-dashboard@${digest}`;
const input = {
  composeFile: "compose.yaml",
  composeEnvFile: ".env.acceptance",
  composeService: "dashboard",
};

test("P0 persistence restart keeps legacy local-project behavior when no release image is supplied", () => {
  assert.deepEqual(buildP0DashboardPersistenceCommand({ ...input, action: "restart" }), {
    command: "docker",
    args: ["compose", "--env-file", ".env.acceptance", "-f", "compose.yaml", "restart", "dashboard"],
    environment: {},
  });
});

test("P0 persistence restart can target the digest-derived acceptance project", () => {
  assert.deepEqual(buildP0DashboardPersistenceCommand({ ...input, action: "restart", imageReference: image }), {
    command: "docker",
    args: [
      "compose",
      "--project-name",
      "portal-accept-eeeeeeeeeeee",
      "--env-file",
      ".env.acceptance",
      "-f",
      "compose.yaml",
      "restart",
      "dashboard",
    ],
    environment: {
      PORTAL_IMAGE: image,
      PORTAL_SERVICE_ENV_FILE: ".env.acceptance",
    },
  });
});

test("P0 persistence recreate is pinned to the immutable image and digest-derived project", () => {
  assert.deepEqual(buildP0DashboardPersistenceCommand({ ...input, action: "recreate", imageReference: image }), {
    command: "docker",
    args: [
      "compose",
      "--project-name",
      "portal-accept-eeeeeeeeeeee",
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
    environment: {
      PORTAL_IMAGE: image,
      PORTAL_SERVICE_ENV_FILE: ".env.acceptance",
    },
  });
});

test("P0 persistence recreate fails closed without an immutable image", () => {
  assert.throws(
    () => buildP0DashboardPersistenceCommand({ ...input, action: "recreate" }),
    /p0_persistence_image_required/u,
  );
  assert.throws(
    () => buildP0DashboardPersistenceCommand({
      ...input,
      action: "recreate",
      imageReference: "registry.example.test/admin-dashboard:latest",
    }),
    /acceptance_image_digest_required/u,
  );
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
