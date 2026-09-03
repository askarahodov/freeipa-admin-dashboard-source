export type OperationRunStatus = "queued" | "running" | "success" | "failed" | "cancelled" | "unknown";

export type OperationRunStage = {
  id: string;
  title: string;
  status: OperationRunStatus;
  startedAt: number | null;
  completedAt: number | null;
  error: string;
};

export type OperationRun = {
  id: string;
  jobId: string;
  eventId: string;
  title: string;
  kind: "event" | "workflow";
  mode: "demo" | "live";
  status: OperationRunStatus;
  actor: string;
  subject: string;
  error: string | null;
  stages: OperationRunStage[];
  startedAt: number;
  updatedAt: number;
  completedAt: number | null;
};

export type OperationStatusFilter = OperationRunStatus | "all" | "active" | "finished";
export type OperationSort = "started_desc" | "started_asc" | "duration_desc" | "duration_asc";

export type OperationQuery = {
  q: string;
  status: OperationStatusFilter;
  actor: string;
  from: string;
  to: string;
  sort: OperationSort;
  page: number;
  pageSize: number;
};

export type OperationQueryResult = {
  runs: OperationRun[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    from: number;
    to: number;
  };
  filters: OperationQuery;
  summary: {
    total: number;
    filtered: number;
    active: number;
    queued: number;
    running: number;
    success: number;
    failed: number;
    cancelled: number;
    unknown: number;
  };
  options: {
    actors: string[];
    processes: Array<{ id: string; title: string }>;
  };
};

export type OperationTimelineEntry = {
  id: string;
  title: string;
  status: OperationRunStatus;
  startedAt: number | null;
  completedAt: number | null;
  durationMs: number | null;
  waitingMs: number | null;
  offsetMs: number | null;
  progress: number;
  error: string;
};

export type OperationTimeline = {
  totalDurationMs: number;
  startedAt: number;
  completedAt: number | null;
  updatedAt: number;
  active: boolean;
  stages: OperationTimelineEntry[];
};

const pageSizes = [10, 25, 50, 100] as const;
const collator = new Intl.Collator("ru", { sensitivity: "base", numeric: true });

function cleanText(value: string | null, maximum: number): string {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, maximum);
}

function positiveInteger(value: string | null, fallback: number, maximum: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

function pageSize(value: string | null): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return pageSizes.includes(parsed as (typeof pageSizes)[number]) ? parsed : 25;
}

function dateText(value: string | null): string {
  const text = cleanText(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

export function normalizeOperationQuery(searchParams: URLSearchParams): OperationQuery {
  const status = searchParams.get("status");
  const sort = searchParams.get("sort");
  return {
    q: cleanText(searchParams.get("q"), 200),
    status: status === "queued" || status === "running" || status === "success" || status === "failed" || status === "cancelled" || status === "unknown" || status === "active" || status === "finished" ? status : "all",
    actor: cleanText(searchParams.get("actor"), 200),
    from: dateText(searchParams.get("from")),
    to: dateText(searchParams.get("to")),
    sort: sort === "started_asc" || sort === "duration_desc" || sort === "duration_asc" ? sort : "started_desc",
    page: positiveInteger(searchParams.get("page"), 1, 100_000),
    pageSize: pageSize(searchParams.get("pageSize")),
  };
}

function startOfLocalDate(value: string): number | null {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00`).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function endOfLocalDate(value: string): number | null {
  const start = startOfLocalDate(value);
  return start === null ? null : start + 86_400_000 - 1;
}

function statusMatches(status: OperationRunStatus, filter: OperationStatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "active") return status === "queued" || status === "running";
  if (filter === "finished") return status === "success" || status === "failed" || status === "cancelled";
  return status === filter;
}

function runSearchText(run: OperationRun): string {
  return [run.title, run.eventId, run.jobId, run.subject, run.actor, run.kind, run.mode]
    .join("\u0000")
    .toLocaleLowerCase("ru");
}

export function operationDurationMs(run: OperationRun, now = Date.now()): number {
  const active = run.status === "queued" || run.status === "running";
  const end = run.completedAt ?? (active ? Math.max(now, run.updatedAt || 0) : run.updatedAt || run.startedAt);
  return Math.max(0, end - run.startedAt);
}

function compareRuns(left: OperationRun, right: OperationRun, sort: OperationSort, now: number): number {
  if (sort === "duration_desc" || sort === "duration_asc") {
    const duration = operationDurationMs(left, now) - operationDurationMs(right, now);
    if (duration !== 0) return sort === "duration_desc" ? -duration : duration;
  } else {
    const started = left.startedAt - right.startedAt;
    if (started !== 0) return sort === "started_desc" ? -started : started;
  }
  const job = collator.compare(left.jobId, right.jobId);
  return job || collator.compare(left.id, right.id);
}

function normalizedRun(run: OperationRun): OperationRun | null {
  if (!run || typeof run.id !== "string" || !run.id || !Number.isFinite(Number(run.startedAt))) return null;
  return {
    ...run,
    id: cleanText(run.id, 200),
    jobId: cleanText(run.jobId, 200),
    eventId: cleanText(run.eventId, 200),
    title: cleanText(run.title, 300),
    actor: cleanText(run.actor, 300),
    subject: cleanText(run.subject, 500),
    error: run.error ? cleanText(run.error, 1_000) : null,
    startedAt: Math.max(0, Number(run.startedAt) || 0),
    updatedAt: Math.max(0, Number(run.updatedAt) || 0),
    completedAt: run.completedAt === null ? null : Math.max(0, Number(run.completedAt) || 0),
    stages: Array.isArray(run.stages) ? run.stages.map((stage, index) => ({
      id: cleanText(stage?.id || `stage-${index + 1}`, 200),
      title: cleanText(stage?.title || `Этап ${index + 1}`, 300),
      status: stage?.status === "queued" || stage?.status === "running" || stage?.status === "success" || stage?.status === "failed" || stage?.status === "cancelled" ? stage.status : "unknown",
      startedAt: stage?.startedAt === null || stage?.startedAt === undefined ? null : Math.max(0, Number(stage.startedAt) || 0),
      completedAt: stage?.completedAt === null || stage?.completedAt === undefined ? null : Math.max(0, Number(stage.completedAt) || 0),
      error: cleanText(stage?.error, 1_000),
    })) : [],
  };
}

export function queryOperationRuns(runs: OperationRun[], query: OperationQuery, now = Date.now()): OperationQueryResult {
  const normalized = runs.map(normalizedRun).filter((run): run is OperationRun => Boolean(run));
  const actors = Array.from(new Set(normalized.map((run) => run.actor).filter(Boolean))).sort(collator.compare);
  const processMap = new Map<string, string>();
  for (const run of normalized) if (run.eventId) processMap.set(run.eventId, run.title || run.eventId);
  const processes = Array.from(processMap, ([id, title]) => ({ id, title })).sort((left, right) => collator.compare(left.title, right.title) || collator.compare(left.id, right.id));

  const search = query.q.toLocaleLowerCase("ru");
  const actor = query.actor.toLocaleLowerCase("ru");
  const from = startOfLocalDate(query.from);
  const to = endOfLocalDate(query.to);
  const filtered = normalized.filter((run) => {
    if (search && !runSearchText(run).includes(search)) return false;
    if (actor && !run.actor.toLocaleLowerCase("ru").includes(actor)) return false;
    if (!statusMatches(run.status, query.status)) return false;
    if (from !== null && run.startedAt < from) return false;
    if (to !== null && run.startedAt > to) return false;
    return true;
  });

  filtered.sort((left, right) => compareRuns(left, right, query.sort, now));
  const totalPages = Math.max(1, Math.ceil(filtered.length / query.pageSize));
  const page = Math.min(query.page, totalPages);
  const offset = (page - 1) * query.pageSize;
  const pageRuns = filtered.slice(offset, offset + query.pageSize);
  const count = (status: OperationRunStatus) => normalized.filter((run) => run.status === status).length;

  return {
    runs: pageRuns,
    pagination: {
      page,
      pageSize: query.pageSize,
      total: filtered.length,
      totalPages,
      from: pageRuns.length ? offset + 1 : 0,
      to: pageRuns.length ? offset + pageRuns.length : 0,
    },
    filters: { ...query, page },
    summary: {
      total: normalized.length,
      filtered: filtered.length,
      active: normalized.filter((run) => run.status === "queued" || run.status === "running").length,
      queued: count("queued"),
      running: count("running"),
      success: count("success"),
      failed: count("failed"),
      cancelled: count("cancelled"),
      unknown: count("unknown"),
    },
    options: { actors, processes },
  };
}

export function buildOperationTimeline(run: OperationRun, now = Date.now()): OperationTimeline {
  const active = run.status === "queued" || run.status === "running";
  const totalDurationMs = operationDurationMs(run, now);
  const activeEnd = run.completedAt ?? (active ? Math.max(now, run.updatedAt || 0) : run.updatedAt || run.startedAt);
  let previousBoundary = run.startedAt;
  const stages = run.stages.map((stage) => {
    const startedAt = stage.startedAt;
    const completedAt = stage.completedAt ?? (stage.status === "running" ? activeEnd : null);
    const durationMs = startedAt === null ? null : Math.max(0, (completedAt ?? startedAt) - startedAt);
    const waitingMs = startedAt === null ? null : Math.max(0, startedAt - previousBoundary);
    const offsetMs = startedAt === null ? null : Math.max(0, startedAt - run.startedAt);
    if (completedAt !== null) previousBoundary = Math.max(previousBoundary, completedAt);
    else if (startedAt !== null) previousBoundary = Math.max(previousBoundary, startedAt);
    const progress = durationMs === null || totalDurationMs <= 0 ? 0 : Math.min(100, Math.max(durationMs > 0 ? 2 : 0, (durationMs / totalDurationMs) * 100));
    return { ...stage, completedAt, durationMs, waitingMs, offsetMs, progress };
  });
  return { totalDurationMs, startedAt: run.startedAt, completedAt: run.completedAt, updatedAt: run.updatedAt, active, stages };
}

export function formatOperationDuration(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value < 0) return "—";
  if (value < 1_000) return "<1 с";
  const seconds = Math.floor(value / 1_000);
  if (seconds < 60) return `${seconds} с`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return remainingSeconds ? `${minutes} мин ${remainingSeconds} с` : `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours} ч ${remainingMinutes} мин` : `${hours} ч`;
}
