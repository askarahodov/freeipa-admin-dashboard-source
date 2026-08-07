import { readFileSync } from "node:fs";

const exactRelevantPaths = new Set([
  ".env.example",
  ".env.e2e.example",
  ".env.test.example",
  ".github/workflows/e2e-auth.yml",
  "Dockerfile",
  "admin-session-authorization.ts",
  "audit-log.ts",
  "compose.e2e.yaml",
  "compose.test.yaml",
  "compose.yaml",
  "local-auth.ts",
  "package-lock.json",
  "package.json",
  "tsconfig.json",
  "vite.config.ts",
]);

const relevantPrefixes = [
  "app/",
  "db/",
  "e2e/",
  "scripts/",
  "tests/",
  "worker/",
];

const rootRuntimeSource = /^(?:freeipa|xyops|settings|storage|maintenance|backup|operation|approval|portal|integration|admin|local|health|audit)[^/]*\.(?:ts|tsx|mjs|js)$/u;

export function isAuthE2ERelevantPath(value) {
  const path = String(value ?? "").trim().replace(/^\.\//u, "");
  if (!path) return false;
  if (exactRelevantPaths.has(path)) return true;
  if (relevantPrefixes.some((prefix) => path.startsWith(prefix))) return true;
  return rootRuntimeSource.test(path);
}

export function shouldRunAuthE2E(paths) {
  return Array.from(paths ?? []).some(isAuthE2ERelevantPath);
}

function runCli(argv) {
  const args = [...argv];
  let githubOutput = "";
  if (args[0] === "--github-output") {
    githubOutput = String(args[1] ?? "");
    args.splice(0, 2);
  }
  if (args.length !== 1) throw new Error("Usage: node scripts/auth-e2e-scope.mjs [--github-output PATH] CHANGED_FILES");
  const paths = readFileSync(args[0], "utf8").split(/\r?\n/u).map((value) => value.trim()).filter(Boolean);
  const run = shouldRunAuthE2E(paths);
  const result = `run=${run ? "true" : "false"}\n`;
  if (githubOutput) {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(githubOutput, result, "utf8");
  } else {
    process.stdout.write(result);
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  runCli(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Auth E2E scope failed"}\n`);
    process.exitCode = 1;
  });
}
