import { appendFileSync, readFileSync } from "node:fs";

import { parseChangedInputs } from "./auth-e2e-scope.mjs";

export const CI_JOB_KEYS = Object.freeze([
  "discover-tests",
  "docs-consistency",
  "dependency-security",
  "build",
  "container-security",
  "recovery-compose",
  "test",
]);

const ordinaryDocsPatterns = Object.freeze([
  /^docs\/guide\/README\.md$/u,
  /^docs\/guide\/(?:getting-started|user|operator|administrator|support|concepts|troubleshooting)\/.*\.md$/u,
]);

const routingControlPaths = new Set([
  ".github/workflows/ci.yml",
  "scripts/auth-e2e-scope.mjs",
  "scripts/ci-required-plan.mjs",
  "scripts/ci-required-gate.mjs",
]);

const containerSecurityPatterns = Object.freeze([
  /^Dockerfile$/u,
  /^\.dockerignore$/u,
  /^package(?:-lock)?\.json$/u,
  /^security\/audit-allowlist\.json$/u,
  /^scripts\/dependency-audit-policy\.mjs$/u,
  /^\.github\/workflows\/security-scan\.yml$/u,
]);

const recoveryPatterns = Object.freeze([
  /^Dockerfile$/u,
  /^package(?:-lock)?\.json$/u,
  /^compose\.yaml$/u,
  /^\.env\.example$/u,
  /^src\/(?:recovery|backup|storage)\//u,
  /^db\//u,
  /^scripts\/portal-recovery\.ts$/u,
  /^scripts\/(?:config-encryption-key|identity-startup-policy|start-production|node-runtime-http|node-worker-host)\.mjs$/u,
  /^scripts\/.*(?:backup|storage|migration|integrity|maintenance|recovery).*\.(?:mjs|ts|sh)$/u,
  /^tests\/(?:recovery|storage)\//u,
  /^tests\/runtime\/.*(?:diagnostic|identity|encryption|startup|maintenance).*\.(?:mjs|ts)$/u,
]);

function normalizedPath(value) {
  return String(value ?? "").replace(/^\.\//u, "");
}

export function isOrdinaryDocumentationPath(path) {
  const value = normalizedPath(path);
  return Boolean(value) && ordinaryDocsPatterns.some((pattern) => pattern.test(value));
}

function matchesAny(path, patterns) {
  return patterns.some((pattern) => pattern.test(path));
}

export function assessRequiredCIJobs(changes, { full = false } = {}) {
  const paths = Array.from(changes ?? [], (change) => normalizedPath(typeof change === "string" ? change : change?.path)).filter(Boolean);
  if (full) {
    return {
      containerSecurity: true,
      recoveryCompose: true,
      reasons: ["main/non-PR execution requires container security and recovery coverage"],
    };
  }

  const reasons = [];
  let containerSecurity = false;
  let recoveryCompose = false;

  for (const path of paths) {
    if (routingControlPaths.has(path)) {
      containerSecurity = true;
      recoveryCompose = true;
      reasons.push(`${path} -> CI routing control changed; conservative container + recovery regression`);
      continue;
    }
    if (matchesAny(path, containerSecurityPatterns)) {
      containerSecurity = true;
      reasons.push(`${path} -> runtime image/dependency security composition or enforcement changed`);
    }
    if (matchesAny(path, recoveryPatterns)) {
      recoveryCompose = true;
      reasons.push(`${path} -> recovery/storage/schema/container configuration boundary changed`);
    }
  }

  if (!containerSecurity) reasons.push("no runtime image/dependency composition input changed -> container security scan not required for this PR");
  if (!recoveryCompose) reasons.push("no recovery/storage/schema/container configuration input changed -> recovery container job not required for this PR");

  return { containerSecurity, recoveryCompose, reasons };
}

export function buildRequiredCIPlan(changes, { full = false } = {}) {
  const changedInputs = Array.from(changes ?? [], (change) =>
    typeof change === "string" ? { status: "M", path: change } : { status: String(change?.status ?? "M"), path: String(change?.path ?? "") },
  ).filter(({ path }) => path);

  if (!full && changedInputs.length === 0) throw new Error("CI planner received an empty pull-request diff");

  const docsOnly = !full && changedInputs.every(({ path }) => isOrdinaryDocumentationPath(path));
  const codePathRequired = !docsOnly;
  const risk = assessRequiredCIJobs(changedInputs, { full });
  const jobs = {
    "discover-tests": true,
    "docs-consistency": true,
    "dependency-security": true,
    build: codePathRequired || full,
    "container-security": !docsOnly && risk.containerSecurity,
    "recovery-compose": !docsOnly && risk.recoveryCompose,
    test: codePathRequired || full,
  };

  const mode = docsOnly ? "docs-only" : full ? "full-ci" : "risk-routed-ci";
  const reasons = docsOnly
    ? ["all changed paths are in the positive ordinary user-facing guide prose allowlist; discovery/docs/security policy contracts remain required"]
    : [
        full ? "main/non-PR execution requires the complete CI path" : "PR keeps build + full Node suite while Docker-heavy jobs are selected by affected risk boundary",
        ...risk.reasons,
      ];

  return {
    version: 1,
    mode,
    full,
    docsOnly,
    changedInputs,
    jobs,
    reasons,
  };
}

export function renderRequiredCIPlanSummary(plan) {
  return [
    "## Required CI plan",
    "",
    `**Mode:** ${plan.mode}`,
    `**Docs-only fast path:** ${plan.docsOnly ? "yes" : "no"}`,
    "",
    "### Job requirements",
    ...CI_JOB_KEYS.map((job) => `- ${job}: ${plan.jobs[job] ? "required" : "not required"}`),
    "",
    "### Reasons",
    ...plan.reasons.map((reason) => `- ${reason}`),
    "",
  ].join("\n");
}

export function runRequiredCIPlanCli(argv) {
  const args = [...argv];
  let githubOutput = "";
  let githubStepSummary = "";
  let full = false;
  const positional = [];

  while (args.length) {
    const arg = args.shift();
    if (arg === "--github-output") githubOutput = String(args.shift() ?? "");
    else if (arg === "--github-step-summary") githubStepSummary = String(args.shift() ?? "");
    else if (arg === "--full") full = true;
    else positional.push(arg);
  }

  if (positional.length !== 1) throw new Error("Usage: node scripts/ci-required-plan.mjs [--github-output PATH] [--github-step-summary PATH] [--full] CHANGED_FILES");
  const changedInputs = parseChangedInputs(readFileSync(positional[0], "utf8"));
  const plan = buildRequiredCIPlan(changedInputs, { full });
  const lines = [
    `plan_json=${JSON.stringify(plan)}`,
    `docs_only=${plan.docsOnly ? "true" : "false"}`,
    ...CI_JOB_KEYS.map((job) => `${job.replaceAll("-", "_")}=${plan.jobs[job] ? "true" : "false"}`),
  ].join("\n") + "\n";

  if (githubOutput) appendFileSync(githubOutput, lines, "utf8");
  else process.stdout.write(lines);
  if (githubStepSummary) appendFileSync(githubStepSummary, renderRequiredCIPlanSummary(plan), "utf8");
  return plan;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    runRequiredCIPlanCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Required CI planning failed"}\n`);
    process.exitCode = 1;
  }
}
