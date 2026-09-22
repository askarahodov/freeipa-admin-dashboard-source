import type { RouteField } from "../src/automation/automation-types";
import { fieldConditionMatches } from "../src/automation/field-conditions";
import integrationRuntime, { loadCatalog, portalCatalog } from "./index";
import { allowedOperations, automationRoutes, resolveCatalogRuntime } from "./xyops-admin-runtime.ts";
import { listRunNotifications, markRunNotificationsRead } from "../src/operations/run/run-notifications.ts";
import { readRunReplay, listRunReplaySummaries, saveRunReplay } from "../src/operations/run/run-replays.ts";
import { listRunResults, readRunResultFile } from "../src/operations/run/run-results.ts";
import { catalogEventAllowed, readCatalogPolicySet } from "../src/operations/catalog/catalog-policies.ts";
import {
  approvalExecutionMatches,
  approvalRequirement,
  cancelApproval,
  claimApprovalExecution,
  createApprovalRequest,
  decideApproval,
  finishApprovalExecution,
  listApprovals,
  readApprovalPolicySet,
  readExecutingApproval,
} from "../src/operations/approvals/approval-gates.ts";
import { appendAuditEvent, auditCorrelationFor, auditErrorCode, createAuditContext, withAuditCorrelation, type AuditContext } from "../audit-log";
import { operationRun, saveOperationRun } from "./operation-run-runtime.ts";
import { effectiveXyOpsRuntime, type XyOpsSettingsEnv } from "./integration-settings-runtime.ts";
import { handleIntegrationStatusRequest } from "./integration-status-http.ts";
import { handleXyOpsAdminRequest } from "./xyops-admin-http.ts";
import { portalAccess, requestActor, requirePortalPermission } from "./portal-access-runtime.ts";
import { applyProcessPresentation, availableProcessPresentationLocales, presentationLocalePreferences, readProcessPresentationSet, resolveProcessPresentationLocale } from "../src/operations/presentation/process-presentation";
import { extractJobStages, listOperationRuns, publicRun, runStatus, syncOperationRuns, xyopsPayloadSucceeded } from "./xyops-run-runtime.ts";

type RuntimeEnv = NonNullable<Parameters<typeof integrationRuntime.fetch>[1]> & XyOpsSettingsEnv;
type RuntimeContext = Parameters<typeof integrationRuntime.fetch>[2];
type ScheduledController = Parameters<NonNullable<typeof integrationRuntime.scheduled>>[0];
type ApprovalAction = "approve" | "reject" | "cancel" | "execute";

const jsonHeaders = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}

async function listCatalogHistory(env: RuntimeEnv, limit = 20) {
  if (!env.DB) return [];
  const result = await env.DB.prepare("SELECT id, synced_at, changes_json, catalog_json FROM xyops_catalog_history ORDER BY synced_at DESC LIMIT ?").bind(Math.max(1, Math.min(limit, 30))).all<Record<string, unknown>>();
  return (result.results ?? []).map((row) => {
    let changes: Array<{ id: string; title: string; kind: "new" | "changed" | "removed" }> = [];
    let processCount = 0;
    try { const parsed = JSON.parse(String(row.changes_json ?? "[]")); if (Array.isArray(parsed)) changes = parsed.slice(0, 500); } catch {}
    try { const parsed = JSON.parse(String(row.catalog_json ?? "[]")); if (Array.isArray(parsed)) processCount = parsed.length; } catch {}
    return { id: String(row.id ?? ""), syncedAt: Number(row.synced_at ?? 0), changes, processCount };
  }).filter((entry) => entry.id);
}

function coerceField(field: RouteField, raw: unknown): unknown | null {
  if ((raw === undefined || raw === null || raw === "") && field.default !== undefined) raw = field.default;
  if (raw === undefined || raw === null || raw === "") return field.required ? null : "";
  if (field.type === "boolean") return raw === true || raw === "true" || raw === "1" || raw === "on";
  if (field.type === "number") { const number = Number(raw); return Number.isFinite(number) && (field.min === undefined || number >= field.min) && (field.max === undefined || number <= field.max) ? number : null; }
  if (field.type === "multiselect") {
    const values = Array.isArray(raw) ? raw.map(String) : String(raw).split(",").map((value) => value.trim()).filter(Boolean);
    return field.options && values.some((value) => !field.options?.includes(value)) ? null : values;
  }
  if (field.type === "json") {
    if (typeof raw !== "string") return raw;
    try { return JSON.parse(raw); } catch { return null; }
  }
  const value = String(raw).slice(0, 2048);
  if (field.type === "select" && field.options && !field.options.includes(value)) return null;
  return value;
}

function fieldVisible(field: RouteField, values: Record<string, unknown>): boolean {
  return fieldConditionMatches(field.visibleWhen, values);
}

function extractOptionValues(payload: unknown): string[] {
  if (Array.isArray(payload)) return payload.map((item) => {
    if (typeof item === "string" || typeof item === "number") return String(item);
    if (item && typeof item === "object") { const row = item as Record<string, unknown>; return String(row.value ?? row.id ?? row.name ?? row.title ?? row.label ?? ""); }
    return "";
  }).filter(Boolean).slice(0, 500);
  if (!payload || typeof payload !== "object") return [];
  const source = payload as Record<string, unknown>;
  for (const key of ["options", "items", "values", "rows", "data", "result"]) {
    if (source[key] === payload) continue;
    const values = extractOptionValues(source[key]);
    if (values.length) return values;
  }
  return [];
}

type CatalogRunReplayGuard = {
  expectedSchemaVersion: string;
  dangerousConfirmed: boolean;
  sourceRunId: string;
  sourceJobId: string;
  previousStatus: string;
};

async function handleCatalogRunRequest(
  request: Request,
  baseEnv: RuntimeEnv,
  url: URL,
  inheritedAudit?: AuditContext,
  replayGuard?: CatalogRunReplayGuard,
  resolvedRuntime?: { env: RuntimeEnv; xyopsUrl: string | null },
  approvedExecutionId?: string,
): Promise<Response> {
  const audit = inheritedAudit ?? createAuditContext(portalAccess(request, baseEnv));
  const runtime = resolvedRuntime ?? await resolveCatalogRuntime(baseEnv);
  const env = runtime.env;
  const xyopsUrl = runtime.xyopsUrl;
  const denied = requirePortalPermission(request, baseEnv, "xyops.run");
  if (denied) return denied;
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return json({ error: "Invalid JSON" }, 400); }
  const eventId = typeof body.eventId === "string" ? body.eventId : "";
  const values = body.values && typeof body.values === "object" && !Array.isArray(body.values) ? body.values as Record<string, unknown> : {};
  try {
    const catalog = await loadCatalog(env, xyopsUrl);
    if (catalog.mode === "unconfigured") return json({ error: "XYOps is not configured" }, 503);
    const event = catalog.events.find((item) => item.id === eventId && item.enabled);
    if (!event) return replayGuard
      ? json({ error: "Исходный процесс отсутствует или отключён" }, 409)
      : json({ error: "XYOps process not found or disabled" }, 404);
    const access = portalAccess(request, baseEnv);
    const policyState = await readCatalogPolicySet(baseEnv);
    if (!catalogEventAllowed(policyState.policy, access, event)) return replayGuard
      ? json({ error: "Процесс недоступен по политике каталога" }, 404)
      : json({ error: "XYOps process not found or disabled" }, 404);
    if (replayGuard?.expectedSchemaVersion && (!event.schemaVersion || event.schemaVersion !== replayGuard.expectedSchemaVersion)) {
      return json({ error: "Схема процесса изменилась. Откройте актуальную форму и проверьте параметры заново.", schemaChanged: true }, 409);
    }
    if (replayGuard && event.dangerous && !replayGuard.dangerousConfirmed) {
      return json({ error: "Для опасного процесса требуется повторное подтверждение", requiresConfirmation: true }, 409);
    }
    if (replayGuard) {
      await appendAuditEvent(baseEnv, audit, {
        action: "xyops.run.rerun_requested", resourceType: "xyops_run", resourceId: replayGuard.sourceRunId,
        eventId: event.id, schemaVersion: replayGuard.expectedSchemaVersion, runId: replayGuard.sourceRunId,
        jobId: replayGuard.sourceJobId, outcome: "pending", metadata: { previousStatus: replayGuard.previousStatus },
      }).catch(() => {});
    }
    const presentationState = await readProcessPresentationSet(baseEnv);
    const displayEvent = applyProcessPresentation([event], presentationState.metadata, presentationLocalePreferences(url.searchParams.get("locale"), request.headers.get("accept-language")))[0] ?? event;
    const requestedTargets = Array.isArray(body.targets) ? body.targets.map(String) : [];
    if (event.targets.length && requestedTargets.some((target) => !event.targets.includes(target))) return json({ error: "Unsupported target" }, 400);
    const params: Record<string, unknown> = { source: "xyops-self-service" };
    const inputData: Record<string, unknown> = { source: "xyops-self-service" };
    const workflowData: Record<string, unknown> = {};
    for (const field of event.fields) {
      if (!fieldVisible(field, values)) continue;
      const value = coerceField(field, values[field.key]);
      if (value === null) return json({ error: `Invalid or missing field: ${field.key}` }, 400);
      if (value === "" && !field.required) continue;
      if (field.target === "workflowData") workflowData[field.key] = value;
      else if (field.target === "input") inputData[field.key] = value;
      else params[field.key] = value;
    }
    const launchPayload = { id: event.id, params, input: { data: inputData }, ...(event.kind === "workflow" ? { workflowData } : {}), ...(requestedTargets.length ? { targets: requestedTargets } : event.targets.length === 1 ? { targets: event.targets } : {}) };
    const internalApprovalExecutionId = String(approvedExecutionId ?? "").slice(0, 160);
    if (internalApprovalExecutionId) {
      const executing = await readExecutingApproval(baseEnv, internalApprovalExecutionId, access);
      if (!executing || !await approvalExecutionMatches(executing.spec, event, values, requestedTargets)) return json({ error: "Недействительное или использованное согласование" }, 409);
    } else {
      const approvalPolicy = await readApprovalPolicySet(baseEnv);
      const requirement = approvalRequirement(approvalPolicy.policy, access, event);
      if (requirement) {
        const approval = await createApprovalRequest(baseEnv, displayEvent, access, values, requestedTargets, requirement, typeof body.replayOf === "string" ? body.replayOf : "");
        await appendAuditEvent(baseEnv, audit, { action: "approval.requested", resourceType: "approval", resourceId: approval.id, eventId: event.id, schemaVersion: event.schemaVersion, approvalId: approval.id, outcome: "pending", metadata: { category: event.category, kind: event.kind, targets: requestedTargets, fieldKeys: event.fields.filter((field) => fieldVisible(field, values)).map((field) => field.key), requiredApprovals: requirement.requiredApprovals, ruleId: requirement.ruleId, replayOf: typeof body.replayOf === "string" ? body.replayOf : "" } }).catch(() => {});
        return json({ approvalRequired: true, approvalId: approval.id, status: approval.status, approval }, 202);
      }
    }
    if (catalog.mode === "demo" || !xyopsUrl || !env.XYOPS_API_KEY) {
      const run = operationRun({ request, eventId: event.id, title: displayEvent.title, kind: event.kind, mode: "demo", jobId: `DEMO-${Date.now()}`, status: "success", values, targets: requestedTargets });
      await saveOperationRun(baseEnv, run);
      await saveRunReplay(baseEnv, run.id, event, values, requestedTargets, typeof body.replayOf === "string" ? body.replayOf.slice(0, 160) : "");
      await appendAuditEvent(baseEnv, audit, { action: "xyops.run", resourceType: "xyops_run", resourceId: run.id, eventId: event.id, schemaVersion: event.schemaVersion, approvalId: internalApprovalExecutionId, runId: run.id, jobId: run.jobId, outcome: "success", metadata: { mode: "demo", kind: event.kind, targets: requestedTargets, replayOf: typeof body.replayOf === "string" ? body.replayOf : "" } }).catch(() => {});
      return json({ mode: "demo", queued: true, runId: run.id, jobId: run.jobId, status: run.status, process: { id: event.id, title: displayEvent.title, kind: event.kind } }, 202);
    }
    const response = await fetch(`${xyopsUrl}/api/app/run_event/v1`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": env.XYOPS_API_KEY }, body: JSON.stringify(launchPayload), signal: AbortSignal.timeout(15000) });
    const result = await response.json().catch(() => ({})) as Record<string, unknown>;
    const resultData = result.data && typeof result.data === "object" ? result.data as Record<string, unknown> : {};
    const jobId = String(result.job_id ?? result.jobId ?? result.id ?? resultData.job_id ?? "");
    if (!response.ok) {
      const retryAfter = String(response.headers.get("retry-after") ?? "").replace(/[^0-9A-Za-z, .:-]/g, "").slice(0, 120);
      const portalStatus = response.status === 409 || response.status === 429 ? response.status : 502;
      const message = response.status === 429 ? "XYOps ограничил частоту запусков" : response.status === 409 ? "XYOps не разрешил параллельный запуск" : "XYOps rejected run_event";
      const run = operationRun({ request, eventId: event.id, title: displayEvent.title, kind: event.kind, mode: "live", jobId, status: "failed", values, targets: requestedTargets, error: message });
      await saveOperationRun(baseEnv, run);
      await saveRunReplay(baseEnv, run.id, event, values, requestedTargets, typeof body.replayOf === "string" ? body.replayOf.slice(0, 160) : "");
      await appendAuditEvent(baseEnv, audit, { action: "xyops.run", resourceType: "xyops_run", resourceId: run.id, eventId: event.id, schemaVersion: event.schemaVersion, approvalId: internalApprovalExecutionId, runId: run.id, jobId, outcome: "failure", errorCode: response.status === 429 ? "xyops_rate_limited" : response.status === 409 ? "xyops_concurrency_conflict" : "xyops_run_event_rejected", metadata: { httpStatus: response.status, retryAfter, kind: event.kind, targets: requestedTargets } }).catch(() => {});
      return json({ error: message, runId: run.id, xyopsStatus: response.status, retryAfter: retryAfter || null }, portalStatus);
    }
    const reported = runStatus(result.status ?? result.state ?? resultData.status ?? resultData.state);
    const run = operationRun({ request, eventId: event.id, title: displayEvent.title, kind: event.kind, mode: "live", jobId, status: reported === "unknown" ? "queued" : reported, values, targets: requestedTargets, stages: extractJobStages(result) });
    await saveOperationRun(baseEnv, run);
    await saveRunReplay(baseEnv, run.id, event, values, requestedTargets, typeof body.replayOf === "string" ? body.replayOf.slice(0, 160) : "");
    await appendAuditEvent(baseEnv, audit, { action: "xyops.run", resourceType: "xyops_run", resourceId: run.id, eventId: event.id, schemaVersion: event.schemaVersion, approvalId: internalApprovalExecutionId, runId: run.id, jobId: run.jobId, outcome: "success", metadata: { mode: "live", initialStatus: run.status, kind: event.kind, targets: requestedTargets, replayOf: typeof body.replayOf === "string" ? body.replayOf : "" } }).catch(() => {});
    return json({ mode: "live", queued: true, runId: run.id, jobId: run.jobId, status: run.status, process: { id: event.id, title: displayEvent.title, kind: event.kind } }, 202);
  } catch (error) {
    const message = error instanceof Error ? error.message : "XYOps request failed";
    const run = operationRun({ request, eventId: eventId || "unknown", title: eventId || "XYOps process", kind: "event", mode: "live", jobId: "", status: "failed", values, error: message });
    await saveOperationRun(baseEnv, run);
    await appendAuditEvent(baseEnv, audit, { action: "xyops.run", resourceType: "xyops_run", resourceId: run.id, eventId: eventId || "unknown", runId: run.id, outcome: "unknown", errorCode: auditErrorCode(error, "xyops_request_failed"), metadata: { fieldKeys: Object.keys(values).filter((key) => !/pass|secret|token|key/i.test(key)) } }).catch(() => {});
    return json({ error: message, runId: run.id }, 502);
  }
}


async function handleCatalogList(request: Request, env: RuntimeEnv, url: URL): Promise<Response> {
  const runtime = await resolveCatalogRuntime(env);
  try {
    const catalog = await portalCatalog(runtime.env, runtime.xyopsUrl);
    const access = portalAccess(request, env);
    const policyState = await readCatalogPolicySet(env);
    const sourceEvents = catalog.events.filter((event) => catalogEventAllowed(policyState.policy, access, event));
    const visibleIds = new Set(sourceEvents.map((event) => event.id));
    const changes = catalog.changes.filter((change) => visibleIds.has(change.id) || catalogEventAllowed(policyState.policy, access, { id: change.id, category: "" }));
    const presentationState = await readProcessPresentationSet(env);
    const localePreferences = presentationLocalePreferences(url.searchParams.get("locale"), request.headers.get("accept-language"));
    const resolvedLocale = resolveProcessPresentationLocale(presentationState.metadata, localePreferences);
    const availableLocales = availableProcessPresentationLocales(presentationState.metadata);
    const events = applyProcessPresentation(sourceEvents, presentationState.metadata, localePreferences);
    const response = json({ ...catalog, events, changes, policy: { source: policyState.source, filtered: sourceEvents.length !== catalog.events.length }, presentation: { source: presentationState.source, updatedAt: presentationState.updatedAt, locale: resolvedLocale, availableLocales } });
    response.headers.set("vary", "Accept-Language");
    if (resolvedLocale) response.headers.set("content-language", resolvedLocale);
    return response;
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "XYOps catalog request failed" }, 502);
  }
}

async function handleCatalogHistory(env: RuntimeEnv, url: URL): Promise<Response> {
  const limit = Number(url.searchParams.get("limit") ?? 20);
  try { return json({ persistenceAvailable: Boolean(env.DB), history: await listCatalogHistory(env, Number.isFinite(limit) ? limit : 20) }); }
  catch { return json({ persistenceAvailable: Boolean(env.DB), history: [] }); }
}

async function handleCatalogOptions(request: Request, env: RuntimeEnv, url: URL): Promise<Response> {
  const runtime = await resolveCatalogRuntime(env);
  if (!runtime.xyopsUrl || !runtime.env.XYOPS_API_KEY) return json({ error: "XYOps is not configured" }, 503);
  try {
    const catalog = await loadCatalog(runtime.env, runtime.xyopsUrl);
    const event = catalog.events.find((item) => item.id === url.searchParams.get("eventId"));
    const access = portalAccess(request, env);
    const policyState = await readCatalogPolicySet(env);
    if (!event || !catalogEventAllowed(policyState.policy, access, event)) return json({ error: "XYOps process not found" }, 404);
    const field = event.fields.find((item) => item.key === url.searchParams.get("fieldKey"));
    if (!field?.optionsSource) return json({ error: "Dynamic option source not found" }, 404);
    const endpoint = new URL(`${runtime.xyopsUrl}${field.optionsSource.endpoint}`);
    const query = String(url.searchParams.get("query") ?? "").slice(0, 200);
    if (query) endpoint.searchParams.set(field.optionsSource.queryParam ?? "query", query);
    const response = await fetch(endpoint, { headers: { "x-api-key": runtime.env.XYOPS_API_KEY, accept: "application/json" }, signal: AbortSignal.timeout(12000) });
    if (!response.ok) return json({ error: "XYOps option provider failed" }, 502);
    return json({ options: extractOptionValues(await response.json().catch(() => null)) });
  } catch (error) { return json({ error: error instanceof Error ? error.message : "Cannot load options" }, 502); }
}

async function handleCatalogRun(request: Request, env: RuntimeEnv, url: URL): Promise<Response> {
  const runtime = await resolveCatalogRuntime(env);
  return handleCatalogRunRequest(request, env, url, createAuditContext(portalAccess(request, env)), undefined, runtime);
}

async function handleLegacyIntegrationAction(request: Request, env: RuntimeEnv): Promise<Response> {
  const denied = requirePortalPermission(request, env, "xyops.run");
  if (denied) return denied;
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return json({ error: "Invalid JSON" }, 400); }
  if (typeof body.operation !== "string" || !allowedOperations.has(body.operation)) return json({ error: "Unsupported operation" }, 400);
  const runtime = await resolveCatalogRuntime(env);
  const routes = automationRoutes(runtime.env);
  const route = typeof body.routeKey === "string" ? routes.find((item) => item.key === body.routeKey) : routes.find((item) => item.operation === body.operation && item.enabled !== false);
  if (!route || route.enabled === false || route.operation !== body.operation) return json({ error: "Automation route not found" }, 400);
  const runUrl = new URL(request.url);
  runUrl.pathname = "/api/integrations/catalog/run";
  runUrl.search = "";
  const headers = new Headers(request.headers);
  headers.set("content-type", "application/json");
  return handleCatalogRunRequest(new Request(runUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ eventId: route.eventId, values: body, targets: route.targets ?? [] }),
  }), env, runUrl, createAuditContext(portalAccess(request, env)), undefined, runtime);
}

async function handleApprovalsList(request: Request, env: RuntimeEnv, url: URL): Promise<Response> {
  const denied = requirePortalPermission(request, env, "directory.read");
  if (denied) return denied;
  const access = portalAccess(request, env);
  const limit = Number(url.searchParams.get("limit") ?? 100);
  try { return json(await listApprovals(env, access, Number.isFinite(limit) ? limit : 100)); }
  catch (error) { return json({ error: error instanceof Error ? error.message : "Cannot load approvals" }, 503); }
}

async function handleApprovalAction(
  request: Request,
  env: RuntimeEnv,
  approvalId: string,
  action: ApprovalAction,
): Promise<Response> {
  const denied = requirePortalPermission(
    request,
    env,
    action === "approve" || action === "reject" ? "xyops.approve" : "xyops.run",
  );
  if (denied) return denied;

  const access = portalAccess(request, env);
  const audit = createAuditContext(access);
  let body: Record<string, unknown> = {};
  try { body = await request.json() as Record<string, unknown>; } catch {}

  try {
    if (action === "approve" || action === "reject") {
      const approval = await decideApproval(env, approvalId, access, action, String(body.comment ?? ""));
      const correlationId = await auditCorrelationFor(env, { approvalId }).catch(() => null);
      const linkedAudit = withAuditCorrelation(audit, correlationId);
      await appendAuditEvent(env, linkedAudit, {
        action: `approval.${action}`,
        resourceType: "approval",
        resourceId: approvalId,
        eventId: approval.eventId,
        schemaVersion: approval.schemaVersion,
        approvalId,
        runId: approval.runId,
        outcome: "success",
        metadata: {
          decision: action,
          commentProvided: Boolean(String(body.comment ?? "").trim()),
          approvals: approval.approvals,
          rejections: approval.rejections,
          requiredApprovals: approval.requiredApprovals,
          status: approval.status,
        },
      }).catch(() => {});
      return json({ approval });
    }

    if (action === "cancel") {
      const approval = await cancelApproval(env, approvalId, access);
      const correlationId = await auditCorrelationFor(env, { approvalId }).catch(() => null);
      await appendAuditEvent(env, withAuditCorrelation(audit, correlationId), {
        action: "approval.cancel",
        resourceType: "approval",
        resourceId: approvalId,
        eventId: approval.eventId,
        schemaVersion: approval.schemaVersion,
        approvalId,
        outcome: "success",
        metadata: { status: approval.status },
      }).catch(() => {});
      return json({ approval });
    }

    const claimed = await claimApprovalExecution(env, approvalId, access);
    const approvalCorrelation = await auditCorrelationFor(env, { approvalId }).catch(() => null);
    const executionAudit = withAuditCorrelation(audit, approvalCorrelation);
    const secretValues = body.secretValues && typeof body.secretValues === "object" && !Array.isArray(body.secretValues)
      ? body.secretValues as Record<string, unknown>
      : {};
    const allowedSecretFields = new Set(claimed.spec.secretFields);
    if (Object.keys(secretValues).some((key) => !allowedSecretFields.has(key))) {
      await finishApprovalExecution(env, approvalId, "failed", "", "Переданы неожиданные секретные поля");
      return json({ error: "Переданы неожиданные секретные поля" }, 400);
    }

    const values = { ...claimed.spec.values };
    for (const key of claimed.spec.secretFields) {
      const secret = typeof secretValues[key] === "string" ? secretValues[key] as string : "";
      if (!secret) {
        await finishApprovalExecution(env, approvalId, "failed", "", `Секретное поле ${key} не заполнено`);
        return json({ error: `Введите секретное поле: ${key}` }, 400);
      }
      values[key] = secret;
    }

    const runtime = await resolveCatalogRuntime(env);
    const catalog = await loadCatalog(runtime.env, runtime.xyopsUrl);
    const event = catalog.events.find((item) => item.id === claimed.spec.eventId && item.enabled);
    if (!event || !event.schemaVersion || event.schemaVersion !== claimed.spec.schemaVersion) {
      await finishApprovalExecution(env, approvalId, "failed", "", "Схема процесса изменилась");
      return json({ error: "Схема процесса изменилась. Создайте новую заявку." }, 409);
    }

    const visibility = await readCatalogPolicySet(env);
    if (!catalogEventAllowed(visibility.policy, access, event)) {
      await finishApprovalExecution(env, approvalId, "failed", "", "Процесс больше недоступен инициатору");
      return json({ error: "Процесс больше недоступен по политике каталога" }, 404);
    }

    const currentPolicy = await readApprovalPolicySet(env);
    const currentRequirement = approvalRequirement(currentPolicy.policy, access, event);
    if (!currentRequirement || claimed.approval.approvals < currentRequirement.requiredApprovals) {
      await finishApprovalExecution(env, approvalId, "failed", "", "Политика согласования изменилась");
      return json({ error: "Политика согласования изменилась. Создайте новую заявку." }, 409);
    }

    const runUrl = new URL(request.url);
    runUrl.pathname = "/api/integrations/catalog/run";
    runUrl.search = "";
    const headers = new Headers(request.headers);
    headers.set("content-type", "application/json");
    headers.delete("x-portal-approved-execution");
    const launchResponse = await handleCatalogRunRequest(new Request(runUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        eventId: claimed.spec.eventId,
        values,
        targets: claimed.spec.targets,
        replayOf: claimed.spec.parentRunId,
      }),
    }), env, runUrl, executionAudit, undefined, runtime, approvalId);

    const payload = await launchResponse.json().catch(() => ({})) as Record<string, unknown>;
    if (launchResponse.ok && typeof payload.runId === "string") {
      await finishApprovalExecution(env, approvalId, "executed", payload.runId);
      await appendAuditEvent(env, executionAudit, {
        action: "approval.execute",
        resourceType: "approval",
        resourceId: approvalId,
        eventId: claimed.spec.eventId,
        schemaVersion: claimed.spec.schemaVersion,
        approvalId,
        runId: payload.runId,
        jobId: String(payload.jobId ?? ""),
        outcome: "success",
        metadata: {
          status: "executed",
          secretFieldCount: claimed.spec.secretFields.length,
          parentRunId: claimed.spec.parentRunId,
        },
      }).catch(() => {});
      return json({ ...payload, approvalId, approvalExecuted: true }, launchResponse.status);
    }

    const executionOutcome = launchResponse.status >= 500 ? "unknown" : "failure";
    await finishApprovalExecution(
      env,
      approvalId,
      launchResponse.status >= 500 ? "unknown" : "failed",
      String(payload.runId ?? ""),
      String(payload.error ?? "XYOps launch failed"),
    );
    await appendAuditEvent(env, executionAudit, {
      action: "approval.execute",
      resourceType: "approval",
      resourceId: approvalId,
      eventId: claimed.spec.eventId,
      schemaVersion: claimed.spec.schemaVersion,
      approvalId,
      runId: String(payload.runId ?? ""),
      outcome: executionOutcome,
      errorCode: "xyops_launch_failed",
      metadata: { httpStatus: launchResponse.status },
    }).catch(() => {});
    return json({ ...payload, approvalId }, launchResponse.status);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Approval action failed" }, 409);
  }
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

async function handleRunAction(
  request: Request,
  env: RuntimeEnv,
  runId: string,
  action: "cancel" | "rerun",
): Promise<Response> {
  const denied = requirePortalPermission(request, env, "xyops.run");
  if (denied) return denied;

  const run = (await listOperationRuns(env, 200)).find((item) => item.id === runId);
  if (!run) return json({ error: "Запуск не найден" }, 404);
  const audit = createAuditContext(portalAccess(request, env));

  if (action === "cancel") {
    if (run.mode !== "live" || !["queued", "running", "unknown"].includes(run.status)) {
      return json({ error: "Остановить можно только активное задание XYOps" }, 409);
    }
    const runtime = await effectiveXyOpsRuntime(env);
    if (!runtime.xyopsUrl || !runtime.env.XYOPS_API_KEY) return json({ error: "XYOps is not configured" }, 503);
    if (!/^[a-z0-9_]+$/.test(run.jobId)) return json({ error: "Некорректный Job ID XYOps" }, 400);
    try {
      const response = await fetch(`${runtime.xyopsUrl}/api/app/abort_job/v1`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": runtime.env.XYOPS_API_KEY, accept: "application/json" },
        body: JSON.stringify({ id: run.jobId }),
        signal: AbortSignal.timeout(15000),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !xyopsPayloadSucceeded(payload)) return json({ error: "XYOps не подтвердил остановку задания" }, 502);
      const now = Date.now();
      run.status = "cancelled";
      run.error = `Остановлено пользователем: ${requestActor(request)}`.slice(0, 500);
      run.updatedAt = now;
      run.completedAt = now;
      await saveOperationRun(env, run);
      const runCorrelation = await auditCorrelationFor(env, { runId }).catch(() => null);
      await appendAuditEvent(env, withAuditCorrelation(audit, runCorrelation), {
        action: "xyops.run.cancel", resourceType: "xyops_run", resourceId: run.id,
        eventId: run.eventId, runId: run.id, jobId: run.jobId, outcome: "success", metadata: { status: run.status },
      }).catch(() => {});
      return json({ ok: true, action: "cancel", run: publicRun(run, undefined, undefined, true) });
    } catch {
      return json({ error: "Не удалось отправить команду остановки в XYOps" }, 502);
    }
  }

  if (["queued", "running", "unknown"].includes(run.status)) return json({ error: "Активное задание нельзя запускать повторно" }, 409);
  const replay = await readRunReplay(env, run.id);
  if (!replay?.summary.replayable || !replay.spec) return json({ error: replay?.summary.reason || "Параметры безопасного повтора недоступны" }, 409);

  let actionBody: Record<string, unknown> = {};
  try { actionBody = await request.json() as Record<string, unknown>; } catch {}
  const rerunUrl = new URL(request.url);
  rerunUrl.pathname = "/api/integrations/catalog/run";
  rerunUrl.search = "";
  const headers = new Headers(request.headers);
  headers.set("content-type", "application/json");
  const rerunRequest = new Request(rerunUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ eventId: replay.spec.eventId, values: replay.spec.values, targets: replay.spec.targets, replayOf: run.id }),
  });
  return handleCatalogRunRequest(rerunRequest, env, rerunUrl, audit, {
    expectedSchemaVersion: replay.summary.schemaVersion,
    dangerousConfirmed: actionBody.confirm === true,
    sourceRunId: run.id,
    sourceJobId: run.jobId,
    previousStatus: run.status,
  });
}

/**
 * #632 operations owner. User-facing catalog reads/execution, legacy action
 * compatibility, run history/result-file delivery, per-identity notifications,
 * cancel/rerun, approval HTTP composition and XYOps administration live here
 * after the established security and FreeIPA adapters. Approval execution reuses this catalog-run handler
 * with a server-side approval identifier.
 */
const worker = {
  async fetch(request: Request, env: RuntimeEnv | undefined, ctx: RuntimeContext): Promise<Response> {
    const sourceEnv = env ?? (process.env as unknown as RuntimeEnv);
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/api/integrations/catalog") {
      return handleCatalogList(request, sourceEnv, url);
    }
    if (request.method === "GET" && url.pathname === "/api/integrations/catalog/history") {
      return handleCatalogHistory(sourceEnv, url);
    }
    if (request.method === "GET" && url.pathname === "/api/integrations/catalog/options") {
      return handleCatalogOptions(request, sourceEnv, url);
    }
    if (request.method === "POST" && url.pathname === "/api/integrations/catalog/run") {
      return handleCatalogRun(request, sourceEnv, url);
    }
    if (request.method === "POST" && url.pathname === "/api/integrations/actions") {
      return handleLegacyIntegrationAction(request, sourceEnv);
    }
    if (request.method === "GET" && url.pathname === "/api/integrations/approvals") {
      return handleApprovalsList(request, sourceEnv, url);
    }
    const approvalActionMatch = url.pathname.match(/^\/api\/integrations\/approvals\/([A-Za-z0-9_-]{1,160})\/(approve|reject|cancel|execute)$/);
    if (request.method === "POST" && approvalActionMatch) {
      return handleApprovalAction(
        request,
        sourceEnv,
        approvalActionMatch[1],
        approvalActionMatch[2] as ApprovalAction,
      );
    }
    if (request.method === "GET" && url.pathname === "/api/integrations/notifications") {
      return handleNotificationsList(request, sourceEnv, url);
    }
    if (request.method === "POST" && url.pathname === "/api/integrations/notifications/read") {
      return handleNotificationsRead(request, sourceEnv);
    }
    const runActionMatch = url.pathname.match(/^\/api\/integrations\/runs\/([A-Za-z0-9_-]{1,160})\/(cancel|rerun)$/);
    if (request.method === "POST" && runActionMatch) {
      return handleRunAction(request, sourceEnv, runActionMatch[1], runActionMatch[2] as "cancel" | "rerun");
    }
    const runFileMatch = url.pathname.match(/^\/api\/integrations\/runs\/([A-Za-z0-9_-]{1,160})\/files\/([A-Za-z0-9_-]{1,160})$/);
    if (request.method === "GET" && runFileMatch) {
      return handleRunFile(request, sourceEnv, runFileMatch[1], runFileMatch[2]);
    }
    if (request.method === "GET" && url.pathname === "/api/integrations/runs") {
      return handleRunsList(request, sourceEnv, url);
    }
    const adminResponse = await handleXyOpsAdminRequest(request, sourceEnv);
    if (adminResponse) return adminResponse;
    const statusResponse = await handleIntegrationStatusRequest(request, sourceEnv);
    if (statusResponse) return statusResponse;
    return integrationRuntime.fetch(request, sourceEnv, ctx);
  },

  async scheduled(controller: ScheduledController, env: RuntimeEnv | undefined, ctx: RuntimeContext): Promise<void> {
    return integrationRuntime.scheduled?.(controller, env, ctx);
  },
};

export default worker;
