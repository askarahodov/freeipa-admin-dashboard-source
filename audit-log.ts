export type AuditOutcome = "success" | "failure" | "pending" | "denied" | "unknown" | "info";

export type AuditActor = {
  identity: string;
  role: string;
  groups: string[];
};

export type AuditContext = {
  correlationId: string;
  actor: AuditActor;
};

export type AuditEventInput = {
  action: string;
  resourceType: string;
  resourceId?: string;
  eventId?: string;
  schemaVersion?: string;
  approvalId?: string;
  runId?: string;
  jobId?: string;
  outcome: AuditOutcome;
  errorCode?: string;
  metadata?: Record<string, unknown>;
};

export type PublicAuditEvent = {
  id: string;
  createdAt: number;
  correlationId: string;
  actorIdentity: string;
  actorRole: string;
  actorGroups: string[];
  action: string;
  resourceType: string;
  resourceId: string;
  eventId: string;
  schemaVersion: string;
  approvalId: string;
  runId: string;
  jobId: string;
  outcome: AuditOutcome;
  errorCode: string;
  metadata: Record<string, unknown>;
};

type AuditEnv = { DB?: D1Database };
type AuditRow = Record<string, unknown>;

const createAuditTable = `CREATE TABLE IF NOT EXISTS portal_audit_events (
  id TEXT PRIMARY KEY NOT NULL,
  created_at INTEGER NOT NULL,
  correlation_id TEXT NOT NULL,
  actor_identity TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  actor_groups_json TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  event_id TEXT,
  schema_version TEXT,
  approval_id TEXT,
  run_id TEXT,
  job_id TEXT,
  outcome TEXT NOT NULL,
  error_code TEXT,
  metadata_json TEXT NOT NULL
)`;

const denyAuditUpdate = `CREATE TRIGGER IF NOT EXISTS portal_audit_events_no_update
BEFORE UPDATE ON portal_audit_events
BEGIN SELECT RAISE(ABORT, 'portal_audit_events is append-only'); END`;
const denyAuditDelete = `CREATE TRIGGER IF NOT EXISTS portal_audit_events_no_delete
BEFORE DELETE ON portal_audit_events
BEGIN SELECT RAISE(ABORT, 'portal_audit_events is append-only'); END`;

function cleanText(value: unknown, limit = 240): string {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, limit);
}

function cleanIdentity(value: unknown): string {
  return cleanText(value, 160).toLowerCase() || "system@portal.local";
}

function cleanCorrelation(value: unknown): string {
  const normalized = cleanText(value, 96);
  return /^cor_[a-z0-9]{20,92}$/i.test(normalized) ? normalized : "";
}

function sensitiveKey(value: string): boolean {
  return /pass(word)?|secret|token|api.?key|authorization|cookie|credential|private.?key|session|encrypted|cipher/i.test(value);
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[truncated]";
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return cleanText(value, 500);
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeValue(item, depth + 1));
  if (!value || typeof value !== "object") return cleanText(value, 240);
  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>).slice(0, 50)) {
    const normalizedKey = cleanText(key, 80);
    if (!normalizedKey || sensitiveKey(normalizedKey)) continue;
    result[normalizedKey] = sanitizeValue(nested, depth + 1);
  }
  return result;
}

export function sanitizeAuditMetadata(value: unknown): Record<string, unknown> {
  const sanitized = sanitizeValue(value);
  return sanitized && typeof sanitized === "object" && !Array.isArray(sanitized) ? sanitized as Record<string, unknown> : {};
}

export function auditErrorCode(value: unknown, fallback = "operation_failed"): string {
  const raw = value instanceof Error ? value.name : value;
  const normalized = cleanText(raw, 80).toLowerCase().replace(/[^a-z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized || fallback;
}

export function createAuditContext(actor: AuditActor, correlationId?: string): AuditContext {
  const supplied = cleanCorrelation(correlationId);
  return {
    correlationId: supplied || `cor_${crypto.randomUUID().replaceAll("-", "")}`,
    actor: {
      identity: cleanIdentity(actor.identity),
      role: cleanText(actor.role, 40).toLowerCase() || "system",
      groups: Array.from(new Set((actor.groups ?? []).map((group) => cleanText(group, 120).toLowerCase()).filter(Boolean))).slice(0, 100),
    },
  };
}

export function withAuditCorrelation(context: AuditContext, correlationId: string | null | undefined): AuditContext {
  return createAuditContext(context.actor, cleanCorrelation(correlationId) || context.correlationId);
}

async function ensureAuditTable(env: AuditEnv): Promise<void> {
  if (!env.DB) return;
  await env.DB.prepare(createAuditTable).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS portal_audit_events_created_idx ON portal_audit_events(created_at DESC)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS portal_audit_events_correlation_idx ON portal_audit_events(correlation_id, created_at)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS portal_audit_events_approval_idx ON portal_audit_events(approval_id, created_at)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS portal_audit_events_run_idx ON portal_audit_events(run_id, created_at)").run();
  await env.DB.prepare(denyAuditUpdate).run();
  await env.DB.prepare(denyAuditDelete).run();
}

function outcomeValue(value: unknown): AuditOutcome {
  return value === "success" || value === "failure" || value === "pending" || value === "denied" || value === "unknown" || value === "info" ? value : "unknown";
}

function rowToPublic(row: AuditRow): PublicAuditEvent {
  let actorGroups: string[] = [];
  let metadata: Record<string, unknown> = {};
  try { const parsed = JSON.parse(String(row.actor_groups_json ?? "[]")); if (Array.isArray(parsed)) actorGroups = parsed.map(String).slice(0, 100); } catch {}
  try { metadata = sanitizeAuditMetadata(JSON.parse(String(row.metadata_json ?? "{}"))); } catch {}
  return {
    id: String(row.id ?? ""),
    createdAt: Number(row.created_at ?? 0),
    correlationId: String(row.correlation_id ?? ""),
    actorIdentity: String(row.actor_identity ?? ""),
    actorRole: String(row.actor_role ?? ""),
    actorGroups,
    action: String(row.action ?? ""),
    resourceType: String(row.resource_type ?? ""),
    resourceId: String(row.resource_id ?? ""),
    eventId: String(row.event_id ?? ""),
    schemaVersion: String(row.schema_version ?? ""),
    approvalId: String(row.approval_id ?? ""),
    runId: String(row.run_id ?? ""),
    jobId: String(row.job_id ?? ""),
    outcome: outcomeValue(row.outcome),
    errorCode: String(row.error_code ?? ""),
    metadata,
  };
}

export async function appendAuditEvent(env: AuditEnv, context: AuditContext, input: AuditEventInput): Promise<PublicAuditEvent | null> {
  if (!env.DB) return null;
  await ensureAuditTable(env);
  const createdAt = Date.now();
  const id = crypto.randomUUID();
  const metadata = sanitizeAuditMetadata(input.metadata);
  await env.DB.prepare("INSERT INTO portal_audit_events (id, created_at, correlation_id, actor_identity, actor_role, actor_groups_json, action, resource_type, resource_id, event_id, schema_version, approval_id, run_id, job_id, outcome, error_code, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(
      id,
      createdAt,
      context.correlationId,
      context.actor.identity,
      context.actor.role,
      JSON.stringify(context.actor.groups),
      cleanText(input.action, 120),
      cleanText(input.resourceType, 80),
      cleanText(input.resourceId, 240) || null,
      cleanText(input.eventId, 240) || null,
      cleanText(input.schemaVersion, 120) || null,
      cleanText(input.approvalId, 160) || null,
      cleanText(input.runId, 160) || null,
      cleanText(input.jobId, 160) || null,
      outcomeValue(input.outcome),
      cleanText(input.errorCode, 80) || null,
      JSON.stringify(metadata),
    ).run();
  return rowToPublic({
    id, created_at: createdAt, correlation_id: context.correlationId,
    actor_identity: context.actor.identity, actor_role: context.actor.role,
    actor_groups_json: JSON.stringify(context.actor.groups), action: input.action,
    resource_type: input.resourceType, resource_id: input.resourceId ?? null,
    event_id: input.eventId ?? null, schema_version: input.schemaVersion ?? null,
    approval_id: input.approvalId ?? null, run_id: input.runId ?? null,
    job_id: input.jobId ?? null, outcome: input.outcome,
    error_code: input.errorCode ?? null, metadata_json: JSON.stringify(metadata),
  });
}

export async function auditCorrelationFor(env: AuditEnv, link: { approvalId?: string; runId?: string }): Promise<string | null> {
  if (!env.DB) return null;
  await ensureAuditTable(env);
  if (link.approvalId) {
    const row = await env.DB.prepare("SELECT correlation_id FROM portal_audit_events WHERE approval_id = ? ORDER BY created_at ASC LIMIT 1").bind(cleanText(link.approvalId, 160)).first<{ correlation_id: string }>();
    if (row?.correlation_id) return cleanCorrelation(row.correlation_id) || null;
  }
  if (link.runId) {
    const row = await env.DB.prepare("SELECT correlation_id FROM portal_audit_events WHERE run_id = ? ORDER BY created_at ASC LIMIT 1").bind(cleanText(link.runId, 160)).first<{ correlation_id: string }>();
    if (row?.correlation_id) return cleanCorrelation(row.correlation_id) || null;
  }
  return null;
}

export async function listAuditEvents(env: AuditEnv, filters: {
  limit?: number;
  actor?: string;
  action?: string;
  outcome?: string;
  eventId?: string;
  approvalId?: string;
  runId?: string;
  correlationId?: string;
  dateFrom?: number;
  dateTo?: number;
}): Promise<{ events: PublicAuditEvent[]; persistenceAvailable: boolean }> {
  if (!env.DB) return { events: [], persistenceAvailable: false };
  await ensureAuditTable(env);
  const clauses: string[] = [];
  const values: unknown[] = [];
  const add = (sql: string, value: unknown) => { clauses.push(sql); values.push(value); };
  if (filters.actor) add("actor_identity = ?", cleanIdentity(filters.actor));
  if (filters.action) add("action = ?", cleanText(filters.action, 120));
  if (filters.outcome && ["success", "failure", "pending", "denied", "unknown", "info"].includes(filters.outcome)) add("outcome = ?", filters.outcome);
  if (filters.eventId) add("event_id = ?", cleanText(filters.eventId, 240));
  if (filters.approvalId) add("approval_id = ?", cleanText(filters.approvalId, 160));
  if (filters.runId) add("run_id = ?", cleanText(filters.runId, 160));
  if (filters.correlationId) add("correlation_id = ?", cleanCorrelation(filters.correlationId) || "invalid");
  if (Number.isFinite(filters.dateFrom)) add("created_at >= ?", Number(filters.dateFrom));
  if (Number.isFinite(filters.dateTo)) add("created_at <= ?", Number(filters.dateTo));
  const limit = Math.max(1, Math.min(Number.isFinite(filters.limit) ? Math.trunc(filters.limit as number) : 100, 200));
  const sql = `SELECT id, created_at, correlation_id, actor_identity, actor_role, actor_groups_json, action, resource_type, resource_id, event_id, schema_version, approval_id, run_id, job_id, outcome, error_code, metadata_json FROM portal_audit_events${clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT ?`;
  const result = await env.DB.prepare(sql).bind(...values, limit).all<AuditRow>();
  return { events: (result.results ?? []).map(rowToPublic), persistenceAvailable: true };
}
