import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

function normalizePath(value) {
  return String(value ?? "").trim().replaceAll("\\", "/").replace(/^\.\//u, "");
}

function importSpecifiers(source) {
  const values = [];
  const patterns = [
    /\b(?:import|export)\s+(?:[^"'\n;]+?\s+from\s+)?["']([^"']+)["']/gu,
    /\bimport\(\s*["']([^"']+)["']\s*\)/gu,
  ];
  for (const pattern of patterns) {
    for (const match of String(source ?? "").matchAll(pattern)) values.push(match[1]);
  }
  return values;
}

function resolveRelativeImport(fromPath, specifier, knownPaths) {
  if (!specifier.startsWith(".")) return null;
  const base = normalizePath(path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), specifier)));
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mjs`,
    `${base}.js`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
    `${base}/index.mjs`,
    `${base}/index.js`,
  ];
  return candidates.find((candidate) => knownPaths.has(candidate)) ?? base;
}

function issue(code, source, target, message) {
  return Object.freeze({ code, source, target: target ?? null, message });
}

export function inspectArchitectureFitness(files, options = {}) {
  const entries = files instanceof Map ? [...files.entries()] : Object.entries(files ?? {});
  const normalized = new Map(entries.map(([filePath, source]) => [normalizePath(filePath), String(source ?? "")]));
  const knownPaths = new Set(normalized.keys());
  const issues = [];

  if (knownPaths.has("worker/index.ts")) {
    issues.push(issue(
      "retired-central-tail",
      "worker/index.ts",
      null,
      "Retired central Worker tail must stay absent. Use the explicit application/domain/framework owners recorded by worker/application-composition-contract.ts.",
    ));
  }

  for (const [filePath, source] of normalized) {
    for (const specifier of importSpecifiers(source)) {
      const target = resolveRelativeImport(filePath, specifier, knownPaths);
      if (!target) continue;

      if (target === "worker/index.ts") {
        issues.push(issue(
          "retired-central-tail-import",
          filePath,
          target,
          `'${filePath}' imports retired 'worker/index.ts'. Import the explicit canonical owner instead.`,
        ));
      }

      if (filePath.startsWith("src/") && (target.startsWith("worker/") || target.startsWith("runtime/"))) {
        issues.push(issue(
          "reverse-adapter-dependency",
          filePath,
          target,
          `Domain/application module '${filePath}' must not depend on adapter/runtime module '${target}'. Move the contract into src/** or depend in the worker/runtime -> src direction.`,
        ));
      }
    }
  }

  const adapters = Array.from(options.compatibilityAdapters ?? []);
  const adapterPaths = new Set();
  for (const adapter of adapters) {
    const adapterPath = normalizePath(adapter?.path);
    if (!adapterPath) {
      issues.push(issue(
        "invalid-compatibility-exception",
        "worker/application-composition-contract.ts",
        null,
        "Compatibility exception must name a repository path.",
      ));
      continue;
    }
    if (adapterPaths.has(adapterPath)) {
      issues.push(issue(
        "duplicate-compatibility-exception",
        "worker/application-composition-contract.ts",
        adapterPath,
        `Compatibility exception '${adapterPath}' is duplicated; every exception must have one owner record.`,
      ));
    }
    adapterPaths.add(adapterPath);
    if (!knownPaths.has(adapterPath)) {
      issues.push(issue(
        "missing-compatibility-exception-target",
        "worker/application-composition-contract.ts",
        adapterPath,
        `Compatibility exception '${adapterPath}' does not exist in the tracked source snapshot.`,
      ));
    }
    for (const field of ["responsibility", "reason", "removalCondition"]) {
      if (String(adapter?.[field] ?? "").trim().length < 20) {
        issues.push(issue(
          "invalid-compatibility-exception",
          "worker/application-composition-contract.ts",
          adapterPath,
          `Compatibility exception '${adapterPath}' must provide an actionable ${field}.`,
        ));
      }
    }
  }

  return issues;
}

export function formatArchitectureFitnessIssues(issues) {
  return issues.map((entry) => {
    const edge = entry.target ? ` -> ${entry.target}` : "";
    return `[${entry.code}] ${entry.source}${edge}: ${entry.message}`;
  }).join("\n");
}

export function validateArchitectureFitness(files, options = {}) {
  const issues = inspectArchitectureFitness(files, options);
  if (issues.length) {
    throw new Error(`Architecture fitness failed:\n${formatArchitectureFitnessIssues(issues)}`);
  }
  return true;
}

export function readTrackedSourceFiles(cwd = process.cwd()) {
  const tracked = execFileSync("git", ["ls-files", "-z"], { cwd, encoding: "utf8" })
    .split("\0")
    .map(normalizePath)
    .filter((filePath) => /^(?:src|worker|runtime)\/.+\.(?:ts|tsx|mjs|js)$/u.test(filePath));
  return new Map(tracked.map((filePath) => [
    filePath,
    fs.readFileSync(path.join(cwd, filePath), "utf8"),
  ]));
}
