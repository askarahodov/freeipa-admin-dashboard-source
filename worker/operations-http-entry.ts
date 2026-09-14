import integrationRuntime from "./index";
import { listRunNotifications, markRunNotificationsRead } from "../src/operations/run/run-notifications.ts";
import { listRunReplaySummaries } from "../src/operations/run/run-replays.ts";
import { listRunResults, readRunResultFile } from "../src/operations/run/run-results.ts";
import { effectiveXyOpsRuntime, type XyOpsSettingsEnv } from "./integration-settings-runtime.ts";
import { portalAccess, requirePortalPermission } from "./portal-access-runtime.ts";
import { listOperationRuns, publicRun, syncOperationRuns } from "./xyops-run-runtime.ts";

type RuntimeEnv = NonNullable<Parameters<typeof integrationRuntime.fetch>[1]> & XyOpsSettingsEnv;
type RuntimeContext = Parameters<typeof integrationRuntime.fetch>[2];
type ScheduledController = Parameters<NonNullable<typeof integrationRuntime.scheduled>>[0];

const jsonHeaders = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}

async function handleNotificationsList(request: Request, env: RuntimeEnv, url: URL): Promise<Response> {
  const denied = requirePortalPermission(request, env, "directory.read");
  if (denied) return denied;
  const access = portalAccess(request, env);
  const limit = Number(url.searchParams.get("limit") ?? 50);
  try { return json(await listRunNotifications(env, access.identity, Number.isFinite(limit) ? limit : 50)); }
  catch { return json({ notifications: [], unread: 0, persistenceAvailable: Boolean(env.DB) }); }
}

async function handleNotificationsRead(request: Request, env: RuntimeEnv): Promise<Response> {
  const denied = requirePortalPermission(request, env, "directory.read");
  if (denied) return denied;
  let body: Record<string, unknown> = {};
  try { body = await request.json() as Record<string, unknown>; }
  catch { return json({ error: "Invalid JSON" }, 400); }
  const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean).slice(0, 100) : [];
  const all = body.all === true;
  if (!all && !ids.length) return json({ error: "Укажите ids или all=true" }, 400);
  const access = portalAccess(request, env);
  try {
    await markRunNotificationsRead(env, access.identity, all ? null : ids);
    return json(await listRunNotifications(env, access.identity, 50));
  } catch {
    return json({ error: "Не удалось обновить уведомления" }, 503);
  }
}

async function handleRunFile(request: Request, env: RuntimeEnv, runId: string, fileId: string): Promise<Response> {
  const denied = requirePortalPermission(request, env, "directory.read");
  if (denied) return denied;
  const runtime = await effectiveXyOpsRuntime(env);
  const xyopsEnv = runtime.env;
  const xyopsUrl = runtime.xyopsUrl;
  if (!xyopsUrl || !xyopsEnv.XYOPS_API_KEY) return json({ error: "XYOps is not configured" }, 503);
  const run = (await listOperationRuns(env, 200)).find((item) => item.id === runId);
  if (!run || run.mode !== "live" || !/^[a-z0-9_]+$/.test(run.jobId)) return json({ error: "Файл запуска не найден" }, 404);
  const file = await readRunResultFile(env, runId, fileId);
  if (!file) return json({ error: "Файл результата не найден" }, 404);
  try {
    const xyopsOrigin = new URL(`${xyopsUrl}/`);
    const fileUrl = new URL(file.path, xyopsOrigin);
    if (fileUrl.origin !== xyopsOrigin.origin) return json({ error: "Путь файла результата вышел за пределы XYOps origin" }, 502);
    const response = await fetch(fileUrl, {
      method: "GET",
      headers: { "x-api-key": xyopsEnv.XYOPS_API_KEY, accept: "application/octet-stream" },
      redirect: "manual",
      signal: AbortSignal.timeout(30000),
    });
    if (response.status >= 300 && response.status < 400) return json({ error: "XYOps перенаправил запрос файла; скачивание заблокировано" }, 502);
    if (!response.ok || !response.body) return json({ error: "XYOps не вернул файл результата" }, response.status === 404 ? 404 : 502);
    const configuredLimit = Number(xyopsEnv.XYOPS_RESULT_FILE_MAX_BYTES ?? 52_428_800);
    const maxBytes = Number.isFinite(configuredLimit) && configuredLimit > 0 ? Math.min(configuredLimit, 536_870_912) : 52_428_800;
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) return json({ error: "Файл результата превышает разрешённый размер", maxBytes }, 413);
    const fallbackName = file.filename.replace(/[^ -~]/g, "_").replaceAll(String.fromCharCode(34), "_").replaceAll(String.fromCharCode(92), "_") || "result.bin";
    const headers = new Headers({
      "content-type": "application/octet-stream",
      "content-disposition": `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    });
    if (contentLength > 0) headers.set("content-length", String(contentLength));
    return new Response(response.body, { status: 200, headers });
  } catch {
    return json({ error: "Не удалось скачать файл результата из XYOps" }, 502);
  }
}

async function handleRunsList(request: Request, env: RuntimeEnv, url: URL): Promise<Response> {
  const runtime = await effectiveXyOpsRuntime(env);
  const limit = Number(url.searchParams.get("limit") ?? 100);
  let runs = await listOperationRuns(env, Number.isFinite(limit) ? limit : 100);
  if (url.searchParams.get("sync") !== "0") runs = await syncOperationRuns(runtime.env, runtime.xyopsUrl, runs);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayRuns = runs.filter((run) => run.startedAt >= today.getTime());
  const access = portalAccess(request, env);
  const [replay, results] = await Promise.all([
    listRunReplaySummaries(env, runs.map((run) => run.id)),
    listRunResults(env, runs.map((run) => run.id)),
  ]);
  return json({
    persistenceAvailable: Boolean(env.DB),
    runs: runs.map((run) => publicRun(run, replay.get(run.id), results.get(run.id), access.permissions.includes("xyops.run"))),
    stats: {
      today: todayRuns.length,
      queued: todayRuns.filter((run) => run.status === "queued" || run.status === "running").length,
      success: todayRuns.filter((run) => run.status === "success").length,
      failed: todayRuns.filter((run) => run.status === "failed").length,
    },
  });
}

/**
 * First #632 operations owner. Read-side run history/result-file delivery and
 * per-identity run notifications live here after the established security and
 * FreeIPA adapters. Mutating run/catalog/approval routes intentionally remain
 * in the central integration runtime for the next bounded slices.
 */
const worker = {
  async fetch(request: Request, env: RuntimeEnv | undefined, ctx: RuntimeContext): Promise<Response> {
    const sourceEnv = env ?? (process.env as unknown as RuntimeEnv);
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/api/integrations/notifications") {
      return handleNotificationsList(request, sourceEnv, url);
    }
    if (request.method === "POST" && url.pathname === "/api/integrations/notifications/read") {
      return handleNotificationsRead(request, sourceEnv);
    }
    const runFileMatch = url.pathname.match(/^\/api\/integrations\/runs\/([A-Za-z0-9_-]{1,160})\/files\/([A-Za-z0-9_-]{1,160})$/);
    if (request.method === "GET" && runFileMatch) {
      return handleRunFile(request, sourceEnv, runFileMatch[1], runFileMatch[2]);
    }
    if (request.method === "GET" && url.pathname === "/api/integrations/runs") {
      return handleRunsList(request, sourceEnv, url);
    }
    return integrationRuntime.fetch(request, sourceEnv, ctx);
  },

  async scheduled(controller: ScheduledController, env: RuntimeEnv | undefined, ctx: RuntimeContext): Promise<void> {
    return integrationRuntime.scheduled?.(controller, env, ctx);
  },
};

export default worker;
