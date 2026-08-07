import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const BLOCKING_SEVERITIES = new Set(["high", "critical"]);
const GHSA_PATTERN = /GHSA-[0-9a-z-]+/iu;

function normalizeAdvisoryId(value) {
  const raw = String(value ?? "").trim();
  return /^GHSA-/iu.test(raw) ? raw.toLowerCase() : raw;
}

function advisoryId(via) {
  const url = String(via?.url ?? "");
  const ghsa = url.match(GHSA_PATTERN)?.[0];
  if (ghsa) return normalizeAdvisoryId(ghsa);
  if (via?.source !== undefined && via?.source !== null) return `npm:${via.source}`;
  return normalizeAdvisoryId(url || String(via?.title ?? via?.name ?? "unknown-advisory"));
}

function findingKey(packageName, id) {
  return `${String(packageName ?? "").trim().toLowerCase()}:${normalizeAdvisoryId(id)}`;
}

function expiryInstant(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(String(value ?? ""))) throw new Error(`invalid allowlist expiry: ${value ?? ""}`);
  const date = new Date(`${value}T23:59:59.999Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`invalid allowlist expiry: ${value}`);
  return date;
}

export function validateAllowlist(allowlist, now = new Date()) {
  if (allowlist?.schemaVersion !== 1 || !Array.isArray(allowlist?.entries)) {
    throw new Error("audit allowlist must use schemaVersion 1 with an entries array");
  }

  const seen = new Set();
  for (const [index, entry] of allowlist.entries.entries()) {
    const id = String(entry?.id ?? "").trim();
    const packageName = String(entry?.package ?? "").trim();
    const owner = String(entry?.owner ?? "").trim();
    const reason = String(entry?.reason ?? "").trim();
    const expires = String(entry?.expires ?? "").trim();
    if (!id) throw new Error(`allowlist entry ${index} requires id`);
    if (!packageName) throw new Error(`allowlist entry ${index} requires package`);
    if (!owner) throw new Error(`allowlist entry ${index} requires owner`);
    if (reason.length < 20) throw new Error(`allowlist entry ${index} requires a meaningful reason`);
    if (expiryInstant(expires).getTime() < now.getTime()) throw new Error(`allowlist entry ${index} expired on ${expires}`);
    const key = findingKey(packageName, id);
    if (seen.has(key)) throw new Error(`duplicate allowlist entry: ${packageName}:${id}`);
    seen.add(key);
  }
  return allowlist;
}

export function collectBlockingFindings(report) {
  const findings = [];
  const seen = new Set();
  for (const [packageKey, vulnerability] of Object.entries(report?.vulnerabilities ?? {})) {
    for (const via of Array.isArray(vulnerability?.via) ? vulnerability.via : []) {
      if (!via || typeof via !== "object") continue;
      const severity = String(via.severity ?? vulnerability?.severity ?? "").toLowerCase();
      if (!BLOCKING_SEVERITIES.has(severity)) continue;
      const packageName = String(via.name ?? vulnerability?.name ?? packageKey);
      const id = advisoryId(via);
      const key = findingKey(packageName, id);
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({
        id,
        package: packageName,
        severity,
        title: String(via.title ?? "Known production dependency vulnerability"),
        url: String(via.url ?? ""),
      });
    }
  }
  return findings.sort((left, right) => findingKey(left.package, left.id).localeCompare(findingKey(right.package, right.id)));
}

export function evaluateAuditReport(report, allowlist, now = new Date()) {
  validateAllowlist(allowlist, now);
  const findings = collectBlockingFindings(report);
  const entries = new Map(allowlist.entries.map((entry) => [findingKey(entry.package, entry.id), entry]));
  const matched = new Set();
  const blocked = [];
  const allowed = [];

  for (const finding of findings) {
    const key = findingKey(finding.package, finding.id);
    const exception = entries.get(key);
    if (exception) {
      matched.add(key);
      allowed.push({ ...finding, exception });
    } else {
      blocked.push(finding);
    }
  }

  const stale = [...entries.entries()].filter(([key]) => !matched.has(key)).map(([, entry]) => `${entry.package}:${entry.id}`);
  if (stale.length) throw new Error(`stale allowlist entries: ${stale.join(", ")}`);
  return { blocked, allowed, findings };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function runDependencyAuditPolicy({
  allowlistPath = fileURLToPath(new URL("../security/audit-allowlist.json", import.meta.url)),
  now = new Date(),
} = {}) {
  const audit = spawnSync("npm", ["audit", "--omit=dev", "--json"], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (audit.error) throw audit.error;

  let report;
  try {
    report = JSON.parse(audit.stdout || "");
  } catch {
    throw new Error(`npm audit did not return valid JSON${audit.stderr ? `: ${audit.stderr.trim().slice(0, 240)}` : ""}`);
  }
  if (!report || typeof report.vulnerabilities !== "object") {
    const message = String(report?.error?.summary ?? report?.error?.code ?? "invalid audit report");
    throw new Error(`npm audit failed: ${message}`);
  }

  const allowlist = readJson(allowlistPath);
  const result = evaluateAuditReport(report, allowlist, now);
  for (const finding of result.allowed) {
    process.stdout.write(`ALLOWLISTED ${finding.severity} ${finding.package} ${finding.id} until ${finding.exception.expires}\n`);
  }
  for (const finding of result.blocked) {
    process.stderr.write(`BLOCKED ${finding.severity} ${finding.package} ${finding.id}: ${finding.title}\n`);
  }
  process.stdout.write(`Production audit: ${result.blocked.length} blocked, ${result.allowed.length} temporarily allowlisted high/critical advisories.\n`);
  return result.blocked.length === 0 ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.exitCode = runDependencyAuditPolicy();
  } catch (error) {
    process.stderr.write(`Dependency audit policy failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
