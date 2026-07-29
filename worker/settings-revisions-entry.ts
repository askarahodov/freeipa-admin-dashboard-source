import localRuntime from "./local-secure-entry";
import { appendAuditEvent, createAuditContext } from "../audit-log";
import { resolveLocalSession, type LocalAuthEnv } from "../local-auth";

type RuntimeEnv = NonNullable<Parameters<typeof localRuntime.fetch>[1]> & LocalAuthEnv & {
  DB?: D1Database;
  ADMIN_TOKEN?: string;
  PORTAL_IDENTITY_MODE?: string;
};
type RuntimeContext = Parameters<typeof localRuntime.fetch>[2];
type ScheduledController = Parameters<NonNullable<typeof localRuntime.scheduled>>[0];

type ActiveSnapshot = {
  configJson: string;
  encryptedSecrets: string;
  revision: number;
};

type RevisionRow = {
  id: string;
  revision: number;
  config_json: string;
  source_draft_id: string | null;
  created_by: string;
  reason: string;
  status: string;
  health_json: string;
  created_at: number;
};

const jsonHeaders = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const createRevisionsTable = `CREATE TABLE IF NOT EXISTS portal_settings_revisions (
  id TEXT PRIMARY KEY NOT NULL,
  revision INTEGER NOT NULL UNIQUE,
  config_json TEXT NOT NULL,
  encrypted_secrets TEXT NOT NULL,
  source_draft_id TEXT,
  created_by TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL,
  health_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
)`;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}

function isRevisionPath(pathname: string): boolean {
  return pathname === "/api/integrations/settings/revisions"
    || pathname.startsWith("/api/integrations/settings/revisions/");
}

function localMode(env: RuntimeEnv): boolean {
  return String(env.PORTAL_IDENTITY_MODE ?? "").trim().toLowerCase() === "local";
}

async function secretsMatch(provided: string | null, expected: string | undefined): Promise<boolean> {
  if (!provided || !expected) return false;
  const encoder = new TextEncoder();
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const actual = new Uint8Array(providedHash);
  const wanted = new Uint8Array(expectedHash);
  let difference = actual.length ^ wanted.length;
  for (let index = 0; index < wanted.length; index += 1) difference |= wanted[index] ^ (actual[index] ?? 0);
  return difference === 0;
}

async function adminIdentity(request: Request, env: RuntimeEnv): Promise<string | null> {
  if (localMode(env)) {
    const session = await resolveLocalSession(env, request);
    if (session?.role === "admin") return session.identity;
    if (await secretsMatch(request.headers.get("x-admin-token"), env.ADMIN_TOKEN)) return "service-admin@portal.local";
    return null;
  }
  return await secretsMatch(request.headers.get("x-admin-token"), env.ADMIN_TOKEN)
    ? "service-admin@portal.local"
    : null;
}

function audit(identity: string) {
  return createAuditContext({ identity, role: "admin", groups: [] });
}

async function ensureRevisionTable(env: RuntimeEnv): Promise<void> {
  if (!env.DB) throw new Error("Persistent database is unavailable");
  await env.DB.prepare(createRevisionsTable).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS portal_settings_revisions_created_idx ON portal_settings_revisions(created_at DESC)").run();
}

async function activeSnapshot(env: RuntimeEnv): Promise<ActiveSnapshot | null> {
  if (!env.DB) return null;
  try {
    const row = await env.DB.prepare("SELECT config_json, encrypted_secrets, updated_at FROM app_settings WHERE id = ?")
      .bind("main")
      .first<{ config_json: string; encrypted_secrets: string; updated_at: number }>();
    if (!row) return null;
    return {
      configJson: String(row.config_json ?? "{}"),
      encryptedSecrets: String(row.encrypted_secrets ?? ""),
      revision: Number(row.updated_at ?? 0),
    };
  } catch {
    return null;
  }
}

async function recordRevision(
  env: RuntimeEnv,
  snapshot: ActiveSnapshot,
  metadata: { draftId?: string; createdBy: string; reason: string; status: string; health?: unknown[] },
): Promise<void> {
  await ensureRevisionTable(env);
  await env.DB!.prepare(`INSERT INTO portal_settings_revisions
    (id, revision, config_json, encrypted_secrets, source_draft_id, created_by, reason, status, health_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(revision) DO UPDATE SET
      status = excluded.status,
      source_draft_id = COALESCE(portal_settings_revisions.source_draft_id, excluded.source_draft_id),
      health_json = CASE WHEN excluded.health_json <> '[]' THEN excluded.health_json ELSE portal_settings_revisions.health_json END`)
    .bind(
      crypto.randomUUID(),
      snapshot.revision,
      snapshot.configJson,
      snapshot.encryptedSecrets,
      metadata.draftId || null,
      metadata.createdBy,
      metadata.reason.slice(0, 160),
      metadata.status.slice(0, 40),
      JSON.stringify(Array.isArray(metadata.health) ? metadata.health : []),
      Date.now(),
    )
    .run();
}

function publicConfig(configJson: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(configJson) as Record<string, unknown>;
    return {
      demoMode: parsed.demoMode === true,
      ipaUrl: String(parsed.ipaUrl ?? ""),
      ipaUsername: String(parsed.ipaUsername ?? ""),
      xyopsUrl: String(parsed.xyopsUrl ?? ""),
    };
  } catch {
    return { demoMode: false, ipaUrl: "", ipaUsername: "", xyopsUrl: "" };
  }
}

function publicRevision(row: RevisionRow) {
  return {
    id: row.id,
    revision: Number(row.revision),
    config: publicConfig(row.config_json),
    sourceDraftId: row.source_draft_id || null,
    createdBy: row.created_by,
    reason: row.reason,
    status: row.status,
    health: JSON.parse(row.health_json || "[]") as unknown[],
    createdAt: Number(row.created_at),
  };
}

async function handleRevisionApi(request: Request, env: RuntimeEnv, url: URL): Promise<Response> {
  if (!env.DB) return json({ error: "Persistent database is unavailable" }, 503);
  const identity = await adminIdentity(request, env);
  if (!identity) return json({ error: "Administrator authorization required" }, 401);
  await ensureRevisionTable(env);

  if (request.method === "GET" && url.pathname === "/api/integrations/settings/revisions") {
    const limitValue = Number(url.searchParams.get("limit") ?? 20);
    const limit = Math.max(1, Math.min(Number.isFinite(limitValue) ? limitValue : 20, 100));
    const result = await env.DB.prepare(`SELECT id, revision, config_json, source_draft_id, created_by, reason, status, health_json, created_at
      FROM portal_settings_revisions ORDER BY revision DESC LIMIT ?`)
      .bind(limit)
      .all<RevisionRow>();
    return json({ revisions: (result.results ?? []).map(publicRevision) });
  }

  const match = url.pathname.match(/^\/api\/integrations\/settings\/revisions\/(\d{1,20})$/);
  if (request.method === "GET" && match) {
    const row = await env.DB.prepare(`SELECT id, revision, config_json, source_draft_id, created_by, reason, status, health_json, created_at
      FROM portal_settings_revisions WHERE revision = ?`)
      .bind(Number(match[1]))
      .first<RevisionRow>();
    return row ? json({ revision: publicRevision(row) }) : json({ error: "Settings revision not found" }, 404);
  }

  return json({ error: "Method not allowed" }, 405);
}

async function responsePayload(response: Response): Promise<Record<string, unknown>> {
  const payload = await response.clone().json().catch(() => ({}));
  return payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
}

async function restoreSnapshot(env: RuntimeEnv, snapshot: ActiveSnapshot, nextRevision: number): Promise<ActiveSnapshot> {
  await env.DB!.prepare(`INSERT INTO app_settings (id, config_json, encrypted_secrets, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET config_json = excluded.config_json, encrypted_secrets = excluded.encrypted_secrets, updated_at = excluded.updated_at`)
    .bind("main", snapshot.configJson, snapshot.encryptedSecrets, nextRevision)
    .run();
  return { ...snapshot, revision: nextRevision };
}

async function applyWithRollback(request: Request, env: RuntimeEnv, ctx: RuntimeContext, draftId: string): Promise<Response> {
  if (!env.DB) return json({ error: "Persistent database is unavailable" }, 503);
  await ensureRevisionTable(env);
  const before = await activeSnapshot(env);
  const response = await localRuntime.fetch(request, env, ctx);
  const payload = await responsePayload(response);
  const identity = await adminIdentity(request, env) || "service-admin@portal.local";
  if (!response.ok) {
    await appendAuditEvent(env, audit(identity), {
      action: "settings.draft.apply_failed",
      resourceType: "portal_settings_draft",
      resourceId: draftId,
      outcome: "failure",
      metadata: { status: response.status },
    }).catch(() => {});
    return response;
  }

  if (before) await recordRevision(env, before, { draftId, createdBy: identity, reason: "pre_apply", status: "superseded" });
  const after = await activeSnapshot(env);
  const health = Array.isArray(payload.health) ? payload.health as Array<Record<string, unknown>> : [];
  const failures = health.filter((item) => item.ok === false);
  if (after) {
    await recordRevision(env, after, {
      draftId,
      createdBy: identity,
      reason: failures.length ? "apply_health_failed" : "apply",
      status: failures.length ? "failed" : "active",
      health,
    });
  }

  if (!failures.length) {
    await appendAuditEvent(env, audit(identity), {
      action: "settings.draft.applied",
      resourceType: "portal_settings_draft",
      resourceId: draftId,
      outcome: "success",
      metadata: { revision: after?.revision ?? Number(payload.revision ?? 0), healthChecks: health.length },
    }).catch(() => {});
    return response;
  }

  let rollbackRevision = 0;
  let restoredSource: "database" | "environment" = "environment";
  if (before) {
    rollbackRevision = Math.max(Date.now(), Number(after?.revision ?? 0) + 1);
    const restored = await restoreSnapshot(env, before, rollbackRevision);
    restoredSource = "database";
    await recordRevision(env, restored, {
      draftId,
      createdBy: identity,
      reason: "automatic_rollback",
      status: "active",
      health,
    });
  } else {
    await env.DB.prepare("DELETE FROM app_settings WHERE id = ?").bind("main").run();
  }
  await env.DB.prepare("UPDATE portal_settings_drafts SET status = ?, updated_at = ? WHERE id = ?")
    .bind("rolled_back", Date.now(), draftId)
    .run();
  await appendAuditEvent(env, audit(identity), {
    action: "settings.draft.rolled_back",
    resourceType: "portal_settings_draft",
    resourceId: draftId,
    outcome: "failure",
    metadata: { failedServices: failures.map((item) => String(item.service ?? "unknown")), rollbackRevision, restoredSource },
  }).catch(() => {});

  return json({
    ok: false,
    rolledBack: true,
    code: "settings_post_apply_health_failed",
    error: "Новая конфигурация не прошла post-apply проверку и была автоматически отменена",
    attemptedRevision: after?.revision ?? Number(payload.revision ?? 0),
    revision: rollbackRevision,
    restoredSource,
    health,
  }, 502);
}

async function auditLifecyclePayload(request: Request, env: RuntimeEnv, payload: Record<string, unknown>, responseStatus: number, pathname: string): Promise<void> {
  if (request.method !== "POST") return;
  const identity = await adminIdentity(request, env);
  if (!identity) return;
  const draft = payload.draft && typeof payload.draft === "object" ? payload.draft as Record<string, unknown> : {};
  const draftId = String(draft.id ?? pathname.split("/").at(-2) ?? "unknown").slice(0, 100);
  const ok = responseStatus >= 200 && responseStatus < 300;
  const action = pathname === "/api/integrations/settings/drafts"
    ? "settings.draft.created"
    : pathname.endsWith("/validate")
      ? ok ? "settings.draft.validated" : responseStatus === 409 ? "settings.draft.conflict" : "settings.draft.validation_failed"
      : "settings.draft.updated";
  await appendAuditEvent(env, audit(identity), {
    action,
    resourceType: "portal_settings_draft",
    resourceId: draftId,
    outcome: ok ? "success" : "failure",
    metadata: { status: responseStatus, draftStatus: String(draft.status ?? "") },
  }).catch(() => {});
}

const worker = {
  async fetch(request: Request, env: RuntimeEnv | undefined, ctx: RuntimeContext): Promise<Response> {
    const sourceEnv = env ?? (process.env as unknown as RuntimeEnv);
    const url = new URL(request.url);
    if (isRevisionPath(url.pathname)) return handleRevisionApi(request, sourceEnv, url);

    const applyMatch = url.pathname.match(/^\/api\/integrations\/settings\/drafts\/([A-Za-z0-9-]{1,80})\/apply$/);
    if (request.method === "POST" && applyMatch) return applyWithRollback(request, sourceEnv, ctx, applyMatch[1]);

    const response = await localRuntime.fetch(request, sourceEnv, ctx);
    if (url.pathname === "/api/integrations/settings/drafts" || url.pathname.includes("/api/integrations/settings/drafts/")) {
      const payload = await responsePayload(response);
      ctx.waitUntil(auditLifecyclePayload(request, sourceEnv, payload, response.status, url.pathname));
    }
    return response;
  },

  async scheduled(controller: ScheduledController, env: RuntimeEnv | undefined, ctx: RuntimeContext): Promise<void> {
    return localRuntime.scheduled?.(controller, env, ctx);
  },
};

export default worker;
