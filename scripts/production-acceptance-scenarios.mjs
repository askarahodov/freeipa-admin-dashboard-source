export const PRODUCTION_ACCEPTANCE_MUTATION_CONFIRMATION = "YES";

export function validateProductionAcceptanceMutationConfirmation({
  enabled = false,
  confirmation,
  confirmedProject,
  expectedProject,
} = {}) {
  if (!enabled) {
    return Object.freeze({ enabled: false });
  }
  if (String(confirmation ?? "").trim() !== PRODUCTION_ACCEPTANCE_MUTATION_CONFIRMATION) {
    throw new Error("acceptance_mutation_confirmation_required");
  }
  if (!expectedProject || String(confirmedProject ?? "").trim() !== expectedProject) {
    throw new Error("acceptance_mutation_project_confirmation_required");
  }
  return Object.freeze({ enabled: true, projectName: expectedProject });
}

export function validateProductionAcceptanceXyOpsConfiguration({
  enabled = false,
  requesterUsername,
  requesterPassword,
  eventId,
  confirmedEventId,
} = {}) {
  if (!enabled) return Object.freeze({ enabled: false });
  if (!String(requesterUsername ?? "").trim() || !String(requesterPassword ?? "")) {
    throw new Error("acceptance_xyops_requester_credentials_required");
  }
  const normalizedEventId = String(eventId ?? "").trim();
  if (!/^[A-Za-z0-9_.:-]{1,160}$/u.test(normalizedEventId)) {
    throw new Error("acceptance_xyops_event_id_invalid");
  }
  if (String(confirmedEventId ?? "").trim() !== normalizedEventId) {
    throw new Error("acceptance_xyops_event_confirmation_required");
  }
  return Object.freeze({ enabled: true, eventId: normalizedEventId });
}

export function productionAcceptanceScenarioEnvironment({
  ambientEnvironment = {},
  baseUrl,
  adminUsername,
  adminPassword,
  projectName,
} = {}) {
  if (!baseUrl) throw new Error("acceptance_scenario_base_url_required");
  if (!adminUsername || !adminPassword) {
    throw new Error("acceptance_scenario_admin_credentials_required");
  }
  return Object.freeze({
    ...ambientEnvironment,
    PORTAL_TEST_CONFIRM: "YES",
    PORTAL_TEST_BASE_URL: baseUrl,
    PORTAL_TEST_ADMIN_USERNAME: adminUsername,
    PORTAL_TEST_ADMIN_PASSWORD: adminPassword,
    PORTAL_TEST_RESTART_DASHBOARD: "false",
    PORTAL_TEST_RECREATE_DASHBOARD: "false",
    ...(projectName ? { PORTAL_ACCEPTANCE_PROJECT_NAME: projectName } : {}),
  });
}

export function productionAcceptanceScenarioDefinitions({
  includeLocalAuthP0 = true,
  includeSettings = false,
  includeFreeIpaRead = false,
  includeFreeIpaMutations = false,
  includeXyOpsRead = false,
  includeXyOpsLifecycle = false,
} = {}) {
  const definitions = [];
  if (includeLocalAuthP0) {
    definitions.push(
      Object.freeze({
        id: "local_auth_rbac",
        script: "scripts/local-auth-acceptance.mjs",
        passedCode: "local_auth_rbac_passed",
        failedCode: "acceptance_local_auth_rbac_failed",
        remediationCode: "inspect_local_auth_acceptance",
      }),
      Object.freeze({
        id: "p0_operational",
        script: "scripts/p0-operational-acceptance.mjs",
        passedCode: "p0_operational_passed",
        failedCode: "acceptance_p0_operational_failed",
        remediationCode: "inspect_p0_operational_acceptance",
      }),
    );
  }
  if (includeSettings) {
    definitions.push(Object.freeze({
      id: "settings_persistence_rollback",
      script: "scripts/settings-acceptance.mjs",
      passedCode: "settings_persistence_rollback_passed",
      failedCode: "acceptance_settings_persistence_rollback_failed",
      remediationCode: "inspect_settings_acceptance",
    }));
  }
  if (includeFreeIpaRead || includeFreeIpaMutations) {
    definitions.push(Object.freeze({
      id: "freeipa_read",
      script: "scripts/freeipa-acceptance.mjs",
      environment: Object.freeze({
        PORTAL_ACCEPTANCE_FREEIPA_MODE: "read",
        PORTAL_ACCEPTANCE_FREEIPA_MUTATIONS: "false",
      }),
      omitEnvironmentKeys: Object.freeze([
        "ADMIN_TOKEN",
        "CONFIG_ENCRYPTION_KEY",
        "IPA_URL",
        "IPA_USERNAME",
        "IPA_PASSWORD",
        "IPA_NODE_GATEWAY_URL",
        "IPA_NODE_GATEWAY_TOKEN",
        "XYOPS_URL",
        "XYOPS_API_KEY",
      ]),
      passedCode: "freeipa_read_passed",
      failedCode: "acceptance_freeipa_read_failed",
      remediationCode: "inspect_freeipa_read",
    }));
  }
  if (includeFreeIpaMutations) {
    definitions.push(Object.freeze({
      id: "freeipa_crud_membership",
      script: "scripts/freeipa-acceptance.mjs",
      environment: Object.freeze({
        PORTAL_ACCEPTANCE_FREEIPA_MODE: "mutate",
        PORTAL_ACCEPTANCE_FREEIPA_MUTATIONS: "true",
      }),
      omitEnvironmentKeys: Object.freeze([
        "ADMIN_TOKEN",
        "CONFIG_ENCRYPTION_KEY",
        "IPA_URL",
        "IPA_USERNAME",
        "IPA_PASSWORD",
        "IPA_NODE_GATEWAY_URL",
        "IPA_NODE_GATEWAY_TOKEN",
        "XYOPS_URL",
        "XYOPS_API_KEY",
      ]),
      passedCode: "freeipa_crud_membership_passed",
      failedCode: "acceptance_freeipa_crud_membership_failed",
      remediationCode: "inspect_freeipa_acceptance",
    }));
  }
  if (includeXyOpsRead || includeXyOpsLifecycle) {
    definitions.push(Object.freeze({
      id: "xyops_read",
      script: "scripts/xyops-acceptance.mjs",
      environment: Object.freeze({
        PORTAL_ACCEPTANCE_XYOPS_MODE: "read",
      }),
      omitEnvironmentKeys: Object.freeze([
        "ADMIN_TOKEN",
        "CONFIG_ENCRYPTION_KEY",
        "IPA_URL",
        "IPA_USERNAME",
        "IPA_PASSWORD",
        "IPA_NODE_GATEWAY_URL",
        "IPA_NODE_GATEWAY_TOKEN",
        "XYOPS_URL",
        "XYOPS_API_KEY",
        "PORTAL_PROXY_SHARED_SECRET",
      ]),
      passedCode: "xyops_read_passed",
      failedCode: "acceptance_xyops_read_failed",
      remediationCode: "inspect_xyops_read",
    }));
  }
  if (includeXyOpsLifecycle) {
    definitions.push(Object.freeze({
      id: "xyops_approval_cancel_result",
      script: "scripts/xyops-acceptance.mjs",
      environment: Object.freeze({
        PORTAL_ACCEPTANCE_XYOPS_MODE: "lifecycle",
      }),
      omitEnvironmentKeys: Object.freeze([
        "ADMIN_TOKEN",
        "CONFIG_ENCRYPTION_KEY",
        "IPA_URL",
        "IPA_USERNAME",
        "IPA_PASSWORD",
        "IPA_NODE_GATEWAY_URL",
        "IPA_NODE_GATEWAY_TOKEN",
        "XYOPS_URL",
        "XYOPS_API_KEY",
        "PORTAL_PROXY_SHARED_SECRET",
      ]),
      passedCode: "xyops_approval_cancel_result_passed",
      failedCode: "acceptance_xyops_lifecycle_failed",
      remediationCode: "inspect_xyops_acceptance",
    }));
  }
  return Object.freeze(definitions);
}

export async function runProductionAcceptanceScenarios({
  runScript,
  environment,
  definitions = productionAcceptanceScenarioDefinitions(),
} = {}) {
  if (typeof runScript !== "function") throw new Error("acceptance_scenario_runner_invalid");
  if (!Array.isArray(definitions)) throw new Error("acceptance_scenario_definitions_invalid");
  const stages = [];
  for (const definition of definitions) {
    try {
      const childEnvironment = {
        ...(environment ?? {}),
        ...(definition.environment ?? {}),
      };
      for (const key of definition.omitEnvironmentKeys ?? []) delete childEnvironment[key];
      await runScript(definition.script, Object.freeze(childEnvironment));
      stages.push(Object.freeze({
        id: definition.id,
        outcome: "passed",
        code: definition.passedCode,
        remediationCode: "none",
      }));
    } catch {
      stages.push(Object.freeze({
        id: definition.id,
        outcome: "failed",
        code: definition.failedCode,
        remediationCode: definition.remediationCode,
      }));
      throw Object.assign(new Error(definition.failedCode), {
        acceptanceStages: Object.freeze([...stages]),
      });
    }
  }
  return Object.freeze(stages);
}
