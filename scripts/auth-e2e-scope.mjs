import { appendFileSync, readFileSync } from "node:fs";

const categorySpecs = Object.freeze({
  auth: ["specs/auth.spec.mjs"],
  rbac: ["specs/rbac-user.spec.mjs", "specs/role-restrictions.spec.mjs"],
  freeipa: ["specs/freeipa-crud.spec.mjs"],
  xyops: ["specs/xyops-lifecycle.spec.mjs"],
  settings: ["specs/admin-session-settings.spec.mjs", "specs/zz-settings-draft-lifecycle.spec.mjs"],
  ui: ["specs/ui-quality.spec.mjs"],
});

const fullCategories = Object.freeze(Object.keys(categorySpecs));
const fullRiskPaths = new Set([
  ".env.e2e.example",
  ".github/workflows/e2e-auth.yml",
  "Dockerfile",
  "compose.e2e.yaml",
  "e2e/Dockerfile",
  "e2e/playwright.config.mjs",
  "package.json",
  "package-lock.json",
  "scripts/auth-e2e-scope.mjs",
  "scripts/run-auth-e2e.sh",
  "vite.config.ts",
]);

const categoryRules = Object.freeze([
  ["auth", /^(?:local-auth\.ts|admin-session-authorization\.ts|app\/login\/.*|worker\/local-secure-entry\.ts|e2e\/specs\/auth\.spec\.mjs|tests\/.*auth.*\.(?:mjs|ts))$/u],
  ["rbac", /^(?:portal-permissions\.ts|admin-session-authorization\.ts|app\/access\/.*|e2e\/specs\/(?:rbac-user|role-restrictions)\.spec\.mjs|tests\/.*(?:rbac|permission|role).*\.(?:mjs|ts))$/u],
  ["freeipa", /^(?:freeipa[^/]*\.(?:ts|tsx|mjs|js)|app\/(?:FreeIpa[^/]*|(?:users|groups)\/.*)|e2e\/(?:freeipa-mock\.mjs|specs\/freeipa-crud\.spec\.mjs)|tests\/.*freeipa.*\.(?:mjs|ts))$/u],
  ["xyops", /^(?:xyops[^/]*\.(?:ts|tsx|mjs|js)|operation[^/]*\.(?:ts|tsx|mjs|js)|approval[^/]*\.(?:ts|tsx|mjs|js)|src\/operations\/.*\.(?:ts|tsx|mjs|js)|app\/(?:(?:Operation|Approval)[^/]*|(?:operations|approvals)\/.*)|e2e\/(?:xyops-mock\.mjs|specs\/xyops-lifecycle\.spec\.mjs)|tests\/.*(?:xyops|operation|approval).*\.(?:mjs|ts))$/u],
  ["settings", /^(?:settings[^/]*\.(?:ts|tsx|mjs|js)|worker\/settings[^/]*\.(?:ts|mjs)|app\/(?:Settings[^/]*|settings\/.*)|e2e\/specs\/(?:admin-session-settings|zz-settings-draft-lifecycle)\.spec\.mjs|tests\/.*settings.*\.(?:mjs|ts))$/u],
  ["ui", /^(?:app\/.*\.(?:tsx|css|js)|e2e\/specs\/ui-quality\.spec\.mjs|tests\/.*(?:ui|accessibility|responsive).*\.(?:mjs|ts))$/u],
]);

const schemaContractTests = [
  "tests/portal-schema-inventory.test.mjs",
  "tests/portal-schema-migrations.test.mjs",
  "tests/portal-schema-review-hardening.test.mjs",
  "tests/portal-schema-boundary.test.mjs",
  "tests/local-diagnostics-schema.test.mjs",
];
const settingsContractTests = [
  "tests/settings-draft-lifecycle.test.mjs",
  "tests/settings-reset-fallback-refresh.test.mjs",
  "tests/settings-source-runtime-safety.test.mjs",
];

function normalizePath(value) {
  return String(value ?? "").trim().replace(/^\.\//u, "");
}

export function categoriesForPath(value) {
  const path = normalizePath(value);
  if (!path) return [];
  if (fullRiskPaths.has(path) || path.startsWith("e2e/package")) return [...fullCategories];
  const categories = new Set();
  for (const [category, pattern] of categoryRules) {
    if (pattern.test(path)) categories.add(category);
  }
  return [...categories];
}

export function buildE2ETestPlan(paths, { full = false } = {}) {
  const normalized = Array.from(paths ?? [], normalizePath).filter(Boolean);
  const categories = new Set(full ? fullCategories : []);
  if (!full) {
    for (const path of normalized) for (const category of categoriesForPath(path)) categories.add(category);
  }

  const orderedCategories = fullCategories.filter((category) => categories.has(category));
  const browserSpecs = [...new Set(orderedCategories.flatMap((category) => categorySpecs[category]))];
  const contractTests = new Set();
  if (full || normalized.some((path) => path.startsWith("db/") || path.includes("schema"))) {
    for (const test of schemaContractTests) contractTests.add(test);
  }
  if (full || categories.has("settings")) {
    for (const test of settingsContractTests) contractTests.add(test);
  }

  return {
    run: browserSpecs.length > 0 || contractTests.size > 0,
    categories: orderedCategories,
    browserSpecs,
    contractTests: [...contractTests],
  };
}

export function isAuthE2ERelevantPath(value) {
  return buildE2ETestPlan([value]).run;
}

export function shouldRunAuthE2E(paths) {
  return buildE2ETestPlan(paths).run;
}

export function runAuthE2EScopeCli(argv) {
  const args = [...argv];
  let githubOutput = "";
  let full = false;
  if (args[0] === "--github-output") {
    githubOutput = String(args[1] ?? "");
    args.splice(0, 2);
  }
  if (args[0] === "--full") {
    full = true;
    args.splice(0, 1);
  }
  if (args.length !== 1) throw new Error("Usage: node scripts/auth-e2e-scope.mjs [--github-output PATH] [--full] CHANGED_FILES");
  const paths = readFileSync(args[0], "utf8").split(/\r?\n/u).map(normalizePath).filter(Boolean);
  const plan = buildE2ETestPlan(paths, { full });
  const lines = [
    `run=${plan.run ? "true" : "false"}`,
    `categories=${plan.categories.join(",")}`,
    `browser_specs=${plan.browserSpecs.join(" ")}`,
    `contract_tests=${plan.contractTests.join(" ")}`,
  ].join("\n") + "\n";
  if (githubOutput) appendFileSync(githubOutput, lines, "utf8");
  else process.stdout.write(lines);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    runAuthE2EScopeCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "E2E scope failed"}\n`);
    process.exitCode = 1;
  }
}
