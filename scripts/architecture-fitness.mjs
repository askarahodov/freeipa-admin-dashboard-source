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

const runtimeRouterOwners = new Set([
  "worker/application-router.ts",
  "src/auth/portal-route-contract.ts",
  "src/auth/portal-route-router.ts",
  "src/auth/portal-route-security-plan.ts",
]);

function findSourceCycles(graph) {
  const visiting = new Set();
  const visited = new Set();
  const stack = [];
  const cycles = [];
  const seen = new Set();

  function visit(node) {
    if (visited.has(node)) return;
    if (visiting.has(node)) {
      const start = stack.indexOf(node);
      const cycle = [...stack.slice(start), node];
      const key = [...new Set(cycle.slice(0, -1))].sort().join("|");
      if (!seen.has(key)) {
        seen.add(key);
        cycles.push(cycle);
      }
      return;
    }

    visiting.add(node);
    stack.push(node);
    for (const target of graph.get(node) ?? []) visit(target);
    stack.pop();
    visiting.delete(node);
    visited.add(node);
  }

  for (const node of [...graph.keys()].sort()) visit(node);
  return cycles;
}

export function inspectArchitectureFitness(files, options = {}) {
  const entries = files instanceof Map ? [...files.entries()] : Object.entries(files ?? {});
  const normalized = new Map(entries.map(([filePath, source]) => [normalizePath(filePath), String(source ?? "")]));
  const knownPaths = new Set(normalized.keys());
  const issues = [];
  const sourceGraph = new Map(
    [...knownPaths]
      .filter((filePath) => filePath.startsWith("src/"))
      .map((filePath) => [filePath, new Set()]),
  );

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

      if (filePath.startsWith("src/") && target.startsWith("src/") && knownPaths.has(target)) {
        sourceGraph.get(filePath)?.add(target);
      }

      if (filePath.startsWith("src/") && (target.startsWith("worker/") || target.startsWith("runtime/"))) {
        issues.push(issue(
          "reverse-adapter-dependency",
          filePath,
          target,
          `Domain/application module '${filePath}' must not depend on adapter/runtime module '${target}'. Move the contract into src/** or depend in the worker/runtime -> src direction.`,
        ));
      }

      if (filePath.startsWith("runtime/") && runtimeRouterOwners.has(target)) {
        issues.push(issue(
          "runtime-router-ownership",
          filePath,
          target,
          `Runtime host module '${filePath}' must not import HTTP route/application router owner '${target}'. Keep process lifecycle in runtime/** and HTTP/domain routing in the Worker application composition.`,
        ));
      }
    }
  }

  for (const cycle of findSourceCycles(sourceGraph)) {
    issues.push(issue(
      "source-dependency-cycle",
      cycle[0],
      cycle[1] ?? cycle[0],
      `Canonical src/** dependency graph contains a cycle: ${cycle.join(" -> ")}. Break the cycle at a domain/application contract boundary instead of adding adapter indirection.`,
    ));
  }

  const routeContracts = Array.from(options.routeContracts ?? []);
  for (const route of routeContracts) {
    const routeId = String(route?.id ?? "").trim() || "<missing-route-id>";
    const ownerPath = normalizePath(route?.owner);
    if (!ownerPath) {
      issues.push(issue(
        "invalid-route-owner",
        "src/auth/portal-route-contract.ts",
        null,
        `Canonical route '${routeId}' must name one explicit tracked source owner.`,
      ));
      continue;
    }
    if (!knownPaths.has(ownerPath)) {
      issues.push(issue(
        "missing-route-owner",
        "src/auth/portal-route-contract.ts",
        ownerPath,
        `Canonical route '${routeId}' points to missing owner '${ownerPath}'. Update the canonical route owner to the real handler/adapter or restore the tracked owner before merge.`,
      ));
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


  if (options.enforceEntryRegistration === true) {
    const registeredEntryPaths = new Set();

    for (const route of routeContracts) {
      const ownerPath = normalizePath(route?.owner);
      if (ownerPath.endsWith("-entry.ts")) registeredEntryPaths.add(ownerPath);
    }

    for (const value of Object.values(options.applicationComposition ?? {})) {
      const ownerPath = normalizePath(value);
      if (ownerPath.endsWith("-entry.ts")) registeredEntryPaths.add(ownerPath);
    }

    for (const adapter of adapters) {
      const adapterPath = normalizePath(adapter?.path);
      if (adapterPath.endsWith("-entry.ts")) registeredEntryPaths.add(adapterPath);
    }

    const internalEntries = Array.from(options.internalEntryAdapters ?? []).map(normalizePath);
    const internalEntryPaths = new Set();
    for (const entryPath of internalEntries) {
      if (!/^worker\/[^/]+-entry\.ts$/u.test(entryPath)) {
        issues.push(issue(
          "invalid-internal-entry-registration",
          "worker/application-composition-contract.ts",
          entryPath || null,
          `Internal entry registration '${entryPath || "<empty>"}' must name one worker/*-entry.ts source file.`,
        ));
        continue;
      }
      if (internalEntryPaths.has(entryPath)) {
        issues.push(issue(
          "duplicate-internal-entry-registration",
          "worker/application-composition-contract.ts",
          entryPath,
          `Internal entry adapter '${entryPath}' is registered more than once.`,
        ));
      }
      internalEntryPaths.add(entryPath);
      registeredEntryPaths.add(entryPath);
      if (!knownPaths.has(entryPath)) {
        issues.push(issue(
          "missing-internal-entry-registration-target",
          "worker/application-composition-contract.ts",
          entryPath,
          `Registered internal entry adapter '${entryPath}' is missing from the tracked source snapshot.`,
        ));
      }
    }

    for (const filePath of [...knownPaths].filter((candidate) => /^worker\/[^/]+-entry\.ts$/u.test(candidate)).sort()) {
      if (registeredEntryPaths.has(filePath)) continue;
      issues.push(issue(
        "unregistered-entry-wrapper",
        filePath,
        null,
        `Worker entry adapter '${filePath}' is not registered as a canonical route owner, application composition owner, compatibility adapter, or internal domain adapter. Register the legitimate owner boundary in worker/application-composition-contract.ts or use an existing canonical handler/module instead of adding a hidden wrapper.`,
      ));
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
