export type RunResultValue = {
  key: string;
  label: string;
  value: string;
  kind: "text" | "number" | "boolean" | "json";
};

export type RunResultLink = {
  id: string;
  title: string;
  url: string;
  host: string;
};

export type RunResultFile = {
  id: string;
  filename: string;
  size: number;
  mimeType: string;
  downloadUrl: string;
};

export type RunResultTable = {
  columns: string[];
  rows: string[][];
};

export type PublicRunResult = {
  available: boolean;
  summary: string;
  values: RunResultValue[];
  links: RunResultLink[];
  files: RunResultFile[];
  table: RunResultTable | null;
  capturedAt: number;
  truncated: boolean;
};

type StoredRunResultFile = Omit<RunResultFile, "downloadUrl"> & { path: string };
type ResultEnv = { DB?: D1Database };

const createResultTable = `CREATE TABLE IF NOT EXISTS operation_run_results (
  run_id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL,
  summary TEXT,
  values_json TEXT NOT NULL DEFAULT '[]',
  links_json TEXT NOT NULL DEFAULT '[]',
  files_json TEXT NOT NULL DEFAULT '[]',
  table_json TEXT,
  truncated INTEGER NOT NULL DEFAULT 0,
  captured_at INTEGER NOT NULL
)`;

const sensitiveKey = /(?:pass(?:word)?|secret|token|api[_-]?key|authorization|cookie|credential|private[_-]?key|session|bearer|signature|signed)/i;
const ansiPattern = /\u001b\[[0-?]*[ -/]*[@-~]/g;

function cleanText(value: unknown, limit = 500): string {
  return String(value ?? "")
    .replace(ansiPattern, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim()
    .slice(0, limit);
}

function labelFromPath(path: string): string {
  const leaf = path.split(".").pop()?.replace(/\[\d+\]/g, "") || path;
  return leaf.replace(/[_-]+/g, " ").replace(/([a-zа-яё])([A-ZА-ЯЁ])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase()).slice(0, 120);
}

function fnv(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function safeUrl(value: unknown): URL | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    for (const key of parsed.searchParams.keys()) if (sensitiveKey.test(key)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function scalarKind(value: unknown): RunResultValue["kind"] {
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return typeof value === "string" ? "text" : "json";
}

function scalarText(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return cleanText(value);
  try { return cleanText(JSON.stringify(value), 1000); }
  catch { return ""; }
}

function normalizeTable(raw: unknown): RunResultTable | null {
  const maxColumns = 12;
  const maxRows = 50;
  let source = raw;
  let declaredColumns: unknown = null;
  if (source && typeof source === "object" && !Array.isArray(source)) {
    const object = source as Record<string, unknown>;
    declaredColumns = object.columns ?? object.headers ?? object.cols;
    source = object.rows ?? object.data ?? object.items;
  }
  if (!Array.isArray(source) || !source.length) return null;

  if (source.every((row) => row && typeof row === "object" && !Array.isArray(row))) {
    const rows = source as Record<string, unknown>[];
    const columns = Array.from(new Set(rows.slice(0, maxRows).flatMap((row) => Object.keys(row).filter((key) => !sensitiveKey.test(key))))).slice(0, maxColumns);
    if (!columns.length) return null;
    return {
      columns: columns.map(labelFromPath),
      rows: rows.slice(0, maxRows).map((row) => columns.map((column) => scalarText(row[column]).slice(0, 300))),
    };
  }

  if (!source.every(Array.isArray)) return null;
  const rows = (source as unknown[][]).slice(0, maxRows);
  const width = Math.min(maxColumns, Math.max(...rows.map((row) => row.length), 0));
  if (!width) return null;
  const provided = Array.isArray(declaredColumns) ? declaredColumns.map((item) => cleanText(typeof item === "object" && item ? (item as Record<string, unknown>).title ?? (item as Record<string, unknown>).label ?? (item as Record<string, unknown>).name : item, 120)) : [];
  return {
    columns: Array.from({ length: width }, (_, index) => provided[index] || `Колонка ${index + 1}`),
    rows: rows.map((row) => Array.from({ length: width }, (_, index) => scalarText(row[index]).slice(0, 300))),
  };
}

function safeFilePath(value: unknown): string | null {
  const path = String(value ?? "").replace(/^\/+/, "");
  if (!path || path.length > 1000 || /[\\?#\u0000-\u001f]/.test(path)) return null;
  const segments = path.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return null;
  if (!/^[A-Za-z0-9._~!$&'()*+,;=:@%/-]+$/.test(path)) return null;
  return path;
}

function normalizeFiles(raw: unknown): { files: StoredRunResultFile[]; truncated: boolean } {
  if (!Array.isArray(raw)) return { files: [], truncated: false };
  const files: StoredRunResultFile[] = [];
  let truncated = raw.length > 20;
  for (const item of raw.slice(0, 40)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    if (String(row.source ?? "").toLowerCase() === "input") continue;
    const path = safeFilePath(row.path ?? row.url);
    if (!path) continue;
    const filename = cleanText(row.filename ?? row.name ?? path.split("/").pop() ?? "result.bin", 240) || "result.bin";
    const sizeValue = Number(row.size ?? row.bytes ?? 0);
    const mimeType = cleanText(row.mime_type ?? row.mimeType ?? row.content_type ?? row.type ?? "application/octet-stream", 120) || "application/octet-stream";
    files.push({ id: `file-${fnv(`${path}\0${filename}`)}`, filename, size: Number.isFinite(sizeValue) && sizeValue > 0 ? Math.floor(sizeValue) : 0, mimeType, path });
    if (files.length >= 20) { truncated = true; break; }
  }
  return { files, truncated };
}

function normalizeResult(job: Record<string, unknown>): { summary: string; values: RunResultValue[]; links: RunResultLink[]; files: StoredRunResultFile[]; table: RunResultTable | null; truncated: boolean } {
  const values: RunResultValue[] = [];
  const links: RunResultLink[] = [];
  const seenLinks = new Set<string>();
  let truncated = false;

  const visit = (value: unknown, path: string, depth: number) => {
    if (depth > 5 || values.length >= 24 || links.length >= 12) { truncated = true; return; }
    const key = path.split(".").pop() ?? path;
    if (sensitiveKey.test(key)) return;
    if (value === undefined || typeof value === "function") return;
    if (value === null || typeof value !== "object") {
      const parsedUrl = safeUrl(value);
      if (parsedUrl) {
        if (!seenLinks.has(parsedUrl.href)) {
          seenLinks.add(parsedUrl.href);
          links.push({ id: `link-${fnv(parsedUrl.href)}`, title: labelFromPath(path) || parsedUrl.hostname, url: parsedUrl.href, host: parsedUrl.host.slice(0, 160) });
        }
        return;
      }
      const text = scalarText(value);
      if (text) values.push({ key: path.slice(0, 240), label: labelFromPath(path), value: text, kind: scalarKind(value) });
      return;
    }
    if (Array.isArray(value)) {
      if (value.length > 20) truncated = true;
      if (value.length && value.length <= 12 && value.every((item) => item === null || ["string", "number", "boolean"].includes(typeof item))) {
        const text = cleanText(value.map((item) => scalarText(item)).join(", "), 1000);
        if (text) values.push({ key: path.slice(0, 240), label: labelFromPath(path), value: text, kind: "json" });
        return;
      }
      value.slice(0, 20).forEach((item, index) => visit(item, `${path}[${index}]`, depth + 1));
      return;
    }
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > 30) truncated = true;
    for (const [childKey, child] of entries.slice(0, 30)) visit(child, path ? `${path}.${childKey}` : childKey, depth + 1);
  };

  if (job.data && typeof job.data === "object") visit(job.data, "data", 0);
  const fileResult = normalizeFiles(job.files);
  truncated ||= fileResult.truncated;
  return {
    summary: cleanText(job.description ?? job.message ?? "", 1200),
    values,
    links,
    files: fileResult.files,
    table: normalizeTable(job.table),
    truncated,
  };
}

async function ensureResultTable(env: ResultEnv): Promise<void> {
  if (!env.DB) return;
  await env.DB.prepare(createResultTable).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS operation_run_results_job_idx ON operation_run_results(job_id)").run();
}

function parseJsonArray<T>(value: unknown): T[] {
  try { const parsed = JSON.parse(String(value ?? "[]")); return Array.isArray(parsed) ? parsed as T[] : []; }
  catch { return []; }
}

function publicFromRow(row: Record<string, unknown>): PublicRunResult {
  const runId = String(row.run_id ?? "");
  const storedFiles = parseJsonArray<StoredRunResultFile>(row.files_json);
  const table = (() => { try { const parsed = JSON.parse(String(row.table_json ?? "null")); return parsed && typeof parsed === "object" ? parsed as RunResultTable : null; } catch { return null; } })();
  const summary = cleanText(row.summary ?? "", 1200);
  const values = parseJsonArray<RunResultValue>(row.values_json).slice(0, 24);
  const links = parseJsonArray<RunResultLink>(row.links_json).slice(0, 12);
  const files = storedFiles.slice(0, 20).map(({ path: _path, ...file }) => ({ ...file, downloadUrl: `/api/integrations/runs/${encodeURIComponent(runId)}/files/${encodeURIComponent(file.id)}` }));
  return { available: Boolean(summary || values.length || links.length || files.length || table), summary, values, links, files, table, capturedAt: Number(row.captured_at ?? 0), truncated: Number(row.truncated ?? 0) === 1 };
}

export async function saveRunResult(env: ResultEnv, runId: string, jobId: string, job: Record<string, unknown>): Promise<void> {
  if (!env.DB || !runId || !jobId) return;
  await ensureResultTable(env);
  const result = normalizeResult(job);
  if (!result.summary && !result.values.length && !result.links.length && !result.files.length && !result.table) return;
  await env.DB.prepare("INSERT INTO operation_run_results (run_id, job_id, summary, values_json, links_json, files_json, table_json, truncated, captured_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(run_id) DO UPDATE SET job_id = excluded.job_id, summary = excluded.summary, values_json = excluded.values_json, links_json = excluded.links_json, files_json = excluded.files_json, table_json = excluded.table_json, truncated = excluded.truncated, captured_at = excluded.captured_at")
    .bind(runId.slice(0, 160), jobId.slice(0, 160), result.summary || null, JSON.stringify(result.values), JSON.stringify(result.links), JSON.stringify(result.files), result.table ? JSON.stringify(result.table) : null, result.truncated ? 1 : 0, Date.now()).run();
}

export async function listRunResults(env: ResultEnv, runIds: string[]): Promise<Map<string, PublicRunResult>> {
  const result = new Map<string, PublicRunResult>();
  if (!env.DB || !runIds.length) return result;
  await ensureResultTable(env);
  const ids = runIds.filter(Boolean).slice(0, 200);
  if (!ids.length) return result;
  const placeholders = ids.map(() => "?").join(",");
  const rows = await env.DB.prepare(`SELECT run_id, summary, values_json, links_json, files_json, table_json, truncated, captured_at FROM operation_run_results WHERE run_id IN (${placeholders})`).bind(...ids).all<Record<string, unknown>>();
  for (const row of rows.results ?? []) {
    const runId = String(row.run_id ?? "");
    if (runId) result.set(runId, publicFromRow(row));
  }
  return result;
}

export async function readRunResultFile(env: ResultEnv, runId: string, fileId: string): Promise<StoredRunResultFile | null> {
  if (!env.DB) return null;
  await ensureResultTable(env);
  const row = await env.DB.prepare("SELECT files_json FROM operation_run_results WHERE run_id = ?").bind(runId.slice(0, 160)).first<Record<string, unknown>>();
  if (!row) return null;
  return parseJsonArray<StoredRunResultFile>(row.files_json).find((file) => file.id === fileId) ?? null;
}
