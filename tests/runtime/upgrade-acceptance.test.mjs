import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  executeUpgradeAcceptance,
  upgradeComposeCommand,
  validateUpgradeSourcePolicy,
} from "../../scripts/upgrade-acceptance-core.mjs";

const targetDigest = `sha256:${"a".repeat(64)}`;
const sourceDigest = `sha256:${"b".repeat(64)}`;
const targetImage = `registry.example.test/portal/admin-dashboard@${targetDigest}`;
const sourceImage = `registry.example.test/portal/admin-dashboard@${sourceDigest}`;
const targetCommit = "c".repeat(40);
const sourceCommit = "d".repeat(40);
const projectName = "portal-accept-aaaaaaaaaaaa";

function configuredPolicy(overrides = {}) {
  return {
    schemaVersion: 1,
    state: "configured",
    previousSupported: {
      id: "previous-supported",
      commitSha: sourceCommit,
      image: sourceImage,
      portalSchemaVersion: 4,
      ...overrides,
    },
  };
}

test("checked-in previous-supported policy is explicitly unconfigured until an immutable release exists", async () => {
  const policy = JSON.parse(await readFile(
    new URL("../../release/previous-supported.json", import.meta.url),
    "utf8",
  ));
  assert.deepEqual(policy, {
    schemaVersion: 1,
    state: "unconfigured",
    previousSupported: null,
  });
  assert.throws(
    () => validateUpgradeSourcePolicy(policy, {
      targetImageReference: targetImage,
      targetCommitSha: targetCommit,
    }),
    /acceptance_upgrade_source_unconfigured/u,
  );
});

test("upgrade source policy accepts only a distinct immutable image from the target repository", () => {
  const policy = validateUpgradeSourcePolicy(configuredPolicy(), {
    targetImageReference: targetImage,
    targetCommitSha: targetCommit,
  });
  assert.equal(policy.id, "previous-supported");
  assert.equal(policy.image.reference, sourceImage);
  assert.equal(policy.portalSchemaVersion, 4);

  assert.throws(
    () => validateUpgradeSourcePolicy(configuredPolicy({
      image: `other.example.test/portal@${sourceDigest}`,
    }), {
      targetImageReference: targetImage,
      targetCommitSha: targetCommit,
    }),
    /acceptance_upgrade_repository_mismatch/u,
  );
  assert.throws(
    () => validateUpgradeSourcePolicy(configuredPolicy({
      image: "registry.example.test/portal/admin-dashboard:latest",
    }), {
      targetImageReference: targetImage,
      targetCommitSha: targetCommit,
    }),
    /acceptance_image_digest_required/u,
  );
  assert.throws(
    () => validateUpgradeSourcePolicy(configuredPolicy({
      image: targetImage,
    }), {
      targetImageReference: targetImage,
      targetCommitSha: targetCommit,
    }),
    /acceptance_upgrade_source_not_previous/u,
  );
  assert.throws(
    () => validateUpgradeSourcePolicy(configuredPolicy({
      commitSha: targetCommit,
    }), {
      targetImageReference: targetImage,
      targetCommitSha: targetCommit,
    }),
    /acceptance_upgrade_source_not_previous/u,
  );
  assert.throws(
    () => validateUpgradeSourcePolicy({
      ...configuredPolicy(),
      extra: true,
    }, {
      targetImageReference: targetImage,
      targetCommitSha: targetCommit,
    }),
    /acceptance_upgrade_policy_invalid/u,
  );
  assert.throws(
    () => validateUpgradeSourcePolicy(configuredPolicy({
      portalSchemaVersion: "4",
    }), {
      targetImageReference: targetImage,
      targetCommitSha: targetCommit,
    }),
    /acceptance_upgrade_policy_invalid/u,
  );
});

test("upgrade commands are bound to the digest-derived project and never build images", () => {
  assert.deepEqual(upgradeComposeCommand({
    projectName,
    imageReference: sourceImage,
    action: "up",
  }), [
    "docker", "compose",
    "--project-name", projectName,
    "--env-file", ".env.acceptance",
    "-f", "compose.yaml",
    "up", "-d", "--no-deps", "--no-build", "--force-recreate", "dashboard",
  ]);
  assert.deepEqual(upgradeComposeCommand({
    projectName,
    imageReference: sourceImage,
    action: "stop",
  }).slice(-2), ["stop", "dashboard"]);
  assert.deepEqual(upgradeComposeCommand({
    projectName,
    imageReference: targetImage,
    action: "reset",
  }).slice(-3), ["down", "--volumes", "--remove-orphans"]);
  assert.throws(
    () => upgradeComposeCommand({
      projectName: "production",
      imageReference: sourceImage,
      action: "up",
    }),
    /acceptance_upgrade_project_invalid/u,
  );
});

test("upgrade acceptance seeds source state then verifies target schema login and persistence", async () => {
  const commands = [];
  let readyCall = 0;
  let authCall = 0;
  let provenanceCalls = 0;
  let targetBaselineCalls = 0;
  let sourceEffectiveReads = 0;

  const sourceRequest = async (pathname, options = {}) => {
    if (pathname === "/api/integrations/settings/effective") {
      sourceEffectiveReads += 1;
      return sourceEffectiveReads === 1
        ? { status: 200, json: { revision: 7, settings: { demoMode: false } } }
        : { status: 200, json: { revision: 8, settings: { demoMode: true } } };
    }
    if (pathname === "/api/integrations/settings/drafts") {
      assert.deepEqual(options.body, { baseRevision: 7, changes: { demoMode: true } });
      return { status: 201, json: { draft: { id: "draft-1" } } };
    }
    if (pathname === "/api/integrations/settings/drafts/draft-1/validate") {
      assert.deepEqual(options.body, { services: [] });
      return { status: 200, json: { draft: { status: "validated" } } };
    }
    if (pathname === "/api/integrations/settings/drafts/draft-1/apply") {
      return { status: 200, json: { ok: true } };
    }
    throw new Error(`unexpected source request ${pathname}`);
  };
  const targetRequest = async (pathname) => {
    if (pathname === "/api/integrations/settings/effective") {
      return { status: 200, json: { revision: 8, settings: { demoMode: true } } };
    }
    throw new Error(`unexpected target request ${pathname}`);
  };

  const result = await executeUpgradeAcceptance({
    policy: configuredPolicy(),
    targetImageReference: targetImage,
    targetCommitSha: targetCommit,
    projectName,
    runCommand: async (command, environment) => {
      commands.push({ command: [...command], environment: { ...environment } });
    },
    readSourceImageRevision: async (imageReference) => {
      provenanceCalls += 1;
      assert.equal(imageReference, sourceImage);
      return sourceCommit;
    },
    waitReady: async (expectedVersion) => {
      readyCall += 1;
      if (readyCall === 1) {
        assert.equal(expectedVersion, 4);
        return { currentVersion: 4, latestVersion: 4 };
      }
      assert.equal(expectedVersion, undefined);
      return { currentVersion: 5, latestVersion: 5 };
    },
    verifyTargetBaseline: async () => {
      targetBaselineCalls += 1;
    },
    createAuthenticatedRequest: async () => {
      authCall += 1;
      return authCall === 1 ? sourceRequest : targetRequest;
    },
  });

  assert.deepEqual(result, {
    outcome: "passed",
    sourceProvenance: "verified",
    sourceSchema: "verified",
    targetSchema: "verified",
    targetHealth: "verified",
    login: "verified",
    persistence: "verified",
  });
  assert.deepEqual(commands.map((item) => item.command.slice(-3)), [
    ["down", "--volumes", "--remove-orphans"],
    ["--no-build", "--force-recreate", "dashboard"],
    ["compose.yaml", "stop", "dashboard"],
    ["--no-build", "--force-recreate", "dashboard"],
  ]);
  assert.deepEqual(commands.map((item) => item.environment.PORTAL_IMAGE), [
    targetImage,
    sourceImage,
    sourceImage,
    targetImage,
  ]);
  assert.equal(authCall, 2);
  assert.equal(provenanceCalls, 1);
  assert.equal(targetBaselineCalls, 1);
});

test("upgrade acceptance fails closed on source schema mismatch before marker mutation", async () => {
  let authenticated = false;
  await assert.rejects(
    () => executeUpgradeAcceptance({
      policy: configuredPolicy(),
      targetImageReference: targetImage,
      targetCommitSha: targetCommit,
      projectName,
      runCommand: async () => {},
      readSourceImageRevision: async () => sourceCommit,
      waitReady: async () => ({ currentVersion: 3, latestVersion: 3 }),
      verifyTargetBaseline: async () => {},
      createAuthenticatedRequest: async () => {
        authenticated = true;
        throw new Error("should not authenticate");
      },
    }),
    /acceptance_upgrade_source_schema_mismatch/u,
  );
  assert.equal(authenticated, false);
});

test("upgrade acceptance rejects target persistence loss", async () => {
  let authCall = 0;
  let effectiveReads = 0;
  const sourceRequest = async (pathname) => {
    if (pathname === "/api/integrations/settings/effective") {
      effectiveReads += 1;
      return effectiveReads === 1
        ? { status: 200, json: { revision: 1, settings: { demoMode: false } } }
        : { status: 200, json: { revision: 2, settings: { demoMode: true } } };
    }
    if (pathname === "/api/integrations/settings/drafts") return { status: 201, json: { draft: { id: "d" } } };
    if (pathname.endsWith("/validate")) return { status: 200, json: { draft: { status: "validated" } } };
    if (pathname.endsWith("/apply")) return { status: 200, json: { ok: true } };
    throw new Error("unexpected");
  };
  const targetRequest = async () => ({
    status: 200,
    json: { revision: 2, settings: { demoMode: false } },
  });

  await assert.rejects(
    () => executeUpgradeAcceptance({
      policy: configuredPolicy(),
      targetImageReference: targetImage,
      targetCommitSha: targetCommit,
      projectName,
      runCommand: async () => {},
      readSourceImageRevision: async () => sourceCommit,
      waitReady: async (expected) => expected === 4
        ? { currentVersion: 4, latestVersion: 4 }
        : { currentVersion: 5, latestVersion: 5 },
      verifyTargetBaseline: async () => {},
      createAuthenticatedRequest: async () => {
        authCall += 1;
        return authCall === 1 ? sourceRequest : targetRequest;
      },
    }),
    /acceptance_upgrade_persistence_failed/u,
  );
});


test("upgrade acceptance blocks target login when post-upgrade baseline is unhealthy", async () => {
  let authCall = 0;
  let effectiveReads = 0;
  const sourceRequest = async (pathname) => {
    if (pathname === "/api/integrations/settings/effective") {
      effectiveReads += 1;
      return effectiveReads === 1
        ? { status: 200, json: { revision: 1, settings: { demoMode: false } } }
        : { status: 200, json: { revision: 2, settings: { demoMode: true } } };
    }
    if (pathname === "/api/integrations/settings/drafts") return { status: 201, json: { draft: { id: "d" } } };
    if (pathname.endsWith("/validate")) return { status: 200, json: { draft: { status: "validated" } } };
    if (pathname.endsWith("/apply")) return { status: 200, json: { ok: true } };
    throw new Error("unexpected");
  };

  await assert.rejects(
    () => executeUpgradeAcceptance({
      policy: configuredPolicy(),
      targetImageReference: targetImage,
      targetCommitSha: targetCommit,
      projectName,
      runCommand: async () => {},
      readSourceImageRevision: async () => sourceCommit,
      waitReady: async (expected) => expected === 4
        ? { currentVersion: 4, latestVersion: 4 }
        : { currentVersion: 5, latestVersion: 5 },
      verifyTargetBaseline: async () => {
        throw new Error("acceptance_upgrade_target_baseline_failed");
      },
      createAuthenticatedRequest: async () => {
        authCall += 1;
        return sourceRequest;
      },
    }),
    /acceptance_upgrade_target_baseline_failed/u,
  );
  assert.equal(authCall, 1);
});


test("upgrade acceptance rejects source image provenance mismatch before readiness or mutation", async () => {
  let ready = false;
  let authenticated = false;
  await assert.rejects(
    () => executeUpgradeAcceptance({
      policy: configuredPolicy(),
      targetImageReference: targetImage,
      targetCommitSha: targetCommit,
      projectName,
      runCommand: async () => {},
      readSourceImageRevision: async (imageReference) => {
        assert.equal(imageReference, sourceImage);
        return "e".repeat(40);
      },
      waitReady: async () => {
        ready = true;
        return { currentVersion: 4, latestVersion: 4 };
      },
      verifyTargetBaseline: async () => {},
      createAuthenticatedRequest: async () => {
        authenticated = true;
        throw new Error("should not authenticate");
      },
    }),
    /acceptance_upgrade_source_provenance_mismatch/u,
  );
  assert.equal(ready, false);
  assert.equal(authenticated, false);
});
