import { appendAuditEvent, auditCorrelationFor, createAuditContext } from "../audit-log.ts";
import { listRunResults, saveRunResult, type PublicRunResult } from "../src/operations/run/run-results.ts";
import type { RunReplaySummary } from "../src/operations/run/run-replays.ts";
import { saveOperationRun, type OperationRun, type RunStage, type RunStatus } from "./operation-run-runtime.ts";

type XyOpsRunEnv = {
  DB?: D1Database;
  XYOPS_API_KEY?: string;
};

export function xyopsPayloadSucceeded(payload: unknown): boolean {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return true;
  const code = (payload as Record<string, unknown>).code;
  return typeof code !== "number" || code === 0;
}

export function runStatus(value: unknown): RunStatus {
  const normalized = String(value ?? "").toLowerCase().replace(/[\s-]+/g, "_");
  if (["success", "succeeded", "completed", "complete", "done", "ok"].includes(normalized)) return "success";
  if (["cancelled", "canceled", "aborted", "abort"].includes(normalized)) return "cancelled";
  if (["failed", "failure", "error", "timeout", "timed_out"].includes(normalized)) return "failed";
  if (["running", "active", "processing", "in_progress", "executing"].includes(normalized)) return "running";
  if (["queued", "pending", "created", "scheduled", "waiting"].includes(normalized)) return "queued";
  return "unknown";
}

function jobLifecycleStatus(row: Record<string, unknown>, active = false): RunStatus {
  const completed = Number(row.completed ?? row.completed_at ?? row.finished_at ?? 0);
  if (Number.isFinite(completed) && completed > 0) {
    const code = row.code ?? row.exit_code ?? row.exitCode;
    return code === undefined || code === null || code === 0 || code === false || code === "0" || code === "" ? "success" : "failed";
  }
  const lifecycle = runStatus(row.state ?? row.lifecycle_status ?? row.lifecycleStatus ?? row.outcome);
  if (lifecycle !== "unknown") return lifecycle;
  const reported = runStatus(row.status);
  if (reported !== "unknown") return reported;
  return active ? "running" : "unknown";
}

function jobTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value < 10_000_000_000 ? value * 1000 : value;
  if (typeof value === "string" && value) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function publicRun(run: OperationRun, replay: RunReplaySummary | undefined, result: PublicRunResult | undefined, canRun: boolean) {
  const active = ["queued", "running", "unknown"].includes(run.status);
  const terminal = ["success", "failed", "cancelled"].includes(run.status);
  return {
    ...run,
    error: run.error || null,
    result: result ?? null,
    actions: {
      cancel: canRun && run.mode === "live" && active && /^[a-z0-9_]+$/.test(run.jobId),
      rerun: canRun && terminal && Boolean(replay?.replayable) && !run.eventId.startsWith("freeipa:"),
      rerunLabel: run.status === "success" ? "Запустить снова" : "Повторить",
      reason: replay?.reason || "",
      parentRunId: replay?.parentRunId || "",
    },
  };
}

export async function listOperationRuns(env: XyOpsRunEnv, limit = 100): Promise<OperationRun[]> {
  if (!env.DB) return [];
  const result = await env.DB.prepare("SELECT id, job_id, event_id, title, kind, mode, status, actor, subject, error, stages_json, started_at, updated_at, completed_at FROM operation_runs ORDER BY started_at DESC LIMIT ?").bind(Math.max(1, Math.min(limit, 200))).all<Record<string, unknown>>();
  return (result.results ?? []).map((row) => ({
    id: String(row.id ?? ""), jobId: String(row.job_id ?? ""), eventId: String(row.event_id ?? ""), title: String(row.title ?? ""),
    kind: row.kind === "workflow" ? "workflow" : "event", mode: row.mode === "demo" ? "demo" : "live", status: runStatus(row.status),
    actor: String(row.actor ?? "portal-user"), subject: String(row.subject ?? "—"), error: String(row.error ?? ""),
    stages: (() => { try { const stages = JSON.parse(String(row.stages_json ?? "[]")); return Array.isArray(stages) ? stages.slice(0, 100) as RunStage[] : []; } catch { return []; } })(),
    startedAt: Number(row.started_at ?? 0), updatedAt: Number(row.updated_at ?? 0), completedAt: row.completed_at == null ? null : Number(row.completed_at),
  })).filter((run) => run.id);
}

function extractJobRows(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) return payload.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"));
  if (!payload || typeof payload !== "object") return [];
  const source = payload as Record<string, unknown>;
  for (const key of ["jobs", "active_jobs", "rows", "data", "result"]) if (source[key] !== payload) {
    const rows = extractJobRows(source[key]);
    if (rows.length) return rows;
  }
  return [];
}

export function extractJobStages(row: Record<string, unknown>): RunStage[] {
  const raw = [row.stages, row.steps, row.tasks, row.nodes, row.workflow_steps].find(Array.isArray) as unknown[] | undefined;
  if (!raw) return [];
  const timestamp = (value: unknown): number | null => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value) { const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : null; }
    return null;
  };
  return raw.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item))).slice(0, 100).map((stage, index) => ({
    id: String(stage.id ?? stage.step_id ?? stage.key ?? index).slice(0, 160),
    title: String(stage.title ?? stage.name ?? stage.label ?? `Этап ${index + 1}`).slice(0, 240),
    status: runStatus(stage.status ?? stage.state ?? stage.result),
    startedAt: timestamp(stage.started_at ?? stage.startedAt),
    completedAt: timestamp(stage.completed_at ?? stage.completedAt ?? stage.finished_at),
    error: String(stage.error ?? stage.message ?? "").slice(0, 500),
  }));
}

export async function syncOperationRuns(env: XyOpsRunEnv, xyopsUrl: string | null, runs: OperationRun[]): Promise<OperationRun[]> {
  if (!env.DB || !xyopsUrl || !env.XYOPS_API_KEY) return runs;
  const existingResults = await listRunResults(env, runs.map((run) => run.id));
  const activeRuns = runs.filter((run) => run.mode === "live" && ["queued", "running", "unknown"].includes(run.status) && run.jobId);
  const resultPending = runs.filter((run) => run.mode === "live" && ["success", "failed"].includes(run.status) && run.jobId && !existingResults.has(run.id));
  if (!activeRuns.length && !resultPending.length) return runs;
  try {
    let rows: Array<Record<string, unknown>> = [];
    if (activeRuns.length) {
      try {
        const response = await fetch(`${xyopsUrl}/api/app/get_active_jobs/v1`, { headers: { "x-api-key": env.XYOPS_API_KEY, accept: "application/json" }, signal: AbortSignal.timeout(12000) });
        if (response.ok) rows = extractJobRows(await response.json().catch(() => null));
      } catch {}
    }
    const byId = new Map(rows.map((row) => [String(row.job_id ?? row.jobId ?? row.id ?? ""), row]));
    const detailRuns = [...activeRuns.filter((run) => !byId.has(run.jobId)), ...resultPending];
    const ids = Array.from(new Set(detailRuns.map((run) => run.jobId).filter(Boolean))).slice(0, 100);
    if (ids.length) {
      try {
        const detailsResponse = await fetch(`${xyopsUrl}/api/app/get_jobs/v1`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": env.XYOPS_API_KEY, accept: "application/json" },
          body: JSON.stringify({ ids, verbose: true }),
          signal: AbortSignal.timeout(12000),
        });
        const detailsPayload = await detailsResponse.json().catch(() => null) as Record<string, unknown> | null;
        if (detailsResponse.ok && detailsPayload && xyopsPayloadSucceeded(detailsPayload) && Array.isArray(detailsPayload.jobs)) {
          for (const row of detailsPayload.jobs) {
            if (!row || typeof row !== "object" || Array.isArray(row) || "err" in row) continue;
            const record = row as Record<string, unknown>;
            const id = String(record.job_id ?? record.jobId ?? record.id ?? "");
            if (id) byId.set(id, record);
          }
        }
      } catch {}
    }
    const now = Date.now();
    for (const run of runs) {
      const row = byId.get(run.jobId);
      if (!row) continue;
      const nextStatus = jobLifecycleStatus(row, rows.includes(row));
      const nextStages = extractJobStages(row);
      const stagesChanged = nextStages.length > 0 && JSON.stringify(nextStages) !== JSON.stringify(run.stages);
      const statusChanged = nextStatus !== "unknown" && nextStatus !== run.status;
      if (statusChanged) run.status = nextStatus;
      if (nextStages.length) run.stages = nextStages;
      if (statusChanged || stagesChanged) {
        run.updatedAt = now;
        if (["success", "failed", "cancelled"].includes(run.status)) run.completedAt = jobTimestamp(row.completed ?? row.completed_at ?? row.finished_at) ?? now;
        if (run.status === "failed") run.error = String(row.description ?? row.error ?? row.message ?? "XYOps job failed").slice(0, 500);
        await saveOperationRun(env, run);
        if (statusChanged) {
          const correlationId = await auditCorrelationFor(env, { runId: run.id }).catch(() => null);
          const systemAudit = createAuditContext({ identity: "system@portal.local", role: "system", groups: [] }, correlationId ?? undefined);
          await appendAuditEvent(env, systemAudit, { action: "xyops.run.status_changed", resourceType: "xyops_run", resourceId: run.id, eventId: run.eventId, runId: run.id, jobId: run.jobId, outcome: run.status === "success" ? "success" : run.status === "failed" || run.status === "cancelled" ? "failure" : "info", errorCode: run.status === "failed" ? "xyops_job_failed" : "", metadata: { status: run.status, stageCount: run.stages.length } }).catch(() => {});
        }
      }
      if (["success", "failed"].includes(run.status)) await saveRunResult(env, run.id, run.jobId, row);
    }
  } catch {}
  return runs;
}
