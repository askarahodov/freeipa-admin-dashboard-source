from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


# Extend the approval model with the names of secret fields (never their values).
approval_path = Path("approval-gates.ts")
approval = approval_path.read_text()
approval = replace_once(
    approval,
    'summary: { subject: string; targets: string[]; values: Array<{ key: string; label: string; value: string }>; hiddenSecrets: number };',
    'summary: { subject: string; targets: string[]; values: Array<{ key: string; label: string; value: string }>; hiddenSecrets: number; secretFields: Array<{ key: string; label: string }> };',
    "approval public secret field metadata",
)
approval = replace_once(
    approval,
    '  const secretFields: string[] = [];\n  const summaryValues: PublicApproval["summary"]["values"] = [];',
    '  const secretFields: string[] = [];\n  const secretFieldLabels: Array<{ key: string; label: string }> = [];\n  const summaryValues: PublicApproval["summary"]["values"] = [];',
    "approval secret labels",
)
approval = replace_once(
    approval,
    '      if (value !== undefined && value !== null && String(value) !== "") secretFields.push(field.key);',
    '      if (value !== undefined && value !== null && String(value) !== "") { secretFields.push(field.key); secretFieldLabels.push({ key: field.key, label: cleanText(field.label, 120) }); }',
    "approval secret field collection",
)
approval = replace_once(
    approval,
    '    summary: { subject: summaryValues[0]?.value || normalizedTargets.join(", ").slice(0, 240) || "—", targets: normalizedTargets, values: summaryValues, hiddenSecrets: secretFields.length },',
    '    summary: { subject: summaryValues[0]?.value || normalizedTargets.join(", ").slice(0, 240) || "—", targets: normalizedTargets, values: summaryValues, hiddenSecrets: secretFields.length, secretFields: secretFieldLabels },',
    "approval summary secret fields",
)
approval = replace_once(
    approval,
    '  let summary: PublicApproval["summary"] = { subject: "—", targets: [], values: [], hiddenSecrets: 0 };',
    '  let summary: PublicApproval["summary"] = { subject: "—", targets: [], values: [], hiddenSecrets: 0, secretFields: [] };',
    "approval summary fallback",
)
approval = replace_once(
    approval,
    '  const approvals = await Promise.all(items.map((row) => publicFromRow(env, row, subject, decisionMap)));\n  return {\n    approvals,',
    '  const allApprovals = await Promise.all(items.map((row) => publicFromRow(env, row, subject, decisionMap)));\n  const approvals = allApprovals.filter((item) => subject.role === "admin" || item.requesterIdentity.toLowerCase() === subject.identity.toLowerCase() || item.actions.approve || item.myDecision);\n  return {\n    approvals,',
    "approval list privacy",
)
approval_path.write_text(approval)


worker_path = Path("worker/index.ts")
worker = worker_path.read_text()
worker = replace_once(
    worker,
    'import { catalogEventAllowed, readCatalogPolicySet, saveCatalogPolicySet } from "../catalog-policies";\n',
    'import { catalogEventAllowed, readCatalogPolicySet, saveCatalogPolicySet } from "../catalog-policies";\nimport { approvalExecutionMatches, approvalRequirement, cancelApproval, claimApprovalExecution, createApprovalRequest, decideApproval, finishApprovalExecution, listApprovals, readApprovalPolicySet, readExecutingApproval, saveApprovalPolicySet } from "../approval-gates";\n',
    "worker approval import",
)
worker = replace_once(worker, '  PORTAL_CATALOG_POLICIES_JSON?: string;\n', '  PORTAL_CATALOG_POLICIES_JSON?: string;\n  PORTAL_APPROVAL_POLICIES_JSON?: string;\n', "worker approval env")
worker = replace_once(
    worker,
    'type PortalPermission = "directory.read" | "freeipa.write" | "freeipa.delete" | "xyops.run" | "settings.manage";',
    'type PortalPermission = "directory.read" | "freeipa.write" | "freeipa.delete" | "xyops.run" | "xyops.approve" | "settings.manage";',
    "approval permission type",
)
worker = replace_once(
    worker,
    '  admin: ["directory.read", "freeipa.write", "freeipa.delete", "xyops.run", "settings.manage"],',
    '  admin: ["directory.read", "freeipa.write", "freeipa.delete", "xyops.run", "xyops.approve", "settings.manage"],',
    "admin approval permission",
)
worker = replace_once(
    worker,
    '/^\\/(?:automation(?:\\/[^/]+)?|users|groups|operations|settings)\\/?$/.test(url.pathname)',
    '/^\\/(?:automation(?:\\/[^/]+)?|users|groups|operations|approvals|settings)\\/?$/.test(url.pathname)',
    "approval app route",
)

approval_api = '''  if (url.pathname === "/api/integrations/approval/policies") {
    const denied = requirePortalPermission(request, baseEnv, "settings.manage");
    if (denied) return denied;
    if (!baseEnv.ADMIN_TOKEN || !await adminAuthorized(request, baseEnv)) return json({ error: "Administrator authorization required" }, 401);
    if (request.method === "GET") {
      try { const state = await readApprovalPolicySet(baseEnv); return json({ ...state, persistenceAvailable: Boolean(baseEnv.DB) }); }
      catch (error) { return json({ error: error instanceof Error ? error.message : "Cannot load approval policies" }, 503); }
    }
    if (request.method === "PUT") {
      if (!baseEnv.DB) return json({ error: "Persistent database is unavailable" }, 503);
      try {
        const body = await request.json() as Record<string, unknown>;
        const saved = await saveApprovalPolicySet(baseEnv, body.policy);
        return json({ policy: saved.policy, source: "database", updatedAt: saved.updatedAt, persistenceAvailable: true });
      } catch (error) { return json({ error: error instanceof Error ? error.message : "Cannot save approval policies" }, 400); }
    }
    return json({ error: "Method not allowed" }, 405);
  }

  if (request.method === "GET" && url.pathname === "/api/integrations/approvals") {
    const denied = requirePortalPermission(request, baseEnv, "directory.read");
    if (denied) return denied;
    const access = portalAccess(request, baseEnv);
    const limit = Number(url.searchParams.get("limit") ?? 100);
    try { return json(await listApprovals(baseEnv, access, Number.isFinite(limit) ? limit : 100)); }
    catch (error) { return json({ error: error instanceof Error ? error.message : "Cannot load approvals" }, 503); }
  }

  const approvalActionMatch = url.pathname.match(/^\\/api\\/integrations\\/approvals\\/([A-Za-z0-9_-]{1,160})\\/(approve|reject|cancel|execute)$/);
  if (request.method === "POST" && approvalActionMatch) {
    const approvalId = approvalActionMatch[1];
    const action = approvalActionMatch[2];
    const requiredPermission: PortalPermission = action === "approve" || action === "reject" ? "xyops.approve" : "xyops.run";
    const denied = requirePortalPermission(request, baseEnv, requiredPermission);
    if (denied) return denied;
    const access = portalAccess(request, baseEnv);
    let body: Record<string, unknown> = {};
    try { body = await request.json() as Record<string, unknown>; } catch {}
    try {
      if (action === "approve" || action === "reject") {
        const approval = await decideApproval(baseEnv, approvalId, access, action, String(body.comment ?? ""));
        return json({ approval });
      }
      if (action === "cancel") return json({ approval: await cancelApproval(baseEnv, approvalId, access) });

      const claimed = await claimApprovalExecution(baseEnv, approvalId, access);
      const secretValues = body.secretValues && typeof body.secretValues === "object" && !Array.isArray(body.secretValues) ? body.secretValues as Record<string, unknown> : {};
      const allowedSecretFields = new Set(claimed.spec.secretFields);
      if (Object.keys(secretValues).some((key) => !allowedSecretFields.has(key))) {
        await finishApprovalExecution(baseEnv, approvalId, "failed", "", "Переданы неожиданные секретные поля");
        return json({ error: "Переданы неожиданные секретные поля" }, 400);
      }
      const values = { ...claimed.spec.values };
      for (const key of claimed.spec.secretFields) {
        const secret = typeof secretValues[key] === "string" ? secretValues[key] as string : "";
        if (!secret) {
          await finishApprovalExecution(baseEnv, approvalId, "failed", "", `Секретное поле ${key} не заполнено`);
          return json({ error: `Введите секретное поле: ${key}` }, 400);
        }
        values[key] = secret;
      }
      const catalog = await loadCatalog(env, xyopsUrl);
      const event = catalog.events.find((item) => item.id === claimed.spec.eventId && item.enabled);
      if (!event || !event.schemaVersion || event.schemaVersion !== claimed.spec.schemaVersion) {
        await finishApprovalExecution(baseEnv, approvalId, "failed", "", "Схема процесса изменилась");
        return json({ error: "Схема процесса изменилась. Создайте новую заявку." }, 409);
      }
      const visibility = await readCatalogPolicySet(baseEnv);
      if (!catalogEventAllowed(visibility.policy, access, event)) {
        await finishApprovalExecution(baseEnv, approvalId, "failed", "", "Процесс больше недоступен инициатору");
        return json({ error: "Процесс больше недоступен по политике каталога" }, 404);
      }
      const currentPolicy = await readApprovalPolicySet(baseEnv);
      const currentRequirement = approvalRequirement(currentPolicy.policy, access, event);
      if (!currentRequirement || claimed.approval.approvals < currentRequirement.requiredApprovals) {
        await finishApprovalExecution(baseEnv, approvalId, "failed", "", "Политика согласования изменилась");
        return json({ error: "Политика согласования изменилась. Создайте новую заявку." }, 409);
      }
      const runUrl = new URL(request.url);
      runUrl.pathname = "/api/integrations/catalog/run";
      runUrl.search = "";
      const headers = new Headers(request.headers);
      headers.set("content-type", "application/json");
      headers.set("x-portal-approved-execution", approvalId);
      const launchResponse = await handleIntegrationApi(new Request(runUrl, {
        method: "POST", headers,
        body: JSON.stringify({ eventId: claimed.spec.eventId, values, targets: claimed.spec.targets, replayOf: claimed.spec.parentRunId }),
      }), baseEnv, runUrl);
      const payload = await launchResponse.json().catch(() => ({})) as Record<string, unknown>;
      if (launchResponse.ok && typeof payload.runId === "string") {
        await finishApprovalExecution(baseEnv, approvalId, "executed", payload.runId);
        return json({ ...payload, approvalId, approvalExecuted: true }, launchResponse.status);
      }
      await finishApprovalExecution(baseEnv, approvalId, launchResponse.status >= 500 ? "unknown" : "failed", String(payload.runId ?? ""), String(payload.error ?? "XYOps launch failed"));
      return json({ ...payload, approvalId }, launchResponse.status);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Approval action failed" }, 409);
    }
  }

'''
worker = replace_once(
    worker,
    '  if (request.method === "GET" && url.pathname === "/api/integrations/notifications") {\n',
    approval_api + '  if (request.method === "GET" && url.pathname === "/api/integrations/notifications") {\n',
    "approval API block",
)

launch_line = '      const launchPayload = { id: event.id, params, input: { data: inputData }, ...(event.kind === "workflow" ? { workflowData } : {}), ...(requestedTargets.length ? { targets: requestedTargets } : event.targets.length === 1 ? { targets: event.targets } : {}) };'
launch_with_gate = launch_line + '''
      const approvalExecutionId = String(request.headers.get("x-portal-approved-execution") ?? "").slice(0, 160);
      if (approvalExecutionId) {
        const executing = await readExecutingApproval(baseEnv, approvalExecutionId, access);
        if (!executing || !await approvalExecutionMatches(executing.spec, event, values, requestedTargets)) return json({ error: "Недействительное или использованное согласование" }, 409);
      } else {
        const approvalPolicy = await readApprovalPolicySet(baseEnv);
        const requirement = approvalRequirement(approvalPolicy.policy, access, event);
        if (requirement) {
          const approval = await createApprovalRequest(baseEnv, event, access, values, requestedTargets, requirement, typeof body.replayOf === "string" ? body.replayOf : "");
          return json({ approvalRequired: true, approvalId: approval.id, status: approval.status, approval }, 202);
        }
      }'''
worker = replace_once(worker, launch_line, launch_with_gate, "catalog run approval gate")

# Route-based launches must pass through the same catalog validation and approval gate.
actions_start = worker.index('  if (request.method === "POST" && url.pathname === "/api/integrations/actions") {')
actions_end = worker.index('\n  return json({ error: "Not found" }, 404);', actions_start)
actions_block = '''  if (request.method === "POST" && url.pathname === "/api/integrations/actions") {
    const denied = requirePortalPermission(request, baseEnv, "xyops.run");
    if (denied) return denied;
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; } catch { return json({ error: "Invalid JSON" }, 400); }
    if (typeof body.operation !== "string" || !allowedOperations.has(body.operation)) return json({ error: "Unsupported operation" }, 400);
    const routes = automationRoutes(env);
    const route = typeof body.routeKey === "string" ? routes.find((item) => item.key === body.routeKey) : routes.find((item) => item.operation === body.operation && item.enabled !== false);
    if (!route || route.enabled === false || route.operation !== body.operation) return json({ error: "Automation route not found" }, 400);
    const runUrl = new URL(request.url);
    runUrl.pathname = "/api/integrations/catalog/run";
    runUrl.search = "";
    const headers = new Headers(request.headers);
    headers.set("content-type", "application/json");
    return handleIntegrationApi(new Request(runUrl, {
      method: "POST", headers,
      body: JSON.stringify({ eventId: route.eventId, values: body, targets: route.targets ?? [] }),
    }), baseEnv, runUrl);
  }
'''
worker = worker[:actions_start] + actions_block + worker[actions_end:]
worker_path.write_text(worker)


app_path = Path("app/page.tsx")
app = app_path.read_text()
app = replace_once(app, 'type Page = "overview" | "automation" | "users" | "groups" | "operations" | "settings";', 'type Page = "overview" | "automation" | "users" | "groups" | "operations" | "approvals" | "settings";', "approval page type")
app = replace_once(app, 'type PortalPermission = "directory.read" | "freeipa.write" | "freeipa.delete" | "xyops.run" | "settings.manage";', 'type PortalPermission = "directory.read" | "freeipa.write" | "freeipa.delete" | "xyops.run" | "xyops.approve" | "settings.manage";', "approval client permission")
approval_types = '''type ApprovalStatus = "pending" | "approved" | "rejected" | "cancelled" | "expired" | "executing" | "executed" | "failed" | "unknown";
type ApprovalRecord = { id: string; eventId: string; title: string; category: string; schemaVersion: string; requesterIdentity: string; requesterRole: PortalRole; status: ApprovalStatus; requiredApprovals: number; approvals: number; rejections: number; approverRoles: PortalRole[]; approverGroups: string[]; requesterCannotApprove: boolean; summary: { subject: string; targets: string[]; values: Array<{ key: string; label: string; value: string }>; hiddenSecrets: number; secretFields: Array<{ key: string; label: string }> }; expiresAt: number; createdAt: number; updatedAt: number; approvedAt: number | null; executedAt: number | null; runId: string; parentRunId: string; error: string; myDecision: "approve" | "reject" | null; actions: { approve: boolean; reject: boolean; cancel: boolean; execute: boolean } };
'''
app = replace_once(app, 'type PortalAccess = { identity: string; role: PortalRole; groups?: string[]; permissions: PortalPermission[] };\n', 'type PortalAccess = { identity: string; role: PortalRole; groups?: string[]; permissions: PortalPermission[] };\n' + approval_types, "approval client types")
app = replace_once(app, '  { id: "operations", label: "Операции", icon: "◷" },\n', '  { id: "operations", label: "Операции", icon: "◷" },\n  { id: "approvals", label: "Согласования", icon: "✓" },\n', "approval nav")
app = replace_once(app, 'const pagePaths: Record<Page, string> = { overview: "/", automation: "/automation", users: "/users", groups: "/groups", operations: "/operations", settings: "/settings" };', 'const pagePaths: Record<Page, string> = { overview: "/", automation: "/automation", users: "/users", groups: "/groups", operations: "/operations", approvals: "/approvals", settings: "/settings" };', "approval path")
app = replace_once(app, '  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unsupported">("default");\n', '  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unsupported">("default");\n  const [approvals, setApprovals] = useState<ApprovalRecord[]>([]);\n  const [approvalPendingForMe, setApprovalPendingForMe] = useState(0);\n  const [approvalsLoading, setApprovalsLoading] = useState(false);\n', "approval state")
approval_loader = '''
  const loadApprovals = useCallback(async () => {
    setApprovalsLoading(true);
    try {
      const response = await fetch("/api/integrations/approvals?limit=100", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Approval request failed");
      setApprovals(Array.isArray(data.approvals) ? data.approvals : []);
      setApprovalPendingForMe(Math.max(0, Number(data.pendingForMe ?? 0)));
    } catch {
      setApprovals([]);
      setApprovalPendingForMe(0);
    } finally { setApprovalsLoading(false); }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void loadApprovals(), 0);
    const timer = window.setInterval(() => void loadApprovals(), 15000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, [loadApprovals]);
'''
app = replace_once(app, '  const loadRuns = useCallback(async (sync = true) => {\n', approval_loader + '\n  const loadRuns = useCallback(async (sync = true) => {\n', "approval loader")
app = replace_once(app, '  const canRunXyops = integration.access.permissions.includes("xyops.run");\n', '  const canRunXyops = integration.access.permissions.includes("xyops.run");\n  const canApproveXyops = integration.access.permissions.includes("xyops.approve");\n', "approval permission flag")
app = replace_once(
    app,
    '  const visibleNav = nav.filter((item) => item.id !== "settings" || canManageSettings);',
    '  const visibleNav = nav.filter((item) => item.id !== "settings" || canManageSettings);',
    "visible nav anchor",
)
app = replace_once(
    app,
    '       if (!response.ok) throw new Error(result.error);\n       await loadRuns(false);\n       setSelectedProcess(null);\n       notify(result.mode === "live" ? `XYOps запущен: ${result.jobId}` : `Демо-задание создано: ${result.jobId}`);',
    '       if (!response.ok) throw new Error(result.error);\n       if (result.approvalRequired) { await loadApprovals(); setSelectedProcess(null); navigateTo("approvals"); notify(`Заявка на согласование создана: ${result.approvalId}`); return true; }\n       await loadRuns(false);\n       setSelectedProcess(null);\n       notify(result.mode === "live" ? `XYOps запущен: ${result.jobId}` : `Демо-задание создано: ${result.jobId}`);',
    "run process approval response",
)
app = replace_once(
    app,
    '       if (!response.ok) throw new Error(result.error || "Операция с заданием не выполнена");\n       await loadRuns(true);\n       notify(action === "cancel" ? "Команда остановки отправлена в XYOps" : `Создан новый запуск: ${result.jobId ?? "ожидает Job ID"}`);',
    '       if (!response.ok) throw new Error(result.error || "Операция с заданием не выполнена");\n       if (result.approvalRequired) { await loadApprovals(); navigateTo("approvals"); notify(`Повторный запуск ожидает согласования: ${result.approvalId}`); return true; }\n       await loadRuns(true);\n       notify(action === "cancel" ? "Команда остановки отправлена в XYOps" : `Создан новый запуск: ${result.jobId ?? "ожидает Job ID"}`);',
    "rerun approval response",
)
approval_action = '''
  async function actOnApproval(item: ApprovalRecord, action: "approve" | "reject" | "cancel" | "execute") {
    let comment = "";
    const secretValues: Record<string, string> = {};
    if (action === "reject") {
      comment = window.prompt("Причина отклонения заявки")?.trim() ?? "";
      if (!comment) return false;
    }
    if (action === "approve" && !window.confirm(`Согласовать опасную операцию «${item.title}»?`)) return false;
    if (action === "cancel" && !window.confirm(`Отменить заявку «${item.title}»?`)) return false;
    if (action === "execute") {
      if (!window.confirm(`Выполнить согласованную операцию «${item.title}» сейчас?`)) return false;
      for (const field of item.summary.secretFields ?? []) {
        const value = window.prompt(`Введите секретное поле: ${field.label}`) ?? "";
        if (!value) { notify(`Поле «${field.label}» обязательно для выполнения`); return false; }
        secretValues[field.key] = value;
      }
    }
    try {
      const response = await fetch(`/api/integrations/approvals/${encodeURIComponent(item.id)}/${action}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ comment, secretValues }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Действие с заявкой не выполнено");
      await Promise.all([loadApprovals(), loadRuns(true)]);
      notify(action === "approve" ? "Заявка согласована" : action === "reject" ? "Заявка отклонена" : action === "cancel" ? "Заявка отменена" : `XYOps запущен: ${data.jobId ?? "ожидает Job ID"}`);
      if (action === "execute") navigateTo("operations");
      return true;
    } catch (error) { notify(error instanceof Error ? error.message : "Действие с заявкой не выполнено"); return false; }
  }
'''
app = replace_once(app, '\n\n  async function updateNotificationReads(ids: string[] | null) {', '\n' + approval_action + '\n  async function updateNotificationReads(ids: string[] | null) {', "approval action handler")
app = replace_once(
    app,
    '        {page === "operations" && <Operations runs={recentRuns} stats={runStats} loading={runsLoading} refresh={() => void loadRuns(true)} onAction={runJobAction} />}\n',
    '        {page === "operations" && <Operations runs={recentRuns} stats={runStats} loading={runsLoading} refresh={() => void loadRuns(true)} onAction={runJobAction} />}\n        {page === "approvals" && <Approvals items={approvals} pendingForMe={approvalPendingForMe} loading={approvalsLoading} canApprove={canApproveXyops} refresh={() => void loadApprovals()} onAction={actOnApproval} />}\n',
    "approval page render",
)
app = replace_once(
    app,
    '<span>{item.icon}</span>{item.label}</button>',
    '<span>{item.icon}</span>{item.label}{item.id === "approvals" && approvalPendingForMe > 0 && <b className="nav-count">{approvalPendingForMe}</b>}</button>',
    "approval nav badge",
)
approvals_component = '''
function Approvals({ items, pendingForMe, loading, canApprove, refresh, onAction }: { items: ApprovalRecord[]; pendingForMe: number; loading: boolean; canApprove: boolean; refresh: () => void; onAction: (item: ApprovalRecord, action: "approve" | "reject" | "cancel" | "execute") => Promise<boolean> }) {
  const labels: Record<ApprovalStatus, string> = { pending: "Ожидает", approved: "Согласовано", rejected: "Отклонено", cancelled: "Отменено", expired: "Истекло", executing: "Запускается", executed: "Выполнено", failed: "Ошибка", unknown: "Неизвестно" };
  const tone: Record<ApprovalStatus, string> = { pending: "warning", approved: "success", rejected: "error", cancelled: "neutral", expired: "neutral", executing: "violet", executed: "success", failed: "error", unknown: "warning" };
  return <div className="approvals-page"><section className="panel approval-summary"><div><span className="eyebrow">FOUR-EYES CONTROL</span><h2>Согласования опасных процессов</h2><p>XYOps получает команду только после независимого решения и отдельного нажатия «Выполнить» инициатором.</p></div><Status tone={pendingForMe ? "warning" : "success"}>{pendingForMe ? `${pendingForMe} ждут решения` : "Очередь чиста"}</Status><button className="secondary" disabled={loading} onClick={refresh}>{loading ? "Обновление…" : "Обновить"}</button></section><div className="approval-list">{items.map((item) => <article className={`panel approval-card ${item.status}`} key={item.id}><div className="approval-card-head"><div><span className="eyebrow">{item.category} · {item.eventId}</span><h3>{item.title}</h3><p>Инициатор: <b>{item.requesterIdentity}</b> · истекает {formatDateTime(item.expiresAt)}</p></div><Status tone={tone[item.status]}>{labels[item.status]}</Status></div><div className="approval-progress"><span><b>{item.approvals}</b> / {item.requiredApprovals} согласований</span><progress max={item.requiredApprovals} value={Math.min(item.approvals, item.requiredApprovals)} /></div><div className="approval-details"><div><strong>Targets</strong><span>{item.summary.targets.length ? item.summary.targets.join(", ") : "из процесса"}</span></div><div><strong>Согласующие</strong><span>{[...item.approverRoles, ...item.approverGroups].join(", ") || "не настроены"}</span></div>{item.summary.values.map((value) => <div key={value.key}><strong>{value.label}</strong><span>{value.value}</span></div>)}{item.summary.hiddenSecrets > 0 && <div><strong>Секретные поля</strong><span>{item.summary.hiddenSecrets} · будут введены заново перед выполнением</span></div>}</div>{item.error && <div className="approval-error">{item.error}</div>}<div className="approval-actions">{item.actions.approve && canApprove && <button className="primary" onClick={() => void onAction(item, "approve")}>Одобрить</button>}{item.actions.reject && canApprove && <button className="danger-button" onClick={() => void onAction(item, "reject")}>Отклонить</button>}{item.actions.cancel && <button className="secondary" onClick={() => void onAction(item, "cancel")}>Отменить заявку</button>}{item.actions.execute && <button className="primary" onClick={() => void onAction(item, "execute")}>Выполнить в XYOps</button>}{item.myDecision && <Status tone="neutral">Моё решение: {item.myDecision === "approve" ? "одобрено" : "отклонено"}</Status>}</div></article>)}{!items.length && <div className="panel catalog-empty"><strong>Заявок пока нет</strong><span>Опасные Events и Workflows появятся здесь до фактического запуска.</span></div>}</div></div>;
}

'''
app = replace_once(app, '\nfunction NotificationCenter(', '\n' + approvals_component + 'function NotificationCenter(', "approval component")

approval_policy_editor = '''
const exampleApprovalPolicy = {
  version: 1,
  dangerousDefaults: { requiredApprovals: 1, approverRoles: ["admin"], approverGroups: [], requesterCannotApprove: true, expiresMinutes: 60, ruleId: "dangerous-default" },
  rules: [{ id: "production-two-person", effect: "require", requesterUsers: [], requesterRoles: [], requesterGroups: [], categories: ["Production"], processes: [], dangerous: null, requiredApprovals: 2, approverRoles: ["admin"], approverGroups: ["ops-leads"], requesterCannotApprove: true, expiresMinutes: 30 }],
};

function ApprovalPolicyEditor({ notify }: { notify: (message: string) => void }) {
  const [adminToken, setAdminToken] = useState(() => typeof window === "undefined" ? "" : window.sessionStorage.getItem("xyops-admin-token") ?? "");
  const [text, setText] = useState(JSON.stringify(exampleApprovalPolicy, null, 2));
  const [source, setSource] = useState<"database" | "environment" | "default" | null>(null);
  const [busy, setBusy] = useState<"load" | "save" | null>(null);
  async function request(method: "GET" | "PUT") {
    setBusy(method === "GET" ? "load" : "save");
    try {
      const body = method === "PUT" ? JSON.stringify({ policy: JSON.parse(text) }) : undefined;
      const response = await fetch("/api/integrations/approval/policies", { method, headers: { "content-type": "application/json", "x-admin-token": adminToken }, body, cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Не удалось обработать approval policy");
      window.sessionStorage.setItem("xyops-admin-token", adminToken);
      setText(JSON.stringify(data.policy, null, 2)); setSource(data.source ?? "database");
      notify(method === "GET" ? "Approval policy загружена" : "Approval policy сохранена");
    } catch (error) { notify(error instanceof Error ? error.message : "Некорректная approval policy"); }
    finally { setBusy(null); }
  }
  return <section className="panel policy-editor"><div className="panel-title"><div><span className="eyebrow">APPROVAL GATES</span><h2>Согласование опасных процессов</h2><p>Последнее подходящее правило определяет требование. По умолчанию dangerous-процесс требует одного независимого администратора.</p></div>{source && <Status tone={source === "database" ? "success" : "neutral"}>{source === "database" ? "D1" : source === "environment" ? "ENV" : "По умолчанию"}</Status>}</div><div className="policy-toolbar"><label>ADMIN_TOKEN<input type="password" value={adminToken} onChange={(event) => setAdminToken(event.target.value)} placeholder="Токен администратора" autoComplete="off" /></label><button className="secondary" disabled={!adminToken || Boolean(busy)} onClick={() => void request("GET")}>{busy === "load" ? "Загрузка…" : "Загрузить"}</button><button className="primary" disabled={!adminToken || Boolean(busy)} onClick={() => void request("PUT")}>{busy === "save" ? "Сохранение…" : "Сохранить approval policy"}</button></div><textarea className="policy-json" value={text} onChange={(event) => setText(event.target.value)} spellCheck={false} aria-label="JSON политики согласований" /><div className="policy-help"><span><code>effect: require</code> или <code>none</code></span><span>Согласующие: roles / groups</span><span>Инициатор не может одобрить свою заявку по умолчанию</span></div></section>;
}

'''
app = replace_once(app, '\nfunction Settings({ routes, catalog, catalogLoading, onSync, onRoutesChange, notify }:', '\n' + approval_policy_editor + 'function Settings({ routes, catalog, catalogLoading, onSync, onRoutesChange, notify }:', "approval policy editor")
app = replace_once(app, '    <CatalogPolicyEditor notify={notify} />\n', '    <CatalogPolicyEditor notify={notify} />\n    <ApprovalPolicyEditor notify={notify} />\n', "approval policy settings placement")
app_path.write_text(app)


css_path = Path("app/globals.css")
css = css_path.read_text()
css += '''

/* Approval gates */
.nav-count { margin-left: auto; min-width: 20px; height: 20px; padding: 0 6px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; background: var(--danger, #dc3545); color: white; font-size: 11px; }
.approvals-page { display: grid; gap: 18px; }
.approval-summary { display: flex; align-items: center; gap: 20px; padding: 24px; }
.approval-summary > div:first-child { flex: 1; }
.approval-summary h2 { margin: 4px 0 6px; }
.approval-summary p { margin: 0; opacity: .72; }
.approval-list { display: grid; gap: 14px; }
.approval-card { padding: 22px; display: grid; gap: 16px; }
.approval-card.pending { border-left: 4px solid #d89a00; }
.approval-card.approved { border-left: 4px solid #28a745; }
.approval-card.rejected, .approval-card.failed { border-left: 4px solid #dc3545; }
.approval-card-head { display: flex; justify-content: space-between; gap: 18px; align-items: flex-start; }
.approval-card-head h3 { margin: 4px 0; }
.approval-card-head p { margin: 0; opacity: .72; }
.approval-progress { display: grid; grid-template-columns: max-content 1fr; align-items: center; gap: 14px; }
.approval-progress progress { width: 100%; height: 9px; }
.approval-details { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 10px; }
.approval-details > div { padding: 12px; border: 1px solid var(--border); border-radius: 10px; display: grid; gap: 4px; }
.approval-details strong { font-size: 12px; opacity: .68; }
.approval-details span { overflow-wrap: anywhere; }
.approval-actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.approval-error { padding: 12px 14px; border-radius: 10px; background: rgba(220, 53, 69, .1); color: #b42332; }
@media (max-width: 760px) { .approval-summary, .approval-card-head { align-items: stretch; flex-direction: column; } .approval-progress { grid-template-columns: 1fr; } }
'''
css_path.write_text(css)


env_path = Path(".env.example")
env_text = env_path.read_text()
if "PORTAL_APPROVAL_POLICIES_JSON" not in env_text:
    env_text += '''

# Approval gates. Dangerous processes require one independent admin by default.
# PORTAL_APPROVAL_POLICIES_JSON={"version":1,"dangerousDefaults":{"requiredApprovals":1,"approverRoles":["admin"],"approverGroups":[],"requesterCannotApprove":true,"expiresMinutes":60,"ruleId":"dangerous-default"},"rules":[]}
'''
env_path.write_text(env_text)

roadmap_path = Path("docs/PRODUCT_ROADMAP.md")
roadmap = roadmap_path.read_text()
roadmap = replace_once(roadmap, '- [ ] Approval-гейты для опасных процессов.', '- [x] Approval-гейты для опасных процессов: независимое решение, TTL и одноразовое выполнение.', "approval roadmap")
roadmap_path.write_text(roadmap)
