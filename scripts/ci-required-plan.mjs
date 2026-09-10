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

export function isOrdinaryDocumentationPath(path) {
  const value = String(path ?? "").replace(/^\.\//u, "");
  return Boolean(value) && ordinaryDocsPatterns.some((pattern) => pattern.test(value));
}

export function buildRequiredCIPlan(changes, { full = false } = {}) {
  const changedInputs = Array.from(changes ?? [], (change) =>
    typeof change === "string" ? { status: "M", path: change } : { status: String(change?.status ?? "M"), path: String(change?.path ?? "") },
  ).filter(({ path }) => path);

  if (!full && changedInputs.length === 0) throw new Error("CI planner received an empty pull-request diff");

  const docsOnly = !full && changedInputs.every(({ path }) => isOrdinaryDocumentationPath(path));
  const heavyRequired = !docsOnly;
  const jobs = {
    "discover-tests": true,
    "docs-consistency": true,
    "dependency-security": true,
    build: heavyRequired,
    "container-security": heavyRequired,
    "recovery-compose": heavyRequired,
    test: heavyRequired,
  };

  return {
    version: 1,
    mode: docsOnly ? "docs-only" : "full-ci",
    full,
    docsOnly,
    changedInputs,
    jobs,
    reasons: docsOnly
      ? ["all changed paths are in the positive ordinary user-facing guide prose allowlist; discovery/docs/security policy contracts remain required"]
      : [full ? "main/non-PR execution requires the complete CI path" : "diff is mixed, policy-sensitive, executable, operational/developer documentation, or outside the ordinary-guide allowlist"],
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
