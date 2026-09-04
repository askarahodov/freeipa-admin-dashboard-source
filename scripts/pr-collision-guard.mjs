const HIGH_CONFLICT_EXACT_PATHS = new Set([
  "app/page.tsx",
  "worker/index.ts",
  "package.json",
  "package-lock.json",
  "src/auth/portal-permissions.ts",
  "src/auth/portal-route-contract.ts",
  "src/auth/local-auth.ts",
  "src/auth/local-session-management.ts",
  "src/auth/admin-session-authorization.ts",
  "docs/SOURCE_OF_TRUTH.md",
  "docs/architecture/ARCHITECTURE.md",
  "docs/architecture/PROJECT_STRUCTURE.md",
  "docs/SECURITY_MODEL.md",
  "docs/ai/README.md",
]);

const HIGH_CONFLICT_PREFIXES = Object.freeze([
  "db/",
  ".github/workflows/",
]);

function normalizePath(value) {
  return String(value ?? "")
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\.\//u, "");
}

function normalizedTitle(value) {
  return String(value ?? "")
    .replace(/\s+/gu, " ")
    .trim();
}

export function isHighConflictPath(value) {
  const path = normalizePath(value);
  if (!path) return false;
  if (HIGH_CONFLICT_EXACT_PATHS.has(path)) return true;
  return HIGH_CONFLICT_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export function analyzePullRequestCollisions({ currentPrNumber, currentFiles, pullRequests }) {
  const currentNumber = Number(currentPrNumber);
  const currentPathSet = new Set(
    Array.from(currentFiles ?? [], normalizePath).filter(Boolean),
  );
  const conflictsByPath = new Map();

  for (const pullRequest of pullRequests ?? []) {
    const number = Number(pullRequest?.number);
    if (!Number.isInteger(number) || number === currentNumber) continue;
    if (String(pullRequest?.state ?? "").toLowerCase() !== "open") continue;
    if (String(pullRequest?.base ?? "") !== "main") continue;

    const seenPaths = new Set();
    for (const rawPath of pullRequest?.files ?? []) {
      const path = normalizePath(rawPath);
      if (!path || seenPaths.has(path) || !currentPathSet.has(path)) continue;
      seenPaths.add(path);

      const existing = conflictsByPath.get(path) ?? [];
      existing.push({ number, title: normalizedTitle(pullRequest?.title) });
      conflictsByPath.set(path, existing);
    }
  }

  const overlaps = Array.from(conflictsByPath, ([path, pullRequestEntries]) => ({
    severity: isHighConflictPath(path) ? "BLOCKING" : "INFO",
    path,
    pullRequests: pullRequestEntries
      .sort((left, right) => left.number - right.number)
      .filter((entry, index, entries) => index === 0 || entries[index - 1].number !== entry.number),
  })).sort((left, right) => {
    if (left.severity !== right.severity) return left.severity === "BLOCKING" ? -1 : 1;
    return left.path.localeCompare(right.path);
  });

  return {
    overlaps,
    blocking: overlaps.some((entry) => entry.severity === "BLOCKING"),
  };
}

export function formatCollisionReport(result) {
  const overlaps = Array.isArray(result?.overlaps) ? result.overlaps : [];
  if (overlaps.length === 0) {
    return "PR ownership collision check: no overlapping files with other open PRs targeting main.\n";
  }

  const lines = ["PR ownership collision check:"];
  for (const overlap of overlaps) {
    const pullRequests = overlap.pullRequests
      .map((pullRequest) => `#${pullRequest.number} ${normalizedTitle(pullRequest.title)}`)
      .join("; ");
    lines.push(`${overlap.severity} ${overlap.path} -> ${pullRequests}`);
  }

  if (result?.blocking) {
    lines.push(
      "Blocking ownership collision detected: establish ordering/dependency, narrow the PR scope, or replay after the owning PR merges.",
    );
  } else {
    lines.push("Only informational overlap detected; coordinate if both PRs intentionally edit the same ordinary file.");
  }

  return `${lines.join("\n")}\n`;
}
