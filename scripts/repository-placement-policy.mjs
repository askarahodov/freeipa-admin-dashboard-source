import { execFileSync } from "node:child_process";

export const allowedRootCodeFiles = Object.freeze([
  "drizzle.config.ts",
  "next.config.ts",
  "vite.config.ts",
]);

export const transitionalRootModules = Object.freeze({
  "audit-log.ts": "Legacy audit owner; keep frozen at root until audit/module ownership is migrated with #43/#56.",
  "login-rate-limit.ts": "Legacy authentication protection owner; keep frozen at root until middleware ownership is migrated with #56/#59.",
  "storage-quick-check.ts": "Compatibility re-export; keep frozen at root until storage ownership cleanup is completed with #44.",
});

export const allowedRootDocuments = Object.freeze([
  "AGENTS.md",
  "README.md",
]);

export const allowedMetadataDocuments = Object.freeze([
  ".github/pull_request_template.md",
]);

const generatedRootSegments = new Set([
  ".next",
  ".sites-runtime",
  ".vinext",
  ".wrangler",
  "artifacts",
  "coverage",
  "dist",
  "out",
  "outputs",
  "playwright-report",
  "test-results",
  "work",
]);

const generatedAnyDepthSegments = new Set([
  ".next",
  ".sites-runtime",
  ".vinext",
  ".wrangler",
  "node_modules",
  "playwright-report",
  "test-results",
]);

const fixturePrefixes = ["fixtures/", "e2e/fixtures/", "tests/fixtures/"];
const policyDocumentPattern = /(?:^|[-_])(architecture|conventions?|guidelines?|policy|standards?|testing|workflow)(?:[-_.]|$)/iu;
const rootCodePattern = /^[^/]+\.(?:ts|tsx)$/u;

function normalizePath(value) {
  return String(value ?? "").trim().replaceAll("\\", "/").replace(/^\.\//u, "");
}

function isFixtureOwned(path) {
  return fixturePrefixes.some((prefix) => path.startsWith(prefix));
}

function generatedSegment(path) {
  if (isFixtureOwned(path)) return null;
  const segments = path.split("/");
  const rootSegment = segments[0];
  if (generatedRootSegments.has(rootSegment)) return rootSegment;
  for (const segment of segments.slice(1)) {
    if (generatedAnyDepthSegments.has(segment)) return segment;
  }
  return null;
}

function isMisplacedPolicyDocument(path) {
  if (!path.endsWith(".md")) return false;
  if (allowedRootDocuments.includes(path) || allowedMetadataDocuments.includes(path)) return false;
  const parts = path.split("/");
  const isRootDocument = parts.length === 1;
  const isMetadataDocument = parts.length === 2 && parts[0] === ".github";
  return (isRootDocument || isMetadataDocument) && policyDocumentPattern.test(parts.at(-1));
}

export function classifyRootCodePath(value) {
  const path = normalizePath(value);
  if (!rootCodePattern.test(path)) return { kind: "not-root-code", path };
  if (allowedRootCodeFiles.includes(path)) return { kind: "allowed-config", path };
  if (Object.hasOwn(transitionalRootModules, path)) {
    return { kind: "transitional", path, reason: transitionalRootModules[path] };
  }
  return { kind: "rejected-production-module", path };
}

export function inspectRepositoryPlacement(paths) {
  const normalized = [...new Set(Array.from(paths ?? [], normalizePath).filter(Boolean))].sort();
  const issues = [];

  for (const path of normalized) {
    const generated = generatedSegment(path);
    if (generated) {
      issues.push({
        code: "generated-artifact",
        path,
        message: `Tracked generated/cache artifact '${path}' is not allowed (matched '${generated}'). Keep generated output untracked or place intentional test data under fixtures/.`,
      });
      continue;
    }

    const rootCode = classifyRootCodePath(path);
    if (rootCode.kind === "rejected-production-module") {
      issues.push({
        code: "root-production-module",
        path,
        message: `Production TypeScript module '${path}' must not be added at repository root. Move it under src/, worker/, app/, or another documented domain owner; root TypeScript is limited to ${allowedRootCodeFiles.join(", ")} plus frozen transitional exceptions.`,
      });
    }

    if (isMisplacedPolicyDocument(path)) {
      issues.push({
        code: "misplaced-policy-document",
        path,
        message: `Engineering policy document '${path}' must live under docs/ (normally docs/development/) instead of repository root or .github/.`,
      });
    }
  }

  return issues;
}

export function readTrackedPaths(cwd = process.cwd()) {
  return execFileSync("git", ["ls-files", "-z"], { cwd, encoding: "utf8" })
    .split("\0")
    .map(normalizePath)
    .filter(Boolean);
}

export function formatPlacementIssues(issues) {
  return issues.map((issue) => `[${issue.code}] ${issue.path}: ${issue.message}`).join("\n");
}

export function validateRepositoryPlacement(paths) {
  const issues = inspectRepositoryPlacement(paths);
  if (issues.length) throw new Error(`Repository placement policy failed:\n${formatPlacementIssues(issues)}`);
  return true;
}

export function runRepositoryPlacementPolicy(cwd = process.cwd()) {
  validateRepositoryPlacement(readTrackedPaths(cwd));
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    runRepositoryPlacementPolicy();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Repository placement policy failed"}\n`);
    process.exitCode = 1;
  }
}
