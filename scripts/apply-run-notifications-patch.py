from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


worker_path = Path("worker/index.ts")
worker = worker_path.read_text()
worker = replace_once(
    worker,
    'import { listRunResults, readRunResultFile, saveRunResult, type PublicRunResult } from "../run-results";\n',
    'import { listRunResults, readRunResultFile, saveRunResult, type PublicRunResult } from "../run-results";\nimport { listRunNotifications, markRunNotificationsRead, saveRunNotification } from "../run-notifications";\n',
    "worker notification import",
)
worker = replace_once(
    worker,
    '''  await env.DB.prepare("INSERT INTO operation_runs (id, job_id, event_id, title, kind, mode, status, actor, subject, error, stages_json, started_at, updated_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET job_id = excluded.job_id, status = excluded.status, error = excluded.error, stages_json = excluded.stages_json, updated_at = excluded.updated_at, completed_at = excluded.completed_at")
    .bind(run.id, run.jobId, run.eventId, run.title, run.kind, run.mode, run.status, run.actor, run.subject, run.error || null, JSON.stringify(run.stages), run.startedAt, run.updatedAt, run.completedAt).run();
}''',
    '''  await env.DB.prepare("INSERT INTO operation_runs (id, job_id, event_id, title, kind, mode, status, actor, subject, error, stages_json, started_at, updated_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET job_id = excluded.job_id, status = excluded.status, error = excluded.error, stages_json = excluded.stages_json, updated_at = excluded.updated_at, completed_at = excluded.completed_at")
    .bind(run.id, run.jobId, run.eventId, run.title, run.kind, run.mode, run.status, run.actor, run.subject, run.error || null, JSON.stringify(run.stages), run.startedAt, run.updatedAt, run.completedAt).run();
  await saveRunNotification(env, run).catch(() => {});
}''',
    "save operation notification",
)
notification_api = '''  if (request.method === "GET" && url.pathname === "/api/integrations/notifications") {
    const denied = requirePortalPermission(request, baseEnv, "directory.read");
    if (denied) return denied;
    const access = portalAccess(request, baseEnv);
    const limit = Number(url.searchParams.get("limit") ?? 50);
    try { return json(await listRunNotifications(baseEnv, access.identity, Number.isFinite(limit) ? limit : 50)); }
    catch { return json({ notifications: [], unread: 0, persistenceAvailable: Boolean(baseEnv.DB) }); }
  }

  if (request.method === "POST" && url.pathname === "/api/integrations/notifications/read") {
    const denied = requirePortalPermission(request, baseEnv, "directory.read");
    if (denied) return denied;
    let body: Record<string, unknown> = {};
    try { body = await request.json() as Record<string, unknown>; } catch { return json({ error: "Invalid JSON" }, 400); }
    const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean).slice(0, 100) : [];
    const all = body.all === true;
    if (!all && !ids.length) return json({ error: "Укажите ids или all=true" }, 400);
    const access = portalAccess(request, baseEnv);
    try {
      await markRunNotificationsRead(baseEnv, access.identity, all ? null : ids);
      return json(await listRunNotifications(baseEnv, access.identity, 50));
    } catch {
      return json({ error: "Не удалось обновить уведомления" }, 503);
    }
  }

'''
worker = replace_once(
    worker,
    '  const runFileMatch = url.pathname.match(/^\\/api\\/integrations\\/runs\\/([A-Za-z0-9_-]{1,160})\\/files\\/([A-Za-z0-9_-]{1,160})$/);\n',
    notification_api + '  const runFileMatch = url.pathname.match(/^\\/api\\/integrations\\/runs\\/([A-Za-z0-9_-]{1,160})\\/files\\/([A-Za-z0-9_-]{1,160})$/);\n',
    "notification endpoints",
)
worker_path.write_text(worker)


module_path = Path("run-notifications.ts")
module = module_path.read_text()
module = replace_once(
    module,
    '  const createdAt = Number.isFinite(run.completedAt) && Number(run.completedAt) > 0 ? Number(run.completedAt) : Date.now();',
    '  const createdAt = typeof run.completedAt === "number" && Number.isFinite(run.completedAt) && run.completedAt > 0 ? run.completedAt : Date.now();',
    "notification completed timestamp",
)
module_path.write_text(module)


page_path = Path("app/page.tsx")
page = page_path.read_text()
page = replace_once(
    page,
    'import { useCallback, useEffect, useMemo, useState } from "react";',
    'import { useCallback, useEffect, useMemo, useRef, useState } from "react";',
    "page useRef import",
)
page = replace_once(
    page,
    'type RunStats = { today: number; queued: number; success: number; failed: number };',
    'type RunStats = { today: number; queued: number; success: number; failed: number };\ntype PortalNotification = { id: string; runId: string; status: "success" | "failed" | "cancelled"; title: string; message: string; createdAt: number; readAt: number | null };',
    "notification type",
)
page = replace_once(
    page,
    '  const [directorySource, setDirectorySource] = useState<"demo" | "live" | "unconfigured">("unconfigured");\n',
    '''  const [directorySource, setDirectorySource] = useState<"demo" | "live" | "unconfigured">("unconfigured");
  const [notifications, setNotifications] = useState<PortalNotification[]>([]);
  const [notificationUnread, setNotificationUnread] = useState(0);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unsupported">("default");
  const shownNotificationIds = useRef(new Set<string>());
''',
    "notification state",
)
notification_loader = '''  const loadNotifications = useCallback(async (announce = true) => {
    try {
      const response = await fetch("/api/integrations/notifications?limit=50", { cache: "no-store" });
      if (!response.ok) throw new Error("Notification request failed");
      const data = await response.json();
      const items: PortalNotification[] = Array.isArray(data.notifications) ? data.notifications : [];
      const browserSupported = typeof window !== "undefined" && "Notification" in window;
      if (browserSupported) setNotificationPermission(window.Notification.permission);
      if (announce && browserSupported && window.Notification.permission === "granted") {
        for (const item of items) {
          if (item.readAt || shownNotificationIds.current.has(item.id)) continue;
          new window.Notification(item.title, { body: item.message, tag: item.id });
        }
      }
      for (const item of items) shownNotificationIds.current.add(item.id);
      setNotifications(items);
      setNotificationUnread(Math.max(0, Number(data.unread ?? 0)));
    } catch {
      setNotifications([]);
      setNotificationUnread(0);
    }
  }, []);

  useEffect(() => {
    if (!("Notification" in window)) setNotificationPermission("unsupported");
    const initial = window.setTimeout(() => void loadNotifications(false), 0);
    const timer = window.setInterval(() => void loadNotifications(true), 15000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, [loadNotifications]);

'''
page = replace_once(
    page,
    '  const loadRuns = useCallback(async (sync = true) => {\n',
    notification_loader + '  const loadRuns = useCallback(async (sync = true) => {\n',
    "notification loader",
)
notification_actions = '''
  async function updateNotificationReads(ids: string[] | null) {
    try {
      const response = await fetch("/api/integrations/notifications/read", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(ids ? { ids } : { all: true }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Не удалось отметить уведомления");
      setNotifications(Array.isArray(data.notifications) ? data.notifications : []);
      setNotificationUnread(Math.max(0, Number(data.unread ?? 0)));
      return true;
    } catch (error) {
      notify(error instanceof Error ? error.message : "Не удалось обновить уведомления");
      return false;
    }
  }

  async function openPortalNotification(item: PortalNotification) {
    if (!item.readAt) await updateNotificationReads([item.id]);
    setNotificationsOpen(false);
    navigateTo("operations");
  }

  async function enableSystemNotifications() {
    if (!("Notification" in window)) {
      setNotificationPermission("unsupported");
      notify("Системные уведомления не поддерживаются браузером");
      return;
    }
    const permission = await window.Notification.requestPermission();
    setNotificationPermission(permission);
    notify(permission === "granted" ? "Системные уведомления включены" : "Браузер не разрешил системные уведомления");
  }
'''
page = replace_once(
    page,
    '  return (\n    <div className="app-shell">',
    notification_actions + '\n  return (\n    <div className="app-shell">',
    "notification actions",
)
old_header = '<div className="header-actions"><label className="global-search"><span>⌕</span><input aria-label="Глобальный поиск" placeholder="Поиск процессов, пользователей, групп…" value={query} onChange={(e) => setQuery(e.target.value)} /></label><button className="bell" aria-label="Ошибки операций" onClick={() => notify(runStats.failed ? `Ошибок сегодня: ${runStats.failed}` : "Новых ошибок нет")}>♢{runStats.failed > 0 && <b>{runStats.failed}</b>}</button><button className="profile" title={`Роль: ${roleLabels[integration.access.role]}`}>{integration.viewer.slice(0, 2).toUpperCase()} <span>{integration.viewer}<small>{roleLabels[integration.access.role]}</small></span></button></div>'
new_header = '<div className="header-actions"><label className="global-search"><span>⌕</span><input aria-label="Глобальный поиск" placeholder="Поиск процессов, пользователей, групп…" value={query} onChange={(e) => setQuery(e.target.value)} /></label><div className="notification-anchor"><button className={`bell ${notificationsOpen ? "active" : ""}`} aria-label="Уведомления операций" aria-expanded={notificationsOpen} onClick={() => setNotificationsOpen((value) => !value)}>♢{notificationUnread > 0 && <b>{notificationUnread > 99 ? "99+" : notificationUnread}</b>}</button>{notificationsOpen && <NotificationCenter items={notifications} unread={notificationUnread} permission={notificationPermission} close={() => setNotificationsOpen(false)} markAll={() => void updateNotificationReads(null)} enableSystem={() => void enableSystemNotifications()} openItem={(item) => void openPortalNotification(item)} />}</div><button className="profile" title={`Роль: ${roleLabels[integration.access.role]}`}>{integration.viewer.slice(0, 2).toUpperCase()} <span>{integration.viewer}<small>{roleLabels[integration.access.role]}</small></span></button></div>'
page = replace_once(page, old_header, new_header, "notification header")
notification_component = '''
function NotificationCenter({ items, unread, permission, close, markAll, enableSystem, openItem }: { items: PortalNotification[]; unread: number; permission: NotificationPermission | "unsupported"; close: () => void; markAll: () => void; enableSystem: () => void; openItem: (item: PortalNotification) => void }) {
  return <section className="notification-panel"><div className="notification-head"><div><strong>Уведомления</strong><small>{unread ? `${unread} непрочитанных` : "Новых уведомлений нет"}</small></div><button aria-label="Закрыть уведомления" onClick={close}>×</button></div><div className="notification-tools">{unread > 0 && <button onClick={markAll}>Прочитать все</button>}{permission === "default" && <button onClick={enableSystem}>Включить системные</button>}{permission === "denied" && <small>Системные уведомления запрещены браузером</small>}</div><div className="notification-list">{items.length ? items.map((item) => <button className={`notification-item ${item.status} ${item.readAt ? "read" : "unread"}`} key={item.id} onClick={() => openItem(item)}><i>{item.status === "success" ? "✓" : item.status === "cancelled" ? "■" : "!"}</i><span><strong>{item.title}</strong><p>{item.message}</p><small>{formatDateTime(item.createdAt)}</small></span>{!item.readAt && <b />}</button>) : <div className="notification-empty"><span>♢</span><strong>Уведомлений пока нет</strong><small>Завершения и ошибки заданий XYOps появятся здесь.</small></div>}</div></section>;
}

'''
page = replace_once(page, '\nfunction Overview(', '\n' + notification_component + 'function Overview(', "notification center component")
page_path.write_text(page)


css_path = Path("app/globals.css")
css = css_path.read_text()
marker = "/* XYOPS_RUN_NOTIFICATIONS */"
if marker in css:
    raise RuntimeError("notification css already exists")
css += '''

/* XYOPS_RUN_NOTIFICATIONS */
.notification-anchor { position:relative; }
.bell.active { border-color:var(--violet); background:rgba(124,92,255,.1); }
.notification-panel { position:absolute; top:calc(100% + 12px); right:0; z-index:80; width:min(420px,calc(100vw - 28px)); max-height:min(620px,calc(100vh - 110px)); display:flex; flex-direction:column; overflow:hidden; border:1px solid var(--line); border-radius:16px; background:var(--panel); box-shadow:0 22px 60px rgba(15,23,42,.22); text-align:left; }
.notification-head { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:16px 18px 12px; border-bottom:1px solid var(--line); }
.notification-head div { display:flex; flex-direction:column; gap:3px; }
.notification-head strong { font-size:15px; }
.notification-head small,.notification-tools small { color:var(--muted); }
.notification-head>button { width:30px; height:30px; border:0; border-radius:8px; background:transparent; font-size:22px; color:var(--muted); }
.notification-tools { min-height:42px; display:flex; align-items:center; gap:8px; padding:8px 14px; border-bottom:1px solid var(--line); }
.notification-tools button { border:0; background:transparent; color:var(--violet); font-weight:700; padding:6px 4px; }
.notification-list { overflow:auto; padding:8px; }
.notification-item { width:100%; display:grid; grid-template-columns:34px 1fr 8px; gap:10px; align-items:start; padding:12px; border:0; border-radius:12px; background:transparent; color:inherit; text-align:left; }
.notification-item:hover { background:var(--soft); }
.notification-item.read { opacity:.7; }
.notification-item>i { display:grid; place-items:center; width:30px; height:30px; border-radius:10px; font-style:normal; font-weight:800; background:rgba(34,197,94,.12); color:#16a34a; }
.notification-item.failed>i { background:rgba(239,68,68,.12); color:#dc2626; }
.notification-item.cancelled>i { background:rgba(100,116,139,.14); color:#64748b; }
.notification-item>span { display:flex; flex-direction:column; gap:4px; min-width:0; }
.notification-item strong { font-size:13px; }
.notification-item p { margin:0; color:var(--text); font-size:12px; line-height:1.45; }
.notification-item small { color:var(--muted); font-size:11px; }
.notification-item>b { width:7px; height:7px; margin-top:5px; border-radius:50%; background:var(--violet); }
.notification-empty { display:flex; flex-direction:column; align-items:center; gap:6px; padding:34px 18px; text-align:center; }
.notification-empty>span { font-size:28px; color:var(--muted); }
.notification-empty small { color:var(--muted); }
@media (max-width:720px) { .notification-panel { position:fixed; top:72px; right:12px; left:12px; width:auto; max-height:calc(100vh - 92px); } }
'''
css_path.write_text(css)
