import type { CatalogEvent } from "./automation-types";

export type ProcessPresentationOverride = {
  title?: string;
  description?: string;
  category?: string;
  icon?: string;
  order?: number;
  help?: string;
};

export type ProcessPresentationSet = {
  version: 1;
  processes: Record<string, ProcessPresentationOverride>;
};

export type ProcessPresentationState = {
  metadata: ProcessPresentationSet;
  source: "database" | "environment" | "default";
  updatedAt: number | null;
};

type PresentationEnv = {
  DB?: D1Database;
  PORTAL_PROCESS_METADATA_JSON?: string;
};

const emptyMetadata: ProcessPresentationSet = { version: 1, processes: {} };
const createPresentationTable = `CREATE TABLE IF NOT EXISTS process_presentation_sets (
  id TEXT PRIMARY KEY NOT NULL,
  metadata_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
)`;

function cleanText(value: unknown, limit: number): string {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, limit);
}

function processId(value: unknown): string {
  const normalized = cleanText(value, 240);
  if (!normalized || !/^[A-Za-z0-9_.:@/-]+$/.test(normalized)) throw new Error("Process metadata contains an invalid process ID");
  return normalized;
}

function optionalText(value: unknown, limit: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const normalized = cleanText(value, limit);
  return normalized || undefined;
}

function iconValue(value: unknown): string | undefined {
  const icon = optionalText(value, 40);
  if (!icon) return undefined;
  if (!/^[a-z0-9_-]+$/i.test(icon)) throw new Error("Process icon must be a symbolic key such as database, backup or security");
  return icon.toLowerCase();
}

function orderValue(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const order = Number(value);
  if (!Number.isInteger(order) || order < -100000 || order > 100000) throw new Error("Process order must be an integer between -100000 and 100000");
  return order;
}

export function sanitizeProcessPresentationSet(value: unknown): ProcessPresentationSet {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Process metadata must be an object");
  const source = value as Record<string, unknown>;
  if (source.version !== 1) throw new Error("Process metadata version must be 1");
  if (!source.processes || typeof source.processes !== "object" || Array.isArray(source.processes)) throw new Error("Process metadata processes must be an object");
  const entries = Object.entries(source.processes as Record<string, unknown>);
  if (entries.length > 500) throw new Error("Process metadata supports at most 500 processes");
  const processes: Record<string, ProcessPresentationOverride> = {};
  for (const [rawId, rawOverride] of entries) {
    const id = processId(rawId);
    if (!rawOverride || typeof rawOverride !== "object" || Array.isArray(rawOverride)) throw new Error(`Process metadata for ${id} must be an object`);
    const item = rawOverride as Record<string, unknown>;
    const sanitized: ProcessPresentationOverride = {
      title: optionalText(item.title, 240),
      description: optionalText(item.description, 1200),
      category: optionalText(item.category, 120),
      icon: iconValue(item.icon),
      order: orderValue(item.order),
      help: optionalText(item.help, 4000),
    };
    if (Object.values(sanitized).some((entry) => entry !== undefined)) processes[id] = sanitized;
  }
  return { version: 1, processes };
}

function envMetadata(value: string | undefined): ProcessPresentationSet | null {
  if (!value) return null;
  try { return sanitizeProcessPresentationSet(JSON.parse(value)); }
  catch { return null; }
}

async function ensureTable(env: PresentationEnv): Promise<void> {
  if (!env.DB) return;
  await env.DB.prepare(createPresentationTable).run();
}

export async function readProcessPresentationSet(env: PresentationEnv): Promise<ProcessPresentationState> {
  if (env.DB) {
    await ensureTable(env);
    const row = await env.DB.prepare("SELECT metadata_json, updated_at FROM process_presentation_sets WHERE id = ?").bind("current").first<{ metadata_json: string; updated_at: number }>();
    if (row) {
      try { return { metadata: sanitizeProcessPresentationSet(JSON.parse(row.metadata_json)), source: "database", updatedAt: Number(row.updated_at) }; }
      catch { /* Invalid persisted metadata falls back safely. */ }
    }
  }
  const configured = envMetadata(env.PORTAL_PROCESS_METADATA_JSON);
  return configured
    ? { metadata: configured, source: "environment", updatedAt: null }
    : { metadata: emptyMetadata, source: "default", updatedAt: null };
}

export async function saveProcessPresentationSet(env: PresentationEnv, value: unknown): Promise<ProcessPresentationState> {
  if (!env.DB) throw new Error("Persistent database is unavailable");
  const metadata = sanitizeProcessPresentationSet(value);
  const updatedAt = Date.now();
  await ensureTable(env);
  await env.DB.prepare("INSERT INTO process_presentation_sets (id, metadata_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET metadata_json = excluded.metadata_json, updated_at = excluded.updated_at")
    .bind("current", JSON.stringify(metadata), updatedAt).run();
  return { metadata, source: "database", updatedAt };
}

export function applyProcessPresentation(events: CatalogEvent[], metadata: ProcessPresentationSet): CatalogEvent[] {
  return events.map((event) => {
    const override = metadata.processes[event.id];
    if (!override) return { ...event };
    return {
      ...event,
      title: override.title ?? event.title,
      description: override.description ?? event.description,
      category: override.category ?? event.category,
      icon: override.icon,
      order: override.order,
      help: override.help,
      presentationOverridden: true,
    };
  }).sort((left, right) => {
    const order = (left.order ?? 0) - (right.order ?? 0);
    return order || `${left.category}\0${left.title}\0${left.id}`.localeCompare(`${right.category}\0${right.title}\0${right.id}`);
  });
}
