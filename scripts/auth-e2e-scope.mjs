import { appendFileSync, readFileSync } from "node:fs";

const categorySpecs = Object.freeze({
  auth: ["specs/auth/auth.spec.mjs"],
  rbac: ["specs/rbac/rbac-user.spec.mjs", "specs/rbac/role-restrictions.spec.mjs"],
  freeipa: ["specs/freeipa/freeipa-crud.spec.mjs"],
  xyops: ["specs/xyops/xyops-lifecycle.spec.mjs"],
  settings: ["specs/settings/admin-session-settings.spec.mjs", "specs/settings/zz-settings-draft-lifecycle.spec.mjs"],
  ui: ["specs/ui/ui-quality.spec.mjs"],
});

const fullCategories = Object.freeze(Object.keys(categorySpecs));
const alwaysRequiredJobs = Object.freeze([
  "discover-tests",
  "docs-consistency",
  "dependency-security",
  "build",
  "container-security",
  "recovery-compose",
  "test",
  "Required CI",
  "Scoped E2E / routing contract",
]);

const fullRiskPaths = new Map([
  [".github/workflows/e2e-auth.yml", "E2E workflow changed"],
  ["Dockerfile", "runtime/recovery Dockerfile changed"],
  ["e2e/Dockerfile", "browser runtime image changed"],
  ["e2e/playwright.config.mjs", "Playwright runtime configuration changed"],
  ["fixtures/compose/e2e.yaml", "canonical E2E Compose fixture changed"],
  ["fixtures/env/e2e.example", "canonical E2E environment fixture changed"],
  ["package-lock.json", "dependency graph lockfile changed"],
  ["scripts/auth-e2e-scope.mjs", "canonical test routing policy changed"],
  ["scripts/run-auth-e2e.sh", "browser E2E runner changed"],
  ["vite.config.ts", "build/runtime configuration changed"],
]);

const categoryRules = Object.freeze([
  ["auth", /^(?:src\/auth\/(?:local-auth|local-session-management|admin-session-authorization|portal-request-context)\.ts|app\/login\/.*|worker\/local-secure-entry\.ts|e2e\/specs\/auth\/auth\.spec\.mjs|tests\/.*auth.*\.(?:mjs|ts))$/u],
  ["rbac", /^(?:src\/auth\/(?:portal-permissions|portal-route-contract|admin-session-authorization|portal-request-context)\.ts|app\/access\/.*|e2e\/specs\/rbac\/(?:rbac-user|role-restrictions)\.spec\.mjs|tests\/.*(?:rbac|permission|role).*\.(?:mjs|ts))$/u],
  ["freeipa", /^(?:freeipa[^/]*\.(?:ts|tsx|mjs|js)|src\/freeipa\/.*\.(?:ts|tsx|mjs|js)|app\/(?:FreeIpa[^/]*|(?:users|groups)\/.*)|e2e\/(?:fixtures\/freeipa-mock\.mjs|specs\/freeipa\/freeipa-crud\.spec\.mjs)|tests\/(?:[^/]+\/)*[^/]*freeipa[^/]*\.(?:mjs|ts))$/u],
  ["xyops", /^(?:xyops[^/]*\.(?:ts|tsx|mjs|js)|operation[^/]*\.(?:ts|tsx|mjs|js)|approval[^/]*\.(?:ts|tsx|mjs|js)|src\/operations\/.*\.(?:ts|tsx|mjs|js)|app\/(?:(?:Operation|Approval)[^/]*|(?:operations|approvals)\/.*)|e2e\/(?:fixtures\/xyops-mock\.mjs|specs\/xyops\/xyops-lifecycle\.spec\.mjs)|tests\/(?:[^/]+\/)*[^/]*(?:xyops|operation|approval)[^/]*\.(?:mjs|ts))$/u],
  ["settings", /^(?:settings[^/]*\.(?:ts|tsx|mjs|js)|worker\/settings[^/]*\.(?:ts|mjs)|app\/(?:Settings[^/]*|settings\/.*)|e2e\/specs\/settings\/(?:admin-session-settings|zz-settings-draft-lifecycle)\.spec\.mjs|tests\/.*settings.*\.(?:mjs|ts))$/u],
  ["ui", /^(?:app\/.*\.(?:tsx|css|js)|e2e\/specs\/ui\/ui-quality\.spec\.mjs|tests\/.*(?:ui|accessibility|responsive).*\.(?:mjs|ts))$/u],
]);

const schemaContractTests = Object.freeze([
  "tests/storage/portal-schema-inventory.test.mjs",
  "tests/storage/portal-schema-migrations.test.mjs",
  "tests/storage/portal-schema-review-hardening.test.mjs",
  "tests/storage/portal-schema-boundary.test.mjs",
  "tests/runtime/local-diagnostics-schema.test.mjs",
]);
const settingsContractTests = Object.freeze([
  "tests/settings/settings-draft-lifecycle.test.mjs",
  "tests/settings/settings-reset-fallback-refresh.test.mjs",
  "tests/settings/settings-source-runtime-safety.test.mjs",
]);

const packageFullKeys = new Set([
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
  "overrides",
  "engines",
  "packageManager",
  "type",
]);
const packageMetadataKeys = new Set(["name", "version", "private", "displayName", "description", "license"]);
const safePackageScripts = new Set([
  "test",
  "test:recovery",
  "test:integration:smoke",
  "test:local",
  "test:local-auth:acceptance",
  "test:p0:acceptance",
  "docs:check",
  "lint",
  "security:audit",
  "security:sbom",
  "inspect:xyops",
  "inspect:storage",
  "inspect:storage-integrity",
  "inspect:storage-migration-preflight",
  "db:generate",
]);

function normalizePath(value) {
  return String(value ?? "").replace(/^\.\//u, "");
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function sameValue(left, right) {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

export function assessPackageJsonChange(basePackage, headPackage) {
  if (!basePackage || !headPackage) {
    return { full: true, reason: "package.json changed but semantic base/head comparison is unavailable", changedKeys: [] };
  }

  const keys = [...new Set([...Object.keys(basePackage), ...Object.keys(headPackage)])].sort();
  const changedKeys = keys.filter((key) => !sameValue(basePackage[key], headPackage[key]));
  for (const key of changedKeys) {
    if (packageFullKeys.has(key)) return { full: true, reason: `package.json runtime/dependency field changed: ${key}`, changedKeys };
    if (key !== "scripts" && !packageMetadataKeys.has(key)) {
      return { full: true, reason: `package.json unknown semantic field changed conservatively: ${key}`, changedKeys };
    }
  }

  if (changedKeys.includes("scripts")) {
    const baseScripts = basePackage.scripts ?? {};
    const headScripts = headPackage.scripts ?? {};
    const scriptNames = [...new Set([...Object.keys(baseScripts), ...Object.keys(headScripts)])].sort();
    const changedScripts = scriptNames.filter((name) => baseScripts[name] !== headScripts[name]);
    const risky = changedScripts.find((name) => !safePackageScripts.has(name));
    if (risky) return { full: true, reason: `package.json build/runtime or unknown script changed: ${risky}`, changedKeys, changedScripts };
    return { full: false, reason: changedScripts.length ? `package.json test/docs-only scripts changed: ${changedScripts.join(", ")}` : "package.json scripts are semantically unchanged", changedKeys, changedScripts };
  }

  return { full: false, reason: changedKeys.length ? `package.json metadata-only fields changed: ${changedKeys.join(", ")}` : "package.json is semantically unchanged", changedKeys };
}

function validStatus(status) {
  return /^(?:A|M|D|T|U|X|B|R\d{0,3}|C\d{0,3})$/u.test(status);
}

function appendChangedRecord(inputs, status, paths, source) {
  if (!validStatus(status)) throw new Error(`Invalid git diff status: ${status}`);
  const expectedPaths = /^[RC]/u.test(status) ? 2 : 1;
  if (paths.length !== expectedPaths) throw new Error(`Invalid ${expectedPaths === 2 ? "rename/copy" : "git"} diff record: ${source}`);
  for (const pathValue of paths) {
    const path = normalizePath(pathValue);
    if (!path) throw new Error(`Invalid changed path in diff record: ${source}`);
    inputs.push({ status, path });
  }
}

export function parseChangedInputs(content) {
  const text = String(content ?? "");
  const inputs = [];

  if (text.includes("\0")) {
    const fields = text.split("\0");
    if (fields.at(-1) === "") fields.pop();
    let index = 0;
    while (index < fields.length) {
      const status = fields[index++];
      if (!validStatus(status)) throw new Error(`Invalid git diff status: ${status}`);
      const pathCount = /^[RC]/u.test(status) ? 2 : 1;
      const paths = fields.slice(index, index + pathCount);
      if (paths.length !== pathCount) throw new Error(`Invalid NUL-delimited git diff record for status: ${status}`);
      index += pathCount;
      appendChangedRecord(inputs, status, paths, `${status} (NUL-delimited)`);
    }
    return inputs;
  }

  for (const rawLine of text.split(/\r?\n/u)) {
    if (!rawLine) continue;
    const parts = rawLine.split("\t");
    if (parts.length === 1) {
      const path = normalizePath(parts[0]);
      if (!path) throw new Error("Invalid empty changed path");
      inputs.push({ status: "M", path });
      continue;
    }
    appendChangedRecord(inputs, parts[0], parts.slice(1), rawLine);
  }
  return inputs;
}

function categoriesForNormalizedPath(path) {
  const categories = new Set();
  for (const [category, pattern] of categoryRules) {
    if (pattern.test(path)) categories.add(category);
  }
  return [...categories];
}

export function categoriesForPath(value) {
  const path = normalizePath(value);
  if (!path) return [];
  if (fullRiskPaths.has(path) || path.startsWith("e2e/package")) return [...fullCategories];
  return categoriesForNormalizedPath(path);
}

function isSchemaPath(path) {
  return path.startsWith("db/") || path.includes("schema");
}

function isClearlyNonRuntimePath(path) {
  return path.startsWith("docs/") || path.endsWith(".md") || path.startsWith(".github/ISSUE_TEMPLATE/") || path === ".github/pull_request_template.md";
}

function isTestOnlyPath(path) {
  return path.startsWith("tests/");
}

function unknownRuntimeReason(path) {
  if (isClearlyNonRuntimePath(path) || isTestOnlyPath(path) || isSchemaPath(path) || path === "package.json") return "";
  if (/^(?:src|app|worker|fixtures|e2e|scripts)\//u.test(path)) return `unclassified runtime-sensitive path changed: ${path}`;
  return "";
}

export function buildE2ETestPlan(changes, { full = false, packageAssessment = null } = {}) {
  const changedInputs = Array.from(changes ?? [], (change) => {
    if (typeof change === "string") return { status: "M", path: normalizePath(change) };
    return { status: String(change?.status ?? "M"), path: normalizePath(change?.path) };
  }).filter((change) => change.path);
  const reasons = [];
  let fullFallbackReason = full ? "non-PR/manual/scheduled/main execution requires full regression" : "";

  if (!full) {
    for (const { path } of changedInputs) {
      const explicitReason = fullRiskPaths.get(path) ?? (path.startsWith("e2e/package") ? "E2E package dependency graph changed" : "");
      if (explicitReason) {
        fullFallbackReason = explicitReason;
        break;
      }
      if (path === "package.json") {
        if (!packageAssessment) {
          fullFallbackReason = "package.json changed without semantic assessment";
          break;
        }
        reasons.push(packageAssessment.reason);
        if (packageAssessment.full) {
          fullFallbackReason = packageAssessment.reason;
          break;
        }
      }
      const unknownReason = unknownRuntimeReason(path);
      if (unknownReason && categoriesForNormalizedPath(path).length === 0) {
        fullFallbackReason = unknownReason;
        break;
      }
    }
  }

  const runFull = Boolean(fullFallbackReason);
  const categories = new Set(runFull ? fullCategories : []);
  if (!runFull) {
    for (const { path } of changedInputs) {
      const selected = categoriesForNormalizedPath(path);
      for (const category of selected) categories.add(category);
      if (selected.length) reasons.push(`${path} -> ${selected.join(",")}`);
      else if (isClearlyNonRuntimePath(path)) reasons.push(`${path} -> documentation/non-runtime`);
      else if (isTestOnlyPath(path) && !isSchemaPath(path)) reasons.push(`${path} -> server/contract test only`);
    }
  } else {
    reasons.push(`full regression -> ${fullFallbackReason}`);
  }

  const orderedCategories = fullCategories.filter((category) => categories.has(category));
  const browserSpecs = [...new Set(orderedCategories.flatMap((category) => categorySpecs[category]))];
  const contractTests = new Set();
  if (runFull || changedInputs.some(({ path }) => isSchemaPath(path))) {
    for (const test of schemaContractTests) contractTests.add(test);
  }
  if (runFull || categories.has("settings")) {
    for (const test of settingsContractTests) contractTests.add(test);
  }

  const requiredJobs = [...alwaysRequiredJobs];
  if (contractTests.size) requiredJobs.push("Scoped E2E / contract tests");
  if (browserSpecs.length) requiredJobs.push("Scoped E2E / Chromium");

  return {
    run: browserSpecs.length > 0 || contractTests.size > 0,
    full: runFull,
    fullFallbackReason: fullFallbackReason || null,
    changedInputs,
    categories: orderedCategories,
    browserSpecs,
    contractTests: [...contractTests],
    requiredJobs,
    reasons: [...new Set(reasons)],
  };
}

export function isAuthE2ERelevantPath(value) {
  return buildE2ETestPlan([value]).run;
}

export function shouldRunAuthE2E(paths) {
  return buildE2ETestPlan(paths).run;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function summaryText(value) {
  return JSON.stringify(String(value)).slice(1, -1).replace(/`/gu, "\\u0060");
}

function renderPlanSummary(plan) {
  const changed = plan.changedInputs.length
    ? plan.changedInputs.map(({ status, path }) => `- \`${summaryText(status)}\` \`${summaryText(path)}\``).join("\n")
    : "- none (full run requested by event)";
  const reasons = plan.reasons.length ? plan.reasons.map((reason) => `- ${summaryText(reason)}`).join("\n") : "- no browser/contract risk matched";
  return [
    "## Canonical CI / E2E plan",
    "",
    `**Mode:** ${plan.full ? "full regression" : "scoped"}`,
    `**Full fallback reason:** ${plan.fullFallbackReason ? summaryText(plan.fullFallbackReason) : "none"}`,
    `**Categories:** ${plan.categories.join(", ") || "none"}`,
    `**Browser specs:** ${plan.browserSpecs.join(", ") || "none"}`,
    `**Contract tests:** ${plan.contractTests.join(", ") || "none"}`,
    "",
    "### Changed inputs",
    changed,
    "",
    "### Required jobs",
    ...plan.requiredJobs.map((job) => `- ${summaryText(job)}`),
    "",
    "### Reasons",
    reasons,
    "",
  ].join("\n");
}

export function runAuthE2EScopeCli(argv) {
  const args = [...argv];
  let githubOutput = "";
  let githubStepSummary = "";
  let basePackagePath = "";
  let headPackagePath = "";
  let full = false;
  const positional = [];

  while (args.length) {
    const arg = args.shift();
    if (arg === "--github-output") githubOutput = String(args.shift() ?? "");
    else if (arg === "--github-step-summary") githubStepSummary = String(args.shift() ?? "");
    else if (arg === "--base-package") basePackagePath = String(args.shift() ?? "");
    else if (arg === "--head-package") headPackagePath = String(args.shift() ?? "");
    else if (arg === "--full") full = true;
    else positional.push(arg);
  }

  if (positional.length !== 1) throw new Error("Usage: node scripts/auth-e2e-scope.mjs [--github-output PATH] [--github-step-summary PATH] [--base-package PATH --head-package PATH] [--full] CHANGED_FILES");
  const changedInputs = parseChangedInputs(readFileSync(positional[0], "utf8"));
  const packageTouched = changedInputs.some(({ path }) => path === "package.json");
  let packageAssessment = null;
  if (packageTouched) {
    packageAssessment = basePackagePath && headPackagePath
      ? assessPackageJsonChange(readJson(basePackagePath), readJson(headPackagePath))
      : assessPackageJsonChange(null, null);
  }
  const plan = buildE2ETestPlan(changedInputs, { full, packageAssessment });
  const lines = [
    `run=${plan.run ? "true" : "false"}`,
    `full=${plan.full ? "true" : "false"}`,
    `categories=${plan.categories.join(",")}`,
    `browser_specs=${plan.browserSpecs.join(" ")}`,
    `contract_tests=${plan.contractTests.join(" ")}`,
    `required_jobs=${plan.requiredJobs.join(",")}`,
    `full_fallback_reason=${plan.fullFallbackReason ?? ""}`,
  ].join("\n") + "\n";
  if (githubOutput) appendFileSync(githubOutput, lines, "utf8");
  else process.stdout.write(lines);
  if (githubStepSummary) appendFileSync(githubStepSummary, renderPlanSummary(plan), "utf8");
  return plan;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    runAuthE2EScopeCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "E2E scope failed"}\n`);
    process.exitCode = 1;
  }
}
