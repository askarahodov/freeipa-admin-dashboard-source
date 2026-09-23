const SERVICE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/u;

function required(value, code) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(code);
  return normalized;
}

export function buildP0DashboardPersistenceCommand({
  action,
  composeFile,
  composeEnvFile,
  composeService,
}) {
  const normalizedAction = String(action ?? "").trim();
  if (!["restart", "recreate"].includes(normalizedAction)) {
    throw new Error("p0_persistence_action_invalid");
  }

  const file = required(composeFile, "p0_persistence_compose_file_required");
  const envFile = required(composeEnvFile, "p0_persistence_compose_env_file_required");
  const service = required(composeService, "p0_persistence_compose_service_required");
  if (!SERVICE_PATTERN.test(service)) throw new Error("p0_persistence_compose_service_invalid");

  const common = ["compose", "--env-file", envFile, "-f", file];
  const args = normalizedAction === "restart"
    ? [...common, "restart", service]
    : [...common, "up", "-d", "--no-build", "--force-recreate", service];

  return Object.freeze({
    command: "docker",
    args: Object.freeze(args),
  });
}
