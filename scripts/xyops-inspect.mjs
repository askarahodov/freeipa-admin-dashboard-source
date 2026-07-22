#!/usr/bin/env node

import { existsSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const INSPECTOR_VERSION = 1;
const DEFAULT_PROBES = [
  { name: "events", path: "/api/app/get_events/v1", required: true },
  { name: "servers", path: "/api/app/get_servers/v1" },
  { name: "server_groups", path: "/api/app/get_server_groups/v1" },
  { name: "toolsets", path: "/api/app/get_toolsets/v1" },
  { name: "active_jobs", path: "/api/app/get_active_jobs/v1" },
];

const secretKey = /(?:pass(?:word)?|secret|token|api[_-]?key|authorization|cookie|credential|private[_-]?key|session)/i;
const safeLiteralKey = /^(?:type|kind|variant|format|target|destination|scope|category|plugin|required|enabled|multiple|min|max|status|code|active|dangerous|requires_confirmation)$/i;
const identityKey = /^(?:id|event_id|job_id|server_id|hostname|host|name|title|label|description|url|email|username|user)$/i;

function scalar(value, key, includeNames) {
  if (secretKey.test(key)) return "[REDACTED]";
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value !== "string") return `<${typeof value}>`;
  if (safeLiteralKey.test(key)) return value.slice(0, 160);
  if (/url/i.test(key)) return "[REDACTED_URL]";
  if (identityKey.test(key) && includeNames) return value.slice(0, 160);
  return `<string:${value.length}>`;
}

export function sanitize(value, { includeNames = false, maxItems = 8, depth = 0, key = "" } = {}) {
  if (depth > 12) return "[MAX_DEPTH]";
  if (value === null || typeof value !== "object") return scalar(value, key, includeNames);
  if (Array.isArray(value)) {
    return {
      $type: "array",
      $count: value.length,
      $items: value.slice(0, maxItems).map((item) => sanitize(item, { includeNames, maxItems, depth: depth + 1, key })),
      ...(value.length > maxItems ? { $truncated: value.length - maxItems } : {}),
    };
  }
  const result = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    result[childKey] = secretKey.test(childKey) ? "[REDACTED]" : sanitize(childValue, { includeNames, maxItems, depth: depth + 1, key: childKey });
  }
  return result;
}

export function collectShape(value) {
  const paths = new Map();
  const visit = (current, path, depth) => {
    if (depth > 12) return;
    const type = current === null ? "null" : Array.isArray(current) ? "array" : typeof current;
    if (!paths.has(path)) paths.set(path, new Set());
    paths.get(path).add(type);
    if (Array.isArray(current)) current.slice(0, 20).forEach((item) => visit(item, `${path}[]`, depth + 1));
    else if (current && typeof current === "object") Object.entries(current).forEach(([key, child]) => visit(child, `${path}.${key}`, depth + 1));
  };
  visit(value, "$", 0);
  return [...paths.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([path, types]) => ({ path, types: [...types].sort() }));
}

function parseJson(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { $nonJsonBody: `<string:${text.length}>` }; }
}

export async function inspectXyops({ baseUrl, apiKey, includeNames = false, timeoutMs = 15000, probes = DEFAULT_PROBES, fetchImpl = fetch }) {
  if (!apiKey) throw new Error("XYOPS_API_KEY is required");
  const parsed = new URL(baseUrl);
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error("XYOPS_URL must be an HTTP(S) URL without embedded credentials");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 100 || timeoutMs > 120000) throw new Error("timeoutMs must be between 100 and 120000");
  const origin = parsed.href.replace(/\/$/, "");
  const results = [];
  for (const probe of probes) {
    const started = Date.now();
    try {
      const response = await fetchImpl(`${origin}${probe.path}`, { method: "GET", headers: { "x-api-key": apiKey, accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs), redirect: "manual" });
      const text = await response.text();
      const payload = parseJson(text);
      results.push({ name: probe.name, path: probe.path, required: probe.required === true, ok: response.ok, status: response.status, durationMs: Date.now() - started, contentType: response.headers.get("content-type") ?? "", shape: collectShape(payload), sample: sanitize(payload, { includeNames }) });
    } catch (error) {
      results.push({ name: probe.name, path: probe.path, required: probe.required === true, ok: false, status: 0, durationMs: Date.now() - started, error: error instanceof Error ? error.name : "RequestError", shape: [], sample: null });
    }
  }
  const requiredFailures = results.filter((result) => result.required && !result.ok).map((result) => result.name);
  return {
    inspector: { name: "xyops-contract-inspector", version: INSPECTOR_VERSION, generatedAt: new Date().toISOString(), safeMode: true, includeNames, notes: ["No API key, request headers or raw response bodies are stored.", "Review this file before sharing because custom field names and object keys are retained."] },
    target: { protocol: parsed.protocol.replace(":", ""), host: includeNames ? parsed.host : "[REDACTED_HOST]" },
    summary: { probes: results.length, succeeded: results.filter((result) => result.ok).length, failed: results.filter((result) => !result.ok).length, requiredFailures },
    results,
  };
}

function parseArgs(argv) {
  const options = { includeNames: false, force: false, output: "", url: "", timeoutMs: 15000 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index] ?? "";
    if (arg === "--include-names") options.includeNames = true;
    else if (arg === "--force") options.force = true;
    else if (arg === "--output") options.output = next();
    else if (arg.startsWith("--output=")) options.output = arg.slice(9);
    else if (arg === "--url") options.url = next();
    else if (arg.startsWith("--url=")) options.url = arg.slice(6);
    else if (arg === "--timeout") options.timeoutMs = Number(next());
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function usage() {
  return `XYOps Contract Inspector\n\nUsage:\n  XYOPS_URL=https://xyops.example XYOPS_API_KEY=... npm run inspect:xyops\n\nOptions:\n  --url URL             Override XYOPS_URL (never pass the API key as an argument)\n  --output FILE         Output path; default is timestamped\n  --timeout MS          Per-request timeout; default 15000\n  --include-names       Preserve IDs, names, titles and host (URLs stay redacted)\n  --force               Replace an existing output file\n  --help                 Show this help\n`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { process.stdout.write(usage()); return; }
  const baseUrl = options.url || process.env.XYOPS_URL || "";
  const apiKey = process.env.XYOPS_API_KEY || "";
  if (!baseUrl) throw new Error("XYOPS_URL or --url is required");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const output = resolve(options.output || `xyops-inspection-${stamp}.json`);
  if (/^\.env(?:\.|$)/i.test(basename(output))) throw new Error("Refusing to write diagnostic data to an environment file");
  if (existsSync(output) && !options.force) throw new Error(`Output already exists: ${output}. Use --force to replace it.`);
  const report = await inspectXyops({ baseUrl, apiKey, includeNames: options.includeNames, timeoutMs: options.timeoutMs });
  await mkdir(dirname(output), { recursive: true });
  const temporary = `${output}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, output);
  process.stdout.write(`XYOps inspection saved: ${output}\nSuccessful probes: ${report.summary.succeeded}/${report.summary.probes}\n`);
  if (report.summary.requiredFailures.length) { process.stderr.write(`Required probes failed: ${report.summary.requiredFailures.join(", ")}\n`); process.exitCode = 2; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { process.stderr.write(`Inspector failed: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
}
