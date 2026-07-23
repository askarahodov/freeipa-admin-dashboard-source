import type { CatalogEvent } from "./automation-types";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "cancelled" | "expired" | "executing" | "executed" | "failed" | "unknown";
export type ApprovalDecision = "approve" | "reject";
export type ApprovalRole = "viewer" | "operator" | "admin";

export type ApprovalSubject = {
  identity: string;
  role: ApprovalRole;
  groups: string[];
};

export type ApprovalRequirement = {
  requiredApprovals: number;
  approverRoles: ApprovalRole[];
  approverGroups: string[];
  requesterCannotApprove: boolean;
  expiresMinutes: number;
  ruleId: string;
};

export type ApprovalPolicyRule = ApprovalRequirement & {
  id: string;
  effect: "require" | "none";
  requesterUsers: string[];
  requesterRoles: ApprovalRole[];
  requesterGroups: string[];
  categories: string[];
  processes: string[];
  dangerous: boolean | null;
};

export type ApprovalPolicySet = {
  version: 1;
  dangerousDefaults: ApprovalRequirement | null;
  rules: ApprovalPolicyRule[];
};

export type ApprovalSpec = {
  eventId: string;
  schemaVersion: string;
  values: Record<string, unknown>;
  targets: string[];
  secretFields: string[];
  parentRunId: string;
};

export type PublicApproval = {
  id: string;
  eventId: string;
  title: string;
  category: string;
  schemaVersion: string;
  requesterIdentity: string;
  requesterRole: ApprovalRole;
  status: ApprovalStatus;
  requiredApprovals: number;
  approvals: number;
  rejections: number;
  approverRoles: ApprovalRole[];
  approverGroups: string[];
  requesterCannotApprove: boolean;
  summary: { subject: string; targets: string[]; values: Array<{ key: string; label: string; value: string }>; hiddenSecrets: number; secretFields: Array<{ key: string; label: string }> };
  expiresAt: number;
  createdAt: number;
  updatedAt: number;
  approvedAt: number | null;
  executedAt: number | null;
  runId: string;
  parentRunId: string;
  error: string;
  myDecision: ApprovalDecision | null;
  actions: { approve: boolean; reject: boolean; cancel: boolean; execute: boolean };
};

type ApprovalEnv = {
  DB?: D1Database;
  CONFIG_ENCRYPTION_KEY?: string;
  PORTAL_APPROVAL_POLICIES_JSON?: string;
};

type ApprovalRow = Record<string, unknown>;

const defaultDangerousRequirement: ApprovalRequirement = {
  requiredApprovals: 1,
  approverRoles: ["admin"],
  approverGroups: [],
  requesterCannotApprove: true,
  expiresMinutes: 60,
  ruleId: "dangerous-default",
};

const defaultPolicy: ApprovalPolicySet = {
  version: 1,
  dangerousDefaults: defaultDangerousRequirement,
  rules: [],
};

const createPolicyTable = `CREATE TABLE IF NOT EXISTS approval_policy_sets (
  id TEXT PRIMARY KEY NOT NULL,
  policy_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
)`;

const createApprovalsTable = `CREATE TABLE IF NOT EXISTS operation_approvals (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  requester_identity TEXT NOT NULL,
  requester_role TEXT NOT NULL,
  requester_groups_json TEXT NOT NULL,
  status TEXT NOT NULL,
  required_approvals INTEGER NOT NULL,
  approver_roles_json TEXT NOT NULL,
  approver_groups_json TEXT NOT NULL,
  requester_cannot_approve INTEGER NOT NULL,
  rule_id TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  encrypted_spec TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  approved_at INTEGER,
  executed_at INTEGER,
  run_id TEXT,
  parent_run_id TEXT,
  error TEXT
)`;

const createDecisionsTable = `CREATE TABLE IF NOT EXISTS operation_approval_decisions (
  approval_id TEXT NOT NULL,
  approver_identity TEXT NOT NULL,
  approver_role TEXT NOT NULL,
  decision TEXT NOT NULL,
  comment TEXT,
  decided_at INTEGER NOT NULL,
  PRIMARY KEY (approval_id, approver_identity)
)`;

function cleanText(value: unknown, limit = 240): string {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, limit);
}

function cleanIdentity(value: unknown): string {
  const normalized = cleanText(value, 160).toLowerCase();
  return normalized && normalized.includes("@") && !/[\s,]/.test(normalized) ? normalized : "";
}

function cleanGroup(value: unknown): string {
  const normalized = cleanText(value, 120).toLowerCase();
  return normalized && !/[,\r\n]/.test(normalized) ? normalized : "";
}

function unique<T>(values: T[], limit: number): T[] {
  return Array.from(new Set(values)).slice(0, limit);
}

function stringArray(value: unknown, normalize: (item: unknown) => string, limit = 100): string[] {
  return Array.isArray(value) ? unique(value.map(normalize).filter(Boolean), limit) : [];
}

function roleArray(value: unknown): ApprovalRole[] {
  return Array.isArray(value) ? unique(value.filter((item): item is ApprovalRole => item === "viewer" || item === "operator" || item === "admin"), 3) : [];
}

function numberBetween(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(Math.trunc(parsed), max)) : fallback;
}

function sanitizeRequirement(value: unknown, fallbackRuleId: string): ApprovalRequirement {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${fallbackRuleId} must be an object`);
  const source = value as Record<string, unknown>;
  const requiredApprovals = numberBetween(source.requiredApprovals, 1, 1, 10);
  const approverRoles = roleArray(source.approverRoles);
  const approverGroups = stringArray(source.approverGroups, cleanGroup);
  if (!approverRoles.length && !approverGroups.length) throw new Error(`${fallbackRuleId} requires approverRoles or approverGroups`);
  return {
    requiredApprovals,
    approverRoles,
    approverGroups,
    requesterCannotApprove: source.requesterCannotApprove !== false,
    expiresMinutes: numberBetween(source.expiresMinutes, 60, 5, 10_080),
    ruleId: cleanText(source.ruleId ?? fallbackRuleId, 120) || fallbackRuleId,
  };
}

export function sanitizeApprovalPolicySet(value: unknown): ApprovalPolicySet {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Approval policy must be a JSON object");
  const source = value as Record<string, unknown>;
  const dangerousDefaults = source.dangerousDefaults === null ? null : sanitizeRequirement(source.dangerousDefaults ?? defaultDangerousRequirement, "dangerous-default");
  if (source.rules !== undefined && !Array.isArray(source.rules)) throw new Error("rules must be an array");
  const rawRules = Array.isArray(source.rules) ? source.rules.slice(0, 200) : [];
  const ids = new Set<string>();
  const rules: ApprovalPolicyRule[] = rawRules.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`Rule ${index + 1} must be an object`);
    const rule = raw as Record<string, unknown>;
    const id = cleanText(rule.id, 120) || `rule-${index + 1}`;
    if (ids.has(id)) throw new Error(`Duplicate approval rule id: ${id}`);
    ids.add(id);
    const effect = rule.effect === "none" ? "none" : rule.effect === "require" || rule.effect === undefined ? "require" : null;
    if (!effect) throw new Error(`Rule ${id}: effect must be require or none`);
    const base = effect === "require" ? sanitizeRequirement({ ...rule, ruleId: id }, id) : { ...defaultDangerousRequirement, requiredApprovals: 1, ruleId: id };
    const dangerous = rule.dangerous === true ? true : rule.dangerous === false ? false : null;
    return {
      id,
      effect,
      requesterUsers: stringArray(rule.requesterUsers, cleanIdentity),
      requesterRoles: roleArray(rule.requesterRoles),
      requesterGroups: stringArray(rule.requesterGroups, cleanGroup),
      categories: stringArray(rule.categories, (item) => cleanText(item, 160).toLowerCase()),
      processes: stringArray(rule.processes, (item) => cleanText(item, 160)),
      dangerous,
      requiredApprovals: base.requiredApprovals,
      approverRoles: base.approverRoles,
      approverGroups: base.approverGroups,
      requesterCannotApprove: base.requesterCannotApprove,
      expiresMinutes: base.expiresMinutes,
      ruleId: id,
    };
  });
  return { version: 1, dangerousDefaults, rules };
}

function subjectMatches(rule: ApprovalPolicyRule, subject: ApprovalSubject): boolean {
  if (!rule.requesterUsers.length && !rule.requesterRoles.length && !rule.requesterGroups.length) return true;
  if (rule.requesterUsers.includes(subject.identity.toLowerCase())) return true;
  if (rule.requesterRoles.includes(subject.role)) return true;
  const groups = new Set(subject.groups.map((group) => group.toLowerCase()));
  return rule.requesterGroups.some((group) => groups.has(group));
}

function eventMatches(rule: ApprovalPolicyRule, event: Pick<CatalogEvent, "id" | "category" | "dangerous">): boolean {
  if (rule.dangerous !== null && rule.dangerous !== event.dangerous) return false;
  if (!rule.categories.length && !rule.processes.length) return true;
  if (rule.processes.includes(event.id)) return true;
  return rule.categories.includes(String(event.category ?? "").trim().toLowerCase());
}

export function approvalRequirement(policy: ApprovalPolicySet, subject: ApprovalSubject, event: Pick<CatalogEvent, "id" | "category" | "dangerous">): ApprovalRequirement | null {
  let requirement = event.dangerous && policy.dangerousDefaults ? policy.dangerousDefaults : null;
  for (const rule of policy.rules) {
    if (!subjectMatches(rule, subject) || !eventMatches(rule, event)) continue;
    requirement = rule.effect === "none" ? null : {
      requiredApprovals: rule.requiredApprovals,
      approverRoles: rule.approverRoles,
      approverGroups: rule.approverGroups,
      requesterCannotApprove: rule.requesterCannotApprove,
      expiresMinutes: rule.expiresMinutes,
      ruleId: rule.id,
    };
  }
  return requirement;
}

async function ensureTables(env: ApprovalEnv): Promise<void> {
  if (!env.DB) return;
  await env.DB.prepare(createPolicyTable).run();
  await env.DB.prepare(createApprovalsTable).run();
  await env.DB.prepare(createDecisionsTable).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS operation_approvals_status_idx ON operation_approvals(status, created_at DESC)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS operation_approvals_requester_idx ON operation_approvals(requester_identity, created_at DESC)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS operation_approval_decisions_approval_idx ON operation_approval_decisions(approval_id, decided_at)").run();
}

export async function readApprovalPolicySet(env: ApprovalEnv): Promise<{ policy: ApprovalPolicySet; source: "database" | "environment" | "default"; updatedAt: number | null }> {
  if (env.DB) {
    await ensureTables(env);
    const row = await env.DB.prepare("SELECT policy_json, updated_at FROM approval_policy_sets WHERE id = ?").bind("current").first<Record<string, unknown>>();
    if (row) {
      try { return { policy: sanitizeApprovalPolicySet(JSON.parse(String(row.policy_json))), source: "database", updatedAt: Number(row.updated_at) }; }
      catch { throw new Error("Stored approval policy is invalid"); }
    }
  }
  if (env.PORTAL_APPROVAL_POLICIES_JSON) {
    try { return { policy: sanitizeApprovalPolicySet(JSON.parse(env.PORTAL_APPROVAL_POLICIES_JSON)), source: "environment", updatedAt: null }; }
    catch (error) { throw new Error(error instanceof Error ? `PORTAL_APPROVAL_POLICIES_JSON: ${error.message}` : "PORTAL_APPROVAL_POLICIES_JSON is invalid"); }
  }
  return { policy: defaultPolicy, source: "default", updatedAt: null };
}

export async function saveApprovalPolicySet(env: ApprovalEnv, value: unknown): Promise<{ policy: ApprovalPolicySet; updatedAt: number }> {
  if (!env.DB) throw new Error("Persistent database is unavailable");
  const policy = sanitizeApprovalPolicySet(value);
  const updatedAt = Date.now();
  await ensureTables(env);
  await env.DB.prepare("INSERT INTO approval_policy_sets (id, policy_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET policy_json = excluded.policy_json, updated_at = excluded.updated_at")
    .bind("current", JSON.stringify(policy), updatedAt).run();
  return { policy, updatedAt };
}

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
  if (/^[0-9a-f]{64}$/i.test(normalized)) bytes = Uint8Array.from(normalized.match(/.{2}/g) ?? [], (pair) => Number.parseInt(pair, 16));
  else {
    try { bytes = base64ToBytes(normalized); }
    catch { throw new Error("CONFIG_ENCRYPTION_KEY must be 32-byte base64 or 64-character hex"); }
  }
  if (bytes.byteLength !== 32) throw new Error("CONFIG_ENCRYPTION_KEY must decode to exactly 32 bytes");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encryptSpec(spec: ApprovalSpec, keyValue?: string): Promise<string> {
  const key = await encryptionKey(keyValue);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(spec)));
  return `v1.${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(encrypted))}`;
}

async function decryptSpec(value: string, keyValue?: string): Promise<ApprovalSpec> {
  const [version, ivValue, encryptedValue] = value.split(".");
  if (version !== "v1" || !ivValue || !encryptedValue) throw new Error("Unsupported approval storage format");
  const key = await encryptionKey(keyValue);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(ivValue) }, key, base64ToBytes(encryptedValue));
  const parsed = JSON.parse(new TextDecoder().decode(decrypted)) as Partial<ApprovalSpec>;
  if (!parsed || typeof parsed.eventId !== "string" || typeof parsed.schemaVersion !== "string" || !parsed.values || typeof parsed.values !== "object" || Array.isArray(parsed.values) || !Array.isArray(parsed.targets) || !Array.isArray(parsed.secretFields)) throw new Error("Stored approval specification is invalid");
  return {
    eventId: parsed.eventId.slice(0, 240),
    schemaVersion: parsed.schemaVersion.slice(0, 80),
    values: parsed.values as Record<string, unknown>,
    targets: parsed.targets.map(String).slice(0, 100),
    secretFields: parsed.secretFields.map(String).slice(0, 100),
    parentRunId: String(parsed.parentRunId ?? "").slice(0, 160),
  };
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, stable((value as Record<string, unknown>)[key])]));
}

async function fingerprint(spec: ApprovalSpec): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(stable(spec))));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeValue(value: unknown): string {
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (typeof value === "string") return cleanText(value, 240);
  try { return cleanText(JSON.stringify(value), 240); }
  catch { return "[значение]"; }
}

function approvalSpec(event: CatalogEvent, values: Record<string, unknown>, targets: string[], parentRunId: string): { spec: ApprovalSpec; summary: PublicApproval["summary"] } {
  const safeValues: Record<string, unknown> = {};
  const secretFields: string[] = [];
  const secretFieldLabels: Array<{ key: string; label: string }> = [];
  const summaryValues: PublicApproval["summary"]["values"] = [];
  for (const field of event.fields) {
    const value = values[field.key];
    if (field.type === "password") {
      if (value !== undefined && value !== null && String(value) !== "") { secretFields.push(field.key); secretFieldLabels.push({ key: field.key, label: cleanText(field.label, 120) }); }
      continue;
    }
    if (value !== undefined) {
      safeValues[field.key] = value;
      if (summaryValues.length < 16) summaryValues.push({ key: field.key, label: cleanText(field.label, 120), value: safeValue(value) });
    }
  }
  const normalizedTargets = targets.map(String).map((item) => cleanText(item, 240)).filter(Boolean).slice(0, 100);
  return {
    spec: { eventId: event.id, schemaVersion: String(event.schemaVersion ?? ""), values: safeValues, targets: normalizedTargets, secretFields, parentRunId: parentRunId.slice(0, 160) },
    summary: { subject: summaryValues[0]?.value || normalizedTargets.join(", ").slice(0, 240) || "—", targets: normalizedTargets, values: summaryValues, hiddenSecrets: secretFields.length, secretFields: secretFieldLabels },
  };
}

function parseJsonArray<T>(value: unknown, fallback: T[] = []): T[] {
  try { const parsed = JSON.parse(String(value ?? "[]")); return Array.isArray(parsed) ? parsed as T[] : fallback; }
  catch { return fallback; }
}

function statusValue(value: unknown): ApprovalStatus {
  const normalized = String(value ?? "");
  return ["pending", "approved", "rejected", "cancelled", "expired", "executing", "executed", "failed", "unknown"].includes(normalized) ? normalized as ApprovalStatus : "unknown";
}

function roleValue(value: unknown): ApprovalRole {
  return value === "viewer" || value === "operator" || value === "admin" ? value : "viewer";
}

function isEligibleApprover(row: ApprovalRow, subject: ApprovalSubject): boolean {
  if (Number(row.requester_cannot_approve ?? 1) === 1 && String(row.requester_identity).toLowerCase() === subject.identity.toLowerCase()) return false;
  const roles = parseJsonArray<ApprovalRole>(row.approver_roles_json).filter((role) => role === "viewer" || role === "operator" || role === "admin");
  const groups = new Set(parseJsonArray<string>(row.approver_groups_json).map((group) => group.toLowerCase()));
  return roles.includes(subject.role) || subject.groups.some((group) => groups.has(group.toLowerCase()));
}

async function decisionsFor(env: ApprovalEnv, approvalIds: string[]): Promise<Map<string, Array<{ identity: string; role: ApprovalRole; decision: ApprovalDecision; comment: string; decidedAt: number }>>> {
  const result = new Map<string, Array<{ identity: string; role: ApprovalRole; decision: ApprovalDecision; comment: string; decidedAt: number }>>();
  if (!env.DB || !approvalIds.length) return result;
  const ids = approvalIds.filter(Boolean).slice(0, 200);
  const placeholders = ids.map(() => "?").join(",");
  const rows = await env.DB.prepare(`SELECT approval_id, approver_identity, approver_role, decision, comment, decided_at FROM operation_approval_decisions WHERE approval_id IN (${placeholders}) ORDER BY decided_at ASC`).bind(...ids).all<Record<string, unknown>>();
  for (const row of rows.results ?? []) {
    const id = String(row.approval_id ?? "");
    const decision = row.decision === "reject" ? "reject" : "approve";
    const list = result.get(id) ?? [];
    list.push({ identity: String(row.approver_identity ?? ""), role: roleValue(row.approver_role), decision, comment: String(row.comment ?? ""), decidedAt: Number(row.decided_at ?? 0) });
    result.set(id, list);
  }
  return result;
}

async function publicFromRow(env: ApprovalEnv, row: ApprovalRow, subject: ApprovalSubject, decisions?: Map<string, Array<{ identity: string; role: ApprovalRole; decision: ApprovalDecision; comment: string; decidedAt: number }>>): Promise<PublicApproval> {
  const id = String(row.id ?? "");
  const decisionMap = decisions ?? await decisionsFor(env, [id]);
  const rows = decisionMap.get(id) ?? [];
  const status = statusValue(row.status);
  let summary: PublicApproval["summary"] = { subject: "—", targets: [], values: [], hiddenSecrets: 0, secretFields: [] };
  try { summary = JSON.parse(String(row.summary_json ?? "{}")) as PublicApproval["summary"]; } catch {}
  const myDecision = rows.find((item) => item.identity.toLowerCase() === subject.identity.toLowerCase())?.decision ?? null;
  const eligible = isEligibleApprover(row, subject);
  const requester = String(row.requester_identity ?? "").toLowerCase() === subject.identity.toLowerCase();
  return {
    id,
    eventId: String(row.event_id ?? ""),
    title: String(row.title ?? ""),
    category: String(row.category ?? ""),
    schemaVersion: String(row.schema_version ?? ""),
    requesterIdentity: String(row.requester_identity ?? ""),
    requesterRole: roleValue(row.requester_role),
    status,
    requiredApprovals: Number(row.required_approvals ?? 1),
    approvals: rows.filter((item) => item.decision === "approve").length,
    rejections: rows.filter((item) => item.decision === "reject").length,
    approverRoles: parseJsonArray<ApprovalRole>(row.approver_roles_json),
    approverGroups: parseJsonArray<string>(row.approver_groups_json),
    requesterCannotApprove: Number(row.requester_cannot_approve ?? 1) === 1,
    summary,
    expiresAt: Number(row.expires_at ?? 0),
    createdAt: Number(row.created_at ?? 0),
    updatedAt: Number(row.updated_at ?? 0),
    approvedAt: row.approved_at == null ? null : Number(row.approved_at),
    executedAt: row.executed_at == null ? null : Number(row.executed_at),
    runId: String(row.run_id ?? ""),
    parentRunId: String(row.parent_run_id ?? ""),
    error: String(row.error ?? ""),
    myDecision,
    actions: {
      approve: status === "pending" && eligible && !myDecision,
      reject: status === "pending" && eligible && !myDecision,
      cancel: requester && (status === "pending" || status === "approved"),
      execute: requester && status === "approved",
    },
  };
}

async function expireApprovals(env: ApprovalEnv): Promise<void> {
  if (!env.DB) return;
  const now = Date.now();
  await env.DB.prepare("UPDATE operation_approvals SET status = 'expired', updated_at = ? WHERE status IN ('pending','approved') AND expires_at <= ?").bind(now, now).run();
}

async function readRow(env: ApprovalEnv, id: string): Promise<ApprovalRow | null> {
  if (!env.DB) return null;
  await ensureTables(env);
  await expireApprovals(env);
  return env.DB.prepare("SELECT * FROM operation_approvals WHERE id = ?").bind(id.slice(0, 160)).first<ApprovalRow>();
}

export async function createApprovalRequest(env: ApprovalEnv, event: CatalogEvent, subject: ApprovalSubject, values: Record<string, unknown>, targets: string[], requirement: ApprovalRequirement, parentRunId = ""): Promise<PublicApproval> {
  if (!env.DB || !env.CONFIG_ENCRYPTION_KEY) throw new Error("Approval gates require D1 and CONFIG_ENCRYPTION_KEY");
  await ensureTables(env);
  const now = Date.now();
  const id = crypto.randomUUID();
  const prepared = approvalSpec(event, values, targets, parentRunId);
  const encrypted = await encryptSpec(prepared.spec, env.CONFIG_ENCRYPTION_KEY);
  const requestFingerprint = await fingerprint(prepared.spec);
  const expiresAt = now + requirement.expiresMinutes * 60_000;
  await env.DB.prepare("INSERT INTO operation_approvals (id, event_id, title, category, schema_version, requester_identity, requester_role, requester_groups_json, status, required_approvals, approver_roles_json, approver_groups_json, requester_cannot_approve, rule_id, summary_json, encrypted_spec, request_fingerprint, expires_at, created_at, updated_at, approved_at, executed_at, run_id, parent_run_id, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, NULL)")
    .bind(id, event.id.slice(0, 240), cleanText(event.title, 240), cleanText(event.category, 160), String(event.schemaVersion ?? "").slice(0, 80), subject.identity.slice(0, 160), subject.role, JSON.stringify(subject.groups.slice(0, 100)), requirement.requiredApprovals, JSON.stringify(requirement.approverRoles), JSON.stringify(requirement.approverGroups), requirement.requesterCannotApprove ? 1 : 0, requirement.ruleId.slice(0, 120), JSON.stringify(prepared.summary), encrypted, requestFingerprint, expiresAt, now, now, parentRunId.slice(0, 160) || null).run();
  const row = await readRow(env, id);
  if (!row) throw new Error("Approval request was not persisted");
  return publicFromRow(env, row, subject);
}

export async function listApprovals(env: ApprovalEnv, subject: ApprovalSubject, limit = 100): Promise<{ approvals: PublicApproval[]; pendingForMe: number; minePending: number; persistenceAvailable: boolean }> {
  if (!env.DB) return { approvals: [], pendingForMe: 0, minePending: 0, persistenceAvailable: false };
  await ensureTables(env);
  await expireApprovals(env);
  const rows = await env.DB.prepare("SELECT * FROM operation_approvals ORDER BY created_at DESC LIMIT ?").bind(Math.max(1, Math.min(limit, 200))).all<ApprovalRow>();
  const items = rows.results ?? [];
  const decisionMap = await decisionsFor(env, items.map((row) => String(row.id ?? "")));
  const allApprovals = await Promise.all(items.map((row) => publicFromRow(env, row, subject, decisionMap)));
  const approvals = allApprovals.filter((item) => subject.role === "admin" || item.requesterIdentity.toLowerCase() === subject.identity.toLowerCase() || item.actions.approve || item.myDecision);
  return {
    approvals,
    pendingForMe: approvals.filter((item) => item.actions.approve).length,
    minePending: approvals.filter((item) => item.requesterIdentity.toLowerCase() === subject.identity.toLowerCase() && (item.status === "pending" || item.status === "approved")).length,
    persistenceAvailable: true,
  };
}

async function insertDecision(env: ApprovalEnv, id: string, subject: ApprovalSubject, decision: ApprovalDecision, comment: string): Promise<void> {
  if (!env.DB) throw new Error("Persistent database is unavailable");
  try {
    await env.DB.prepare("INSERT INTO operation_approval_decisions (approval_id, approver_identity, approver_role, decision, comment, decided_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(id, subject.identity.slice(0, 160), subject.role, decision, cleanText(comment, 500) || null, Date.now()).run();
  } catch {
    throw new Error("Вы уже приняли решение по этой заявке");
  }
}

export async function decideApproval(env: ApprovalEnv, id: string, subject: ApprovalSubject, decision: ApprovalDecision, comment = ""): Promise<PublicApproval> {
  if (!env.DB) throw new Error("Persistent database is unavailable");
  const row = await readRow(env, id);
  if (!row) throw new Error("Заявка не найдена");
  if (statusValue(row.status) !== "pending") throw new Error("Заявка уже не ожидает согласования");
  if (!isEligibleApprover(row, subject)) throw new Error("Недостаточно прав для согласования этой заявки");
  if (decision === "reject" && !cleanText(comment, 500)) throw new Error("Для отклонения укажите комментарий");
  await insertDecision(env, id, subject, decision, comment);
  const now = Date.now();
  if (decision === "reject") {
    await env.DB.prepare("UPDATE operation_approvals SET status = 'rejected', updated_at = ?, error = ? WHERE id = ? AND status = 'pending'").bind(now, cleanText(comment, 500), id).run();
  } else {
    const count = await env.DB.prepare("SELECT COUNT(*) AS approvals FROM operation_approval_decisions WHERE approval_id = ? AND decision = 'approve'").bind(id).first<Record<string, unknown>>();
    if (Number(count?.approvals ?? 0) >= Number(row.required_approvals ?? 1)) {
      await env.DB.prepare("UPDATE operation_approvals SET status = 'approved', approved_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'").bind(now, now, id).run();
    }
  }
  const updated = await readRow(env, id);
  if (!updated) throw new Error("Заявка не найдена после обновления");
  return publicFromRow(env, updated, subject);
}

export async function cancelApproval(env: ApprovalEnv, id: string, subject: ApprovalSubject): Promise<PublicApproval> {
  if (!env.DB) throw new Error("Persistent database is unavailable");
  const row = await readRow(env, id);
  if (!row) throw new Error("Заявка не найдена");
  if (String(row.requester_identity).toLowerCase() !== subject.identity.toLowerCase()) throw new Error("Отменить заявку может только инициатор");
  if (!["pending", "approved"].includes(statusValue(row.status))) throw new Error("Эту заявку уже нельзя отменить");
  const now = Date.now();
  await env.DB.prepare("UPDATE operation_approvals SET status = 'cancelled', updated_at = ? WHERE id = ? AND status IN ('pending','approved')").bind(now, id).run();
  const updated = await readRow(env, id);
  if (!updated) throw new Error("Заявка не найдена после отмены");
  return publicFromRow(env, updated, subject);
}

function changes(result: unknown): number {
  const source = result as { meta?: { changes?: number }; changes?: number } | null;
  return Number(source?.meta?.changes ?? source?.changes ?? 0);
}

export async function claimApprovalExecution(env: ApprovalEnv, id: string, subject: ApprovalSubject): Promise<{ approval: PublicApproval; spec: ApprovalSpec }> {
  if (!env.DB) throw new Error("Persistent database is unavailable");
  const row = await readRow(env, id);
  if (!row) throw new Error("Заявка не найдена");
  if (String(row.requester_identity).toLowerCase() !== subject.identity.toLowerCase()) throw new Error("Выполнить согласованную операцию может только инициатор");
  if (statusValue(row.status) !== "approved") throw new Error("Заявка не согласована или уже использована");
  const now = Date.now();
  const result = await env.DB.prepare("UPDATE operation_approvals SET status = 'executing', updated_at = ? WHERE id = ? AND status = 'approved' AND expires_at > ?").bind(now, id, now).run();
  if (changes(result) < 1) throw new Error("Согласование истекло или уже используется");
  const updated = await readRow(env, id);
  if (!updated) throw new Error("Заявка не найдена после блокировки");
  const spec = await decryptSpec(String(updated.encrypted_spec ?? ""), env.CONFIG_ENCRYPTION_KEY);
  return { approval: await publicFromRow(env, updated, subject), spec };
}

export async function readExecutingApproval(env: ApprovalEnv, id: string, subject: ApprovalSubject): Promise<{ row: ApprovalRow; spec: ApprovalSpec } | null> {
  const row = await readRow(env, id);
  if (!row || statusValue(row.status) !== "executing" || String(row.requester_identity).toLowerCase() !== subject.identity.toLowerCase()) return null;
  try { return { row, spec: await decryptSpec(String(row.encrypted_spec ?? ""), env.CONFIG_ENCRYPTION_KEY) }; }
  catch { return null; }
}

export async function approvalExecutionMatches(spec: ApprovalSpec, event: CatalogEvent, values: Record<string, unknown>, targets: string[]): Promise<boolean> {
  const prepared = approvalSpec(event, values, targets, spec.parentRunId).spec;
  return await fingerprint(prepared) === await fingerprint(spec);
}

export async function finishApprovalExecution(env: ApprovalEnv, id: string, status: "executed" | "failed" | "unknown", runId = "", error = ""): Promise<void> {
  if (!env.DB) return;
  const now = Date.now();
  await env.DB.prepare("UPDATE operation_approvals SET status = ?, run_id = ?, error = ?, executed_at = ?, updated_at = ? WHERE id = ? AND status = 'executing'")
    .bind(status, runId.slice(0, 160) || null, cleanText(error, 500) || null, status === "executed" ? now : null, now, id.slice(0, 160)).run();
}
