import {
  normalizeCommitSha,
  parseImmutableImageReference,
} from "./production-acceptance-contract.mjs";

export const UPGRADE_POLICY_SCHEMA_VERSION = 1;

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function validateUpgradeSourcePolicy(value, { targetImageReference, targetCommitSha } = {}) {
  if (!plainObject(value) || value.schemaVersion !== UPGRADE_POLICY_SCHEMA_VERSION) {
    throw new Error("acceptance_upgrade_policy_invalid");
  }
  const topLevelKeys = new Set(["schemaVersion", "state", "previousSupported"]);
  if (Object.keys(value).some((key) => !topLevelKeys.has(key))) {
    throw new Error("acceptance_upgrade_policy_invalid");
  }
  if (value.state === "unconfigured") {
    if (value.previousSupported !== null) throw new Error("acceptance_upgrade_policy_invalid");
    throw new Error("acceptance_upgrade_source_unconfigured");
  }
  if (value.state !== "configured" || !plainObject(value.previousSupported)) {
    throw new Error("acceptance_upgrade_policy_invalid");
  }

  const source = value.previousSupported;
  const allowed = new Set(["id", "commitSha", "image", "portalSchemaVersion"]);
  if (Object.keys(source).some((key) => !allowed.has(key))) {
    throw new Error("acceptance_upgrade_policy_invalid");
  }
  const id = String(source.id ?? "").trim();
  if (!/^[A-Za-z0-9_.-]{1,80}$/u.test(id)) throw new Error("acceptance_upgrade_policy_invalid");
  const commitSha = normalizeCommitSha(source.commitSha);
  const image = parseImmutableImageReference(source.image);
  const portalSchemaVersion = source.portalSchemaVersion;
  if (!Number.isInteger(portalSchemaVersion) || portalSchemaVersion < 1) {
    throw new Error("acceptance_upgrade_policy_invalid");
  }

  const targetImage = parseImmutableImageReference(targetImageReference);
  const targetCommit = normalizeCommitSha(targetCommitSha);
  if (image.repository !== targetImage.repository) {
    throw new Error("acceptance_upgrade_repository_mismatch");
  }
  if (image.digest === targetImage.digest || commitSha === targetCommit) {
    throw new Error("acceptance_upgrade_source_not_previous");
  }

  return Object.freeze({
    schemaVersion: UPGRADE_POLICY_SCHEMA_VERSION,
    id,
    commitSha,
    image,
    portalSchemaVersion,
  });
}

export function upgradeImagePullCommand(imageReference) {
  const image = parseImmutableImageReference(imageReference);
  return Object.freeze(["docker", "pull", image.reference]);
}

export function upgradeComposeCommand({
  projectName,
  serviceEnvFile = ".env.acceptance",
  imageReference,
  action = "up",
} = {}) {
  if (!/^portal-accept-[a-f0-9]{12}$/u.test(String(projectName ?? ""))) {
    throw new Error("acceptance_upgrade_project_invalid");
  }
  const image = parseImmutableImageReference(imageReference);
  const prefix = [
    "docker", "compose",
    "--project-name", projectName,
    "--env-file", serviceEnvFile,
    "-f", "compose.yaml",
  ];
  if (action === "reset") {
    return Object.freeze([...prefix, "down", "--volumes", "--remove-orphans"]);
  }
  if (action === "stop") {
    return Object.freeze([...prefix, "stop", "dashboard"]);
  }
  if (action === "up") {
    return Object.freeze([
      ...prefix,
      "up",
      "-d",
      "--no-deps",
      "--no-build",
      "--force-recreate",
      "dashboard",
    ]);
  }
  throw new Error("acceptance_upgrade_command_invalid");
}

function settingsSnapshot(payload) {
  const revision = Number(payload?.revision);
  const demoMode = payload?.settings?.demoMode;
  if (!Number.isInteger(revision) || revision < 0 || typeof demoMode !== "boolean") {
    throw new Error("acceptance_upgrade_settings_invalid");
  }
  return Object.freeze({ revision, demoMode });
}

async function effectiveSettings(request) {
  const response = await request("/api/integrations/settings/effective", { method: "GET" });
  if (response?.status !== 200) throw new Error("acceptance_upgrade_settings_read_failed");
  return settingsSnapshot(response.json);
}

async function createApplyMarker(request, initial) {
  const created = await request("/api/integrations/settings/drafts", {
    method: "POST",
    body: { baseRevision: initial.revision, changes: { demoMode: !initial.demoMode } },
  });
  if (created?.status !== 201 || !created.json?.draft?.id) {
    throw new Error("acceptance_upgrade_marker_create_failed");
  }
  const draftId = String(created.json.draft.id);
  const validated = await request(`/api/integrations/settings/drafts/${encodeURIComponent(draftId)}/validate`, {
    method: "POST",
    body: { services: [] },
  });
  if (validated?.status !== 200 || validated.json?.draft?.status !== "validated") {
    throw new Error("acceptance_upgrade_marker_validate_failed");
  }
  const applied = await request(`/api/integrations/settings/drafts/${encodeURIComponent(draftId)}/apply`, {
    method: "POST",
    body: {},
  });
  if (applied?.status !== 200 || applied.json?.ok !== true) {
    throw new Error("acceptance_upgrade_marker_apply_failed");
  }
  const persisted = await effectiveSettings(request);
  if (persisted.demoMode !== !initial.demoMode || persisted.revision <= initial.revision) {
    throw new Error("acceptance_upgrade_marker_persistence_failed");
  }
  return persisted;
}

export async function executeUpgradeAcceptance({
  policy,
  targetImageReference,
  targetCommitSha,
  projectName,
  serviceEnvFile = ".env.acceptance",
  runCommand,
  waitReady,
  readSourceImageRevision,
  verifyTargetBaseline,
  createAuthenticatedRequest,
} = {}) {
  if (typeof runCommand !== "function"
      || typeof waitReady !== "function"
      || typeof readSourceImageRevision !== "function"
      || typeof verifyTargetBaseline !== "function"
      || typeof createAuthenticatedRequest !== "function") {
    throw new Error("acceptance_upgrade_dependency_invalid");
  }
  const source = validateUpgradeSourcePolicy(policy, { targetImageReference, targetCommitSha });
  const targetImage = parseImmutableImageReference(targetImageReference);

  await runCommand(upgradeComposeCommand({ projectName, serviceEnvFile, imageReference: targetImage.reference, action: "reset" }), {
    PORTAL_IMAGE: targetImage.reference,
  });

  await runCommand(upgradeImagePullCommand(source.image.reference), {});
  const sourceRevision = String(await readSourceImageRevision(source.image.reference)).trim().toLowerCase();
  if (sourceRevision !== source.commitSha) {
    throw new Error("acceptance_upgrade_source_provenance_mismatch");
  }

  await runCommand(upgradeComposeCommand({ projectName, serviceEnvFile, imageReference: source.image.reference, action: "up" }), {
    PORTAL_IMAGE: source.image.reference,
  });
  const sourceReady = await waitReady(source.portalSchemaVersion);
  if (sourceReady?.currentVersion !== source.portalSchemaVersion || sourceReady?.latestVersion !== source.portalSchemaVersion) {
    throw new Error("acceptance_upgrade_source_schema_mismatch");
  }

  const sourceRequest = await createAuthenticatedRequest();
  const initial = await effectiveSettings(sourceRequest);
  const marker = await createApplyMarker(sourceRequest, initial);

  await runCommand(upgradeComposeCommand({ projectName, serviceEnvFile, imageReference: source.image.reference, action: "stop" }), {
    PORTAL_IMAGE: source.image.reference,
  });
  await runCommand(upgradeComposeCommand({ projectName, serviceEnvFile, imageReference: targetImage.reference, action: "up" }), {
    PORTAL_IMAGE: targetImage.reference,
  });

  const targetReady = await waitReady();
  if (!Number.isInteger(targetReady?.currentVersion)
      || targetReady.currentVersion < source.portalSchemaVersion
      || targetReady.currentVersion !== targetReady.latestVersion) {
    throw new Error("acceptance_upgrade_target_schema_mismatch");
  }
  await verifyTargetBaseline();

  const targetRequest = await createAuthenticatedRequest();
  const after = await effectiveSettings(targetRequest);
  if (after.demoMode !== marker.demoMode || after.revision !== marker.revision) {
    throw new Error("acceptance_upgrade_persistence_failed");
  }

  return Object.freeze({
    outcome: "passed",
    sourceProvenance: "verified",
    sourceSchema: "verified",
    targetSchema: "verified",
    targetHealth: "verified",
    login: "verified",
    persistence: "verified",
  });
}
