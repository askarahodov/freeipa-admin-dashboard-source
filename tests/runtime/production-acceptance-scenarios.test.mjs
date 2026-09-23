import assert from "node:assert/strict";
import test from "node:test";

import {
  productionAcceptanceScenarioDefinitions,
  productionAcceptanceScenarioEnvironment,
  runProductionAcceptanceScenarios,
  validateProductionAcceptanceMutationConfirmation,
  validateProductionAcceptanceXyOpsConfiguration,
} from "../../scripts/production-acceptance-scenarios.mjs";

test("mutation scenarios require two independent confirmations", () => {
  assert.deepEqual(validateProductionAcceptanceMutationConfirmation({
    enabled: false,
    expectedProject: "portal-accept-abc",
  }), { enabled: false });

  assert.throws(
    () => validateProductionAcceptanceMutationConfirmation({
      enabled: true,
      confirmation: "NO",
      confirmedProject: "portal-accept-abc",
      expectedProject: "portal-accept-abc",
    }),
    /acceptance_mutation_confirmation_required/u,
  );

  assert.throws(
    () => validateProductionAcceptanceMutationConfirmation({
      enabled: true,
      confirmation: "YES",
      confirmedProject: "portal-accept-other",
      expectedProject: "portal-accept-abc",
    }),
    /acceptance_mutation_project_confirmation_required/u,
  );

  assert.deepEqual(validateProductionAcceptanceMutationConfirmation({
    enabled: true,
    confirmation: "YES",
    confirmedProject: "portal-accept-abc",
    expectedProject: "portal-accept-abc",
  }), { enabled: true, projectName: "portal-accept-abc" });
});

test("scenario environment pins canonical runners to the isolated portal and disables lifecycle ownership", () => {
  const environment = productionAcceptanceScenarioEnvironment({
    ambientEnvironment: {
      PORTAL_TEST_RESTART_DASHBOARD: "true",
      PORTAL_TEST_RECREATE_DASHBOARD: "true",
      KEEP: "yes",
    },
    baseUrl: "http://127.0.0.1:3100",
    adminUsername: "accept-admin",
    adminPassword: "test-only-password",
    projectName: "portal-accept-0123456789ab",
  });

  assert.equal(environment.KEEP, "yes");
  assert.equal(environment.PORTAL_TEST_CONFIRM, "YES");
  assert.equal(environment.PORTAL_TEST_BASE_URL, "http://127.0.0.1:3100");
  assert.equal(environment.PORTAL_TEST_ADMIN_USERNAME, "accept-admin");
  assert.equal(environment.PORTAL_TEST_ADMIN_PASSWORD, "test-only-password");
  assert.equal(environment.PORTAL_TEST_RESTART_DASHBOARD, "false");
  assert.equal(environment.PORTAL_TEST_RECREATE_DASHBOARD, "false");
  assert.equal(environment.PORTAL_ACCEPTANCE_PROJECT_NAME, "portal-accept-0123456789ab");
});

test("scenario definitions preserve local-auth/P0 defaults and opt settings in explicitly", () => {
  assert.deepEqual(
    productionAcceptanceScenarioDefinitions().map((item) => [item.id, item.script]),
    [
      ["local_auth_rbac", "scripts/local-auth-acceptance.mjs"],
      ["p0_operational", "scripts/p0-operational-acceptance.mjs"],
    ],
  );
  assert.deepEqual(
    productionAcceptanceScenarioDefinitions({
      includeLocalAuthP0: false,
      includeSettings: true,
    }).map((item) => [item.id, item.script]),
    [
      ["settings_persistence_rollback", "scripts/settings-acceptance.mjs"],
    ],
  );
  assert.deepEqual(
    productionAcceptanceScenarioDefinitions({
      includeLocalAuthP0: true,
      includeSettings: true,
    }).map((item) => item.id),
    ["local_auth_rbac", "p0_operational", "settings_persistence_rollback"],
  );
});

test("scenario orchestration emits only bounded stage evidence", async () => {
  const calls = [];
  const stages = await runProductionAcceptanceScenarios({
    environment: { PORTAL_TEST_CONFIRM: "YES" },
    runScript: async (script, environment) => {
      calls.push({ script, environment });
    },
  });

  assert.deepEqual(calls.map((item) => item.script), [
    "scripts/local-auth-acceptance.mjs",
    "scripts/p0-operational-acceptance.mjs",
  ]);
  assert.deepEqual(stages, [
    {
      id: "local_auth_rbac",
      outcome: "passed",
      code: "local_auth_rbac_passed",
      remediationCode: "none",
    },
    {
      id: "p0_operational",
      outcome: "passed",
      code: "p0_operational_passed",
      remediationCode: "none",
    },
  ]);
  assert.equal(JSON.stringify(stages).includes("PORTAL_TEST"), false);
});

test("scenario failure stops subsequent mutation runner and exposes only safe stage codes", async () => {
  let calls = 0;
  await assert.rejects(
    async () => runProductionAcceptanceScenarios({
      environment: { PORTAL_TEST_ADMIN_PASSWORD: "do-not-report" },
      runScript: async (script) => {
        calls += 1;
        if (script.includes("local-auth")) throw new Error("password=do-not-report");
      },
    }),
    (error) => {
      assert.equal(error.message, "acceptance_local_auth_rbac_failed");
      assert.deepEqual(error.acceptanceStages, [
        {
          id: "local_auth_rbac",
          outcome: "failed",
          code: "acceptance_local_auth_rbac_failed",
          remediationCode: "inspect_local_auth_acceptance",
        },
      ]);
      assert.equal(JSON.stringify(error.acceptanceStages).includes("do-not-report"), false);
      return true;
    },
  );
  assert.equal(calls, 1);
});


test("settings scenario failure emits only bounded stage evidence", async () => {
  const definitions = productionAcceptanceScenarioDefinitions({
    includeLocalAuthP0: false,
    includeSettings: true,
  });
  await assert.rejects(
    () => runProductionAcceptanceScenarios({
      definitions,
      environment: { PORTAL_TEST_ADMIN_PASSWORD: "do-not-report" },
      runScript: async () => {
        throw new Error("raw password=do-not-report");
      },
    }),
    (error) => {
      assert.equal(error.message, "acceptance_settings_persistence_rollback_failed");
      assert.deepEqual(error.acceptanceStages, [
        {
          id: "settings_persistence_rollback",
          outcome: "failed",
          code: "acceptance_settings_persistence_rollback_failed",
          remediationCode: "inspect_settings_acceptance",
        },
      ]);
      assert.equal(JSON.stringify(error.acceptanceStages).includes("do-not-report"), false);
      return true;
    },
  );
});


test("FreeIPA mutation selection always runs safe read first and scopes child mode per stage", async () => {
  const definitions = productionAcceptanceScenarioDefinitions({
    includeLocalAuthP0: false,
    includeSettings: false,
    includeFreeIpaMutations: true,
  });
  assert.deepEqual(definitions.map((item) => item.id), [
    "freeipa_read",
    "freeipa_crud_membership",
  ]);

  const calls = [];
  const stages = await runProductionAcceptanceScenarios({
    definitions,
    environment: {
      PORTAL_TEST_CONFIRM: "YES",
      PORTAL_ACCEPTANCE_PROJECT_NAME: "portal-accept-0123456789ab",
      IPA_PASSWORD: "must-not-reach-child",
      XYOPS_API_KEY: "must-not-reach-child",
      ADMIN_TOKEN: "must-not-reach-child",
    },
    runScript: async (script, environment) => {
      calls.push({ script, environment });
    },
  });

  assert.deepEqual(calls.map((item) => [
    item.script,
    item.environment.PORTAL_ACCEPTANCE_FREEIPA_MODE,
    item.environment.PORTAL_ACCEPTANCE_FREEIPA_MUTATIONS,
  ]), [
    ["scripts/freeipa-acceptance.mjs", "read", "false"],
    ["scripts/freeipa-acceptance.mjs", "mutate", "true"],
  ]);
  assert.equal(calls.every((item) => item.environment.IPA_PASSWORD === undefined), true);
  assert.equal(calls.every((item) => item.environment.XYOPS_API_KEY === undefined), true);
  assert.equal(calls.every((item) => item.environment.ADMIN_TOKEN === undefined), true);
  assert.deepEqual(stages.map((stage) => [stage.id, stage.outcome]), [
    ["freeipa_read", "passed"],
    ["freeipa_crud_membership", "passed"],
  ]);
});

test("FreeIPA read can be selected without the mutation stage", () => {
  assert.deepEqual(
    productionAcceptanceScenarioDefinitions({
      includeLocalAuthP0: false,
      includeFreeIpaRead: true,
      includeFreeIpaMutations: false,
    }).map((item) => item.id),
    ["freeipa_read"],
  );
});

test("FreeIPA stage failure exposes bounded evidence and no child environment", async () => {
  const definitions = productionAcceptanceScenarioDefinitions({
    includeLocalAuthP0: false,
    includeFreeIpaMutations: true,
  });

  await assert.rejects(
    () => runProductionAcceptanceScenarios({
      definitions,
      environment: { PORTAL_TEST_ADMIN_PASSWORD: "do-not-report" },
      runScript: async () => {
        throw new Error("upstream credential do-not-report");
      },
    }),
    (error) => {
      assert.equal(error.message, "acceptance_freeipa_read_failed");
      assert.deepEqual(error.acceptanceStages, [{
        id: "freeipa_read",
        outcome: "failed",
        code: "acceptance_freeipa_read_failed",
        remediationCode: "inspect_freeipa_read",
      }]);
      assert.equal(JSON.stringify(error.acceptanceStages).includes("do-not-report"), false);
      return true;
    },
  );
});


test("XYOps lifecycle configuration fails closed before Docker execution", () => {
  assert.deepEqual(validateProductionAcceptanceXyOpsConfiguration(), { enabled: false });
  assert.throws(
    () => validateProductionAcceptanceXyOpsConfiguration({
      enabled: true,
      requesterUsername: "",
      requesterPassword: "",
      eventId: "portal-acceptance-event",
      confirmedEventId: "portal-acceptance-event",
    }),
    /acceptance_xyops_requester_credentials_required/u,
  );
  assert.throws(
    () => validateProductionAcceptanceXyOpsConfiguration({
      enabled: true,
      requesterUsername: "accept-operator",
      requesterPassword: "test-password",
      eventId: "portal-acceptance-event",
      confirmedEventId: "different-event",
    }),
    /acceptance_xyops_event_confirmation_required/u,
  );
  assert.deepEqual(validateProductionAcceptanceXyOpsConfiguration({
    enabled: true,
    requesterUsername: "accept-operator",
    requesterPassword: "test-password",
    eventId: "portal-acceptance-event",
    confirmedEventId: "portal-acceptance-event",
  }), { enabled: true, eventId: "portal-acceptance-event" });
});

test("XYOps lifecycle selection always runs safe read first and strips upstream credentials", async () => {
  const definitions = productionAcceptanceScenarioDefinitions({
    includeLocalAuthP0: false,
    includeXyOpsLifecycle: true,
  });
  assert.deepEqual(definitions.map((item) => item.id), [
    "xyops_read",
    "xyops_approval_cancel_result",
  ]);

  const calls = [];
  const stages = await runProductionAcceptanceScenarios({
    definitions,
    environment: {
      PORTAL_TEST_ADMIN_USERNAME: "accept-admin",
      PORTAL_TEST_ADMIN_PASSWORD: "admin-password",
      PORTAL_ACCEPTANCE_XYOPS_REQUESTER_USERNAME: "accept-operator",
      PORTAL_ACCEPTANCE_XYOPS_REQUESTER_PASSWORD: "operator-password",
      PORTAL_ACCEPTANCE_XYOPS_EVENT_ID: "portal-acceptance-event",
      PORTAL_ACCEPTANCE_XYOPS_CONFIRM_EVENT_ID: "portal-acceptance-event",
      XYOPS_URL: "https://must-not-reach-child.invalid",
      XYOPS_API_KEY: "must-not-reach-child",
      ADMIN_TOKEN: "must-not-reach-child",
    },
    runScript: async (script, environment) => calls.push({ script, environment }),
  });

  assert.deepEqual(calls.map((item) => [
    item.script,
    item.environment.PORTAL_ACCEPTANCE_XYOPS_MODE,
  ]), [
    ["scripts/xyops-acceptance.mjs", "read"],
    ["scripts/xyops-acceptance.mjs", "lifecycle"],
  ]);
  assert.equal(calls.every((item) => item.environment.XYOPS_URL === undefined), true);
  assert.equal(calls.every((item) => item.environment.XYOPS_API_KEY === undefined), true);
  assert.equal(calls.every((item) => item.environment.ADMIN_TOKEN === undefined), true);
  assert.deepEqual(stages.map((stage) => [stage.id, stage.outcome]), [
    ["xyops_read", "passed"],
    ["xyops_approval_cancel_result", "passed"],
  ]);
});

test("XYOps safe read can run without lifecycle mutations", () => {
  assert.deepEqual(
    productionAcceptanceScenarioDefinitions({
      includeLocalAuthP0: false,
      includeXyOpsRead: true,
    }).map((item) => item.id),
    ["xyops_read"],
  );
});
