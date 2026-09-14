import { saveRunNotification } from "../src/operations/run/run-notifications.ts";
import { requestActor } from "./portal-access-runtime.ts";

export type RunStatus = "queued" | "running" | "success" | "failed" | "cancelled" | "unknown";
export type RunStage = { id: string; title: string; status: RunStatus; startedAt: number | null; completedAt: number | null; error: string };

export type OperationRun = {
  id: string;
  jobId: string;
  eventId: string;
  title: string;
  kind: "event" | "workflow";
  mode: "demo" | "live";
  status: RunStatus;
  actor: string;
  subject: string;
  error: string;
  stages: RunStage[];
  startedAt: number;
  updatedAt: number;
  completedAt: number | null;
};

type OperationRunEnv = { DB?: D1Database };

function runSubject(values: Record<string, unknown>, targets: string[] = []): string {
  for (const key of ["username", "uid", "group", "database", "server", "hostname", "name"]) {
    const value = values[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 240);
  }
  return targets.filter(Boolean).slice(0, 3).join(", ").slice(0, 240) || "—";
}

export function operationRun(input: {
  request: Request;
  eventId: string;
  title: string;
  kind: "event" | "workflow";
  mode: "demo" | "live";
  jobId: string;
  status: RunStatus;
  values?: Record<string, unknown>;
  targets?: string[];
  error?: string;
  stages?: RunStage[];
}): OperationRun {
  const now = Date.now();
  return {
    id: crypto.randomUUID(), jobId: input.jobId || `LOCAL-${now}`, eventId: input.eventId, title: input.title,
    kind: input.kind, mode: input.mode, status: input.status, actor: requestActor(input.request),
    subject: runSubject(input.values ?? {}, input.targets), error: (input.error ?? "").slice(0, 500), stages: input.stages ?? [],
    startedAt: now, updatedAt: now, completedAt: ["success", "failed", "cancelled"].includes(input.status) ? now : null,
  };
}

export async function saveOperationRun(env: OperationRunEnv, run: OperationRun): Promise<void> {
  if (!env.DB) return;
  await env.DB.prepare("INSERT INTO operation_runs (id, job_id, event_id, title, kind, mode, status, actor, subject, error, stages_json, started_at, updated_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET job_id = excluded.job_id, status = excluded.status, error = excluded.error, stages_json = excluded.stages_json, updated_at = excluded.updated_at, completed_at = excluded.completed_at")
    .bind(run.id, run.jobId, run.eventId, run.title, run.kind, run.mode, run.status, run.actor, run.subject, run.error || null, JSON.stringify(run.stages), run.startedAt, run.updatedAt, run.completedAt).run();
  await saveRunNotification(env, run).catch(() => {});
}
