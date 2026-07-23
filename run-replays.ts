import type { CatalogEvent } from "./automation-types";
import { fieldConditionMatches } from "./field-conditions";

export type RunReplaySpec = {
  eventId: string;
  schemaVersion: string;
  values: Record<string, unknown>;
  targets: string[];
  parentRunId: string;
};

export type RunReplaySummary = {
  runId: string;
  eventId: string;
  schemaVersion: string;
  replayable: boolean;
  reason: string;
  parentRunId: string;
};

type ReplayEnv = {
  DB?: D1Database;
  CONFIG_ENCRYPTION_KEY?: string;
};

const createReplayTable = `CREATE TABLE IF NOT EXISTS operation_run_replays (
  run_id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  encrypted_spec TEXT,
  replayable INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  parent_run_id TEXT,
  created_at INTEGER NOT NULL
)`;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function encryptionKey(value?: string): Promise<CryptoKey> {
  const normalized = value?.trim();
  if (!normalized) throw new Error("CONFIG_ENCRYPTION_KEY is not configured");
  let bytes: Uint8Array;
  if (/^[0-9a-f]{64}$/i.test(normalized)) {
    bytes = Uint8Array.from(normalized.match(/.{2}/g) ?? [], (pair) => Number.parseInt(pair, 16));
  } else {
    try { bytes = base64ToBytes(normalized); }
    catch { throw new Error("CONFIG_ENCRYPTION_KEY must be 32-byte base64 or 64-character hex"); }
  }
  if (bytes.byteLength !== 32) throw new Error("CONFIG_ENCRYPTION_KEY must decode to exactly 32 bytes");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encryptSpec(spec: RunReplaySpec, keyValue?: string): Promise<string> {
  const key = await encryptionKey(keyValue);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(spec)));
  return `v1.${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(encrypted))}`;
}

async function decryptSpec(value: string, keyValue?: string): Promise<RunReplaySpec> {
  const [version, ivValue, encryptedValue] = value.split(".");
  if (version !== "v1" || !ivValue || !encryptedValue) throw new Error("Unsupported replay storage format");
  const key = await encryptionKey(keyValue);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(ivValue) }, key, base64ToBytes(encryptedValue));
  const parsed = JSON.parse(new TextDecoder().decode(decrypted)) as Partial<RunReplaySpec>;
  if (!parsed || typeof parsed.eventId !== "string" || typeof parsed.schemaVersion !== "string" || !parsed.values || typeof parsed.values !== "object" || Array.isArray(parsed.values) || !Array.isArray(parsed.targets)) {
    throw new Error("Stored replay specification is invalid");
  }
  return {
    eventId: parsed.eventId.slice(0, 240),
    schemaVersion: parsed.schemaVersion.slice(0, 80),
    values: parsed.values as Record<string, unknown>,
    targets: parsed.targets.map(String).slice(0, 100),
    parentRunId: String(parsed.parentRunId ?? "").slice(0, 160),
  };
}

async function ensureReplayTable(env: ReplayEnv): Promise<void> {
  if (!env.DB) return;
  await env.DB.prepare(createReplayTable).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS operation_run_replays_event_idx ON operation_run_replays(event_id)").run();
}

function replayValues(event: CatalogEvent, values: Record<string, unknown>): { values: Record<string, unknown>; reason: string } {
  const safeValues: Record<string, unknown> = {};
  let reason = "";
  for (const field of event.fields) {
    if (!fieldConditionMatches(field.visibleWhen, values)) continue;
    const value = values[field.key];
    if (field.type === "password") {
      if (value !== undefined && value !== null && String(value) !== "") reason = `Поле «${field.label}» является секретным и должно быть введено заново`;
      continue;
    }
    if (value !== undefined) safeValues[field.key] = value;
  }
  return { values: safeValues, reason };
}

export async function saveRunReplay(env: ReplayEnv, runId: string, event: CatalogEvent, values: Record<string, unknown>, targets: string[], parentRunId = ""): Promise<void> {
  if (!env.DB || !runId) return;
  await ensureReplayTable(env);
  const filtered = replayValues(event, values);
  let replayable = !filtered.reason;
  let reason = filtered.reason;
  let encryptedSpec: string | null = null;
  if (replayable && !env.CONFIG_ENCRYPTION_KEY) {
    replayable = false;
    reason = "CONFIG_ENCRYPTION_KEY не настроен: параметры повторного запуска не сохраняются";
  }
  if (replayable) {
    try {
      encryptedSpec = await encryptSpec({
        eventId: event.id,
        schemaVersion: String(event.schemaVersion ?? ""),
        values: filtered.values,
        targets: targets.map(String).slice(0, 100),
        parentRunId: parentRunId.slice(0, 160),
      }, env.CONFIG_ENCRYPTION_KEY);
    } catch {
      replayable = false;
      reason = "Не удалось зашифровать параметры повторного запуска";
    }
  }
  await env.DB.prepare("INSERT INTO operation_run_replays (run_id, event_id, schema_version, encrypted_spec, replayable, reason, parent_run_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(run_id) DO UPDATE SET event_id = excluded.event_id, schema_version = excluded.schema_version, encrypted_spec = excluded.encrypted_spec, replayable = excluded.replayable, reason = excluded.reason, parent_run_id = excluded.parent_run_id")
    .bind(runId.slice(0, 160), event.id.slice(0, 240), String(event.schemaVersion ?? "").slice(0, 80), encryptedSpec, replayable ? 1 : 0, reason || null, parentRunId.slice(0, 160) || null, Date.now()).run();
}

function summaryFromRow(row: Record<string, unknown>): RunReplaySummary {
  return {
    runId: String(row.run_id ?? ""),
    eventId: String(row.event_id ?? ""),
    schemaVersion: String(row.schema_version ?? ""),
    replayable: Number(row.replayable ?? 0) === 1,
    reason: String(row.reason ?? ""),
    parentRunId: String(row.parent_run_id ?? ""),
  };
}

export async function listRunReplaySummaries(env: ReplayEnv, runIds: string[]): Promise<Map<string, RunReplaySummary>> {
  const result = new Map<string, RunReplaySummary>();
  if (!env.DB || !runIds.length) return result;
  await ensureReplayTable(env);
  const ids = runIds.filter(Boolean).slice(0, 200);
  if (!ids.length) return result;
  const placeholders = ids.map(() => "?").join(",");
  const rows = await env.DB.prepare(`SELECT run_id, event_id, schema_version, replayable, reason, parent_run_id FROM operation_run_replays WHERE run_id IN (${placeholders})`).bind(...ids).all<Record<string, unknown>>();
  for (const row of rows.results ?? []) {
    const summary = summaryFromRow(row);
    if (summary.runId) result.set(summary.runId, summary);
  }
  return result;
}

export async function readRunReplay(env: ReplayEnv, runId: string): Promise<{ summary: RunReplaySummary; spec: RunReplaySpec | null } | null> {
  if (!env.DB) return null;
  await ensureReplayTable(env);
  const row = await env.DB.prepare("SELECT run_id, event_id, schema_version, encrypted_spec, replayable, reason, parent_run_id FROM operation_run_replays WHERE run_id = ?").bind(runId.slice(0, 160)).first<Record<string, unknown>>();
  if (!row) return null;
  const summary = summaryFromRow(row);
  if (!summary.replayable || !row.encrypted_spec) return { summary, spec: null };
  try { return { summary, spec: await decryptSpec(String(row.encrypted_spec), env.CONFIG_ENCRYPTION_KEY) }; }
  catch { return { summary: { ...summary, replayable: false, reason: "Не удалось расшифровать параметры повторного запуска" }, spec: null }; }
}
