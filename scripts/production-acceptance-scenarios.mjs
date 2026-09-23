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

export function productionAcceptanceScenarioEnvironment({
  ambientEnvironment = {},
  baseUrl,
  adminUsername,
  adminPassword,
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
  });
}

export function productionAcceptanceScenarioDefinitions() {
  return Object.freeze([
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
  ]);
}

export async function runProductionAcceptanceScenarios({
  runScript,
  environment,
} = {}) {
  if (typeof runScript !== "function") throw new Error("acceptance_scenario_runner_invalid");
  const stages = [];
  for (const definition of productionAcceptanceScenarioDefinitions()) {
    try {
      await runScript(definition.script, environment);
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
