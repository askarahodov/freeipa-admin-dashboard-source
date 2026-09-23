const IMAGE_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;
const SENSITIVE_KEY_PATTERN = /(?:password|passwd|secret|token|api[_-]?key|authorization|cookie|set[_-]?cookie|config[_-]?encryption[_-]?key|admin[_-]?token)/iu;
const SECRET_MARKER_PATTERN = /(?:portal_session=|authorization\s*[:=]\s*(?:bearer|basic)|set-cookie\s*:|cookie\s*:)/iu;
const URL_PATTERN = /https?:\/\/[^\s"'<>]+/giu;

export const PRODUCTION_ACCEPTANCE_MANIFEST_VERSION = 1;
export const PRODUCTION_ACCEPTANCE_MODE = "read-only-baseline";

export function parseImmutableImageReference(value) {
  const reference = String(value ?? "").trim();
  if (!reference || /\s/u.test(reference)) {
    throw new Error("acceptance_image_reference_invalid");
  }
  const separator = reference.lastIndexOf("@");
  if (separator <= 0 || separator === reference.length - 1) {
    throw new Error("acceptance_image_digest_required");
  }
  const repository = reference.slice(0, separator);
  const digest = reference.slice(separator + 1).toLowerCase();
  if (!repository || !IMAGE_DIGEST_PATTERN.test(digest)) {
    throw new Error("acceptance_image_digest_invalid");
  }
  return Object.freeze({ reference: `${repository}@${digest}`, repository, digest });
}

export function normalizeCommitSha(value) {
  const commitSha = String(value ?? "").trim().toLowerCase();
  if (!COMMIT_PATTERN.test(commitSha)) throw new Error("acceptance_commit_sha_invalid");
  return commitSha;
}

export function acceptanceProjectName(imageDigest) {
  const digest = String(imageDigest ?? "").trim().toLowerCase();
  if (!IMAGE_DIGEST_PATTERN.test(digest)) throw new Error("acceptance_image_digest_invalid");
  return `portal-accept-${digest.slice("sha256:".length, "sha256:".length + 12)}`;
}

export function createProductionAcceptanceManifest({ imageReference, commitSha }) {
  const image = parseImmutableImageReference(imageReference);
  const sourceCommit = normalizeCommitSha(commitSha);
  const projectName = acceptanceProjectName(image.digest);
  return Object.freeze({
    schemaVersion: PRODUCTION_ACCEPTANCE_MANIFEST_VERSION,
    mode: PRODUCTION_ACCEPTANCE_MODE,
    destructive: false,
    source: Object.freeze({ commitSha: sourceCommit }),
    image,
    compose: Object.freeze({
      projectName,
      service: "dashboard",
      expectedDataVolume: `${projectName}_dashboard-data`,
      imageEnvironmentVariable: "PORTAL_IMAGE",
      serviceEnvFile: ".env.acceptance",
      environment: Object.freeze({
        PORTAL_IMAGE: image.reference,
        PORTAL_SERVICE_ENV_FILE: ".env.acceptance",
      }),
      args: Object.freeze([
        "docker",
        "compose",
        "--project-name",
        projectName,
        "--env-file",
        ".env.acceptance",
        "-f",
        "compose.yaml",
        "up",
        "-d",
        "--no-build",
        "dashboard",
      ]),
    }),
    baseline: Object.freeze([
      Object.freeze({
        id: "liveness",
        method: "GET",
        path: "/health/live",
        expectedStatus: Object.freeze([200]),
        requiredJson: Object.freeze({ state: "healthy", code: "health_live", ok: true }),
      }),
      Object.freeze({
        id: "readiness",
        method: "GET",
        path: "/health/ready",
        expectedStatus: Object.freeze([200]),
        requiredJson: Object.freeze({ state: "healthy", code: "health_ready", ok: true }),
      }),
      Object.freeze({
        id: "dependencies",
        method: "GET",
        path: "/health/dependencies",
        expectedStatus: Object.freeze([200]),
        requiredJson: Object.freeze({ state: "healthy", code: "dependencies_healthy", ok: true }),
      }),
      Object.freeze({
        id: "maintenance",
        method: "GET",
        path: "/api/maintenance/status",
        expectedStatus: Object.freeze([200]),
        requiredJson: Object.freeze({ maintenance: false, state: "inactive", recoveryRequired: false }),
      }),
    ]),
  });
}

export function validateProductionAcceptanceManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("acceptance_manifest_invalid");
  }
  if (manifest.schemaVersion !== PRODUCTION_ACCEPTANCE_MANIFEST_VERSION) {
    throw new Error("acceptance_manifest_version_unsupported");
  }
  if (manifest.mode !== PRODUCTION_ACCEPTANCE_MODE || manifest.destructive !== false) {
    throw new Error("acceptance_manifest_mode_invalid");
  }

  const image = parseImmutableImageReference(manifest.image?.reference);
  const commitSha = normalizeCommitSha(manifest.source?.commitSha);
  const expectedProject = acceptanceProjectName(image.digest);
  if (manifest.image?.digest !== image.digest || manifest.image?.repository !== image.repository) {
    throw new Error("acceptance_manifest_image_mismatch");
  }
  if (manifest.compose?.projectName !== expectedProject) {
    throw new Error("acceptance_manifest_project_mismatch");
  }
  if (manifest.compose?.expectedDataVolume !== `${expectedProject}_dashboard-data`) {
    throw new Error("acceptance_manifest_volume_mismatch");
  }
  if (manifest.compose?.service !== "dashboard" || manifest.compose?.serviceEnvFile !== ".env.acceptance") {
    throw new Error("acceptance_manifest_compose_invalid");
  }
  if (
    manifest.compose?.environment?.PORTAL_IMAGE !== image.reference
    || manifest.compose?.environment?.PORTAL_SERVICE_ENV_FILE !== ".env.acceptance"
  ) {
    throw new Error("acceptance_manifest_environment_invalid");
  }

  const expectedArgs = [
    "docker",
    "compose",
    "--project-name",
    expectedProject,
    "--env-file",
    ".env.acceptance",
    "-f",
    "compose.yaml",
    "up",
    "-d",
    "--no-build",
    "dashboard",
  ];
  if (!Array.isArray(manifest.compose?.args) || manifest.compose.args.length !== expectedArgs.length) {
    throw new Error("acceptance_manifest_compose_args_invalid");
  }
  for (let index = 0; index < expectedArgs.length; index += 1) {
    if (manifest.compose.args[index] !== expectedArgs[index]) {
      throw new Error("acceptance_manifest_compose_args_invalid");
    }
  }

  if (!Array.isArray(manifest.baseline) || manifest.baseline.length !== 4) {
    throw new Error("acceptance_manifest_baseline_invalid");
  }
  const ids = new Set();
  for (const check of manifest.baseline) {
    if (!check || typeof check !== "object" || Array.isArray(check)) {
      throw new Error("acceptance_manifest_baseline_invalid");
    }
    if (typeof check.id !== "string" || !check.id || ids.has(check.id)) {
      throw new Error("acceptance_manifest_baseline_invalid");
    }
    ids.add(check.id);
    if (check.method !== "GET" || typeof check.path !== "string" || !check.path.startsWith("/")) {
      throw new Error("acceptance_manifest_baseline_invalid");
    }
    if (!Array.isArray(check.expectedStatus) || check.expectedStatus.length === 0) {
      throw new Error("acceptance_manifest_baseline_invalid");
    }
    if (!check.expectedStatus.every((status) => Number.isInteger(status) && status >= 100 && status <= 599)) {
      throw new Error("acceptance_manifest_baseline_invalid");
    }
    if (!check.requiredJson || typeof check.requiredJson !== "object" || Array.isArray(check.requiredJson)) {
      throw new Error("acceptance_manifest_baseline_invalid");
    }
  }

  const expectedManifest = createProductionAcceptanceManifest({
    imageReference: image.reference,
    commitSha,
  });

  const canonicalJson = (value) => {
    if (Array.isArray(value)) return value.map(canonicalJson);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]),
      );
    }
    return value;
  };

  if (JSON.stringify(canonicalJson(manifest)) !== JSON.stringify(canonicalJson(expectedManifest))) {
    throw new Error("acceptance_manifest_mismatch");
  }

  return Object.freeze({
    image,
    commitSha,
    projectName: expectedProject,
  });
}

function scanString(value, path, findings, secretValues, { key = false } = {}) {
  if (key && SENSITIVE_KEY_PATTERN.test(value)) findings.push({ code: "sensitive_report_key", path });

  for (const secret of secretValues) {
    if (secret && value.includes(secret)) {
      findings.push({ code: "secret_value_present", path });
      break;
    }
  }
  if (SECRET_MARKER_PATTERN.test(value)) findings.push({ code: "credential_marker_present", path });
  if ((value.match(URL_PATTERN) ?? []).length > 0) findings.push({ code: "url_present_in_report", path });
}

function walk(value, path, findings, secretValues) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}.item[${index}]`, findings, secretValues));
    return;
  }
  if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, child], index) => {
      const keyPath = `${path}.key[${index}]`;
      const valuePath = `${path}.value[${index}]`;
      scanString(key, keyPath, findings, secretValues, { key: true });
      walk(child, valuePath, findings, secretValues);
    });
    return;
  }
  if (typeof value === "string") scanString(value, path, findings, secretValues);
}

export function scanProductionAcceptanceReport(report, { secretValues = [] } = {}) {
  const findings = [];
  const normalizedSecrets = Array.from(new Set(secretValues.map((value) => String(value ?? "")).filter(Boolean)));
  walk(report, "$", findings, normalizedSecrets);
  return Object.freeze(findings.map((finding) => Object.freeze(finding)));
}

export function assertProductionAcceptanceReportSafe(report, options = {}) {
  const findings = scanProductionAcceptanceReport(report, options);
  if (findings.length > 0) {
    const evidence = findings.map((finding) => `${finding.code}@${finding.path}`).join(",");
    throw new Error(`acceptance_report_redaction_failed:${evidence}`);
  }
  return true;
}
