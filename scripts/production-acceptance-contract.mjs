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
      Object.freeze({ id: "liveness", method: "GET", path: "/health/live", expectedStatus: Object.freeze([200]) }),
      Object.freeze({ id: "readiness", method: "GET", path: "/health/ready", expectedStatus: Object.freeze([200, 503]) }),
      Object.freeze({ id: "dependencies", method: "GET", path: "/health/dependencies", expectedStatus: Object.freeze([200, 503]) }),
      Object.freeze({ id: "maintenance", method: "GET", path: "/api/maintenance/status", expectedStatus: Object.freeze([200]) }),
    ]),
  });
}

function walk(value, path, findings, secretValues) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}[${index}]`, findings, secretValues));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const childPath = path ? `${path}.${key}` : key;
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        findings.push({ code: "sensitive_report_key", path: childPath });
      }
      walk(child, childPath, findings, secretValues);
    }
    return;
  }
  if (typeof value !== "string") return;

  for (const secret of secretValues) {
    if (secret && value.includes(secret)) {
      findings.push({ code: "secret_value_present", path });
      break;
    }
  }
  if (SECRET_MARKER_PATTERN.test(value)) findings.push({ code: "credential_marker_present", path });
  const urls = value.match(URL_PATTERN) ?? [];
  if (urls.length > 0) findings.push({ code: "url_present_in_report", path });
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
