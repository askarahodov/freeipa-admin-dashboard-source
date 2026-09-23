import {
  acceptanceProjectName,
  parseImmutableImageReference,
} from "./production-acceptance-contract.mjs";

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
  imageReference,
}) {
  const normalizedAction = String(action ?? "").trim();
  if (!["restart", "recreate"].includes(normalizedAction)) {
    throw new Error("p0_persistence_action_invalid");
  }

  const file = required(composeFile, "p0_persistence_compose_file_required");
  const envFile = required(composeEnvFile, "p0_persistence_compose_env_file_required");
  const service = required(composeService, "p0_persistence_compose_service_required");
  if (!SERVICE_PATTERN.test(service)) throw new Error("p0_persistence_compose_service_invalid");

  let image = null;
  if (imageReference) image = parseImmutableImageReference(imageReference);
  if (normalizedAction === "recreate" && !image) {
    throw new Error("p0_persistence_image_required");
  }

  const projectArgs = image ? ["--project-name", acceptanceProjectName(image.digest)] : [];
  const common = ["compose", ...projectArgs, "--env-file", envFile, "-f", file];
  const args = normalizedAction === "restart"
    ? [...common, "restart", service]
    : [...common, "up", "-d", "--no-deps", "--no-build", "--force-recreate", service];

  return Object.freeze({
    command: "docker",
    args: Object.freeze(args),
    environment: Object.freeze(image
      ? {
          PORTAL_IMAGE: image.reference,
          PORTAL_SERVICE_ENV_FILE: envFile,
        }
      : {}),
  });
}
