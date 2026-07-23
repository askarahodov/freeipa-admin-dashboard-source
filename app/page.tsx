"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AutomationRoute as SourceAutomationRoute, CatalogEvent, RouteField } from "../automation-types";
import { conditionFieldNames, fieldConditionMatches } from "../field-conditions";

type Page = "overview" | "automation" | "users" | "groups" | "operations" | "settings";
type AutomationRoute = SourceAutomationRoute & { enabled: boolean; targets: string[]; fields: RouteField[] };
type RunStatus = "queued" | "running" | "success" | "failed" | "cancelled" | "unknown";
type RunStage = { id: string; title: string; status: RunStatus; startedAt: number | null; completedAt: number | null; error: string };
type RunResultValue = { key: string; label: string; value: string; kind: "text" | "number" | "boolean" | "json" };
type RunResultLink = { id: string; title: string; url: string; host: string };
type RunResultFile = { id: string; filename: string; size: number; mimeType: string; downloadUrl: string };
type RunResult = { available: boolean; summary: string; values: RunResultValue[]; links: RunResultLink[]; files: RunResultFile[]; table: { columns: string[]; rows: string[][] } | null; capturedAt: number; truncated: boolean };
type RunRecord = { id: string; jobId: string; eventId: string; title: string; kind: "event" | "workflow"; mode: "demo" | "live"; status: RunStatus; actor: string; subject: string; error: string | null; stages: RunStage[]; startedAt: number; updatedAt: number; completedAt: number | null; result: RunResult | null; actions: { cancel: boolean; rerun: boolean; rerunLabel: string; reason: string; parentRunId: string } };
type RunStats = { today: number; queued: number; success: number; failed: number };
type PortalNotification = { id: string; runId: string; status: "success" | "failed" | "cancelled"; title: string; message: string; createdAt: number; readAt: number | null };
type DirectoryUser = { uid: string; name: string; firstName: string; lastName: string; email: string; groups: number; groupNames: string[]; active: boolean };
type DirectoryGroup = { name: string; description: string; members: number; memberUids: string[]; type: string };
type FreeIpaOperation = "user_add" | "user_mod" | "user_password" | "user_enable" | "user_disable" | "user_del" | "group_add" | "group_del" | "group_add_member" | "group_remove_member";
type FreeIpaAction = { operation: FreeIpaOperation; title: string; preset: Record<string, string>; choices?: { users?: string[]; groups?: string[] } };
type IntegrationMode = "demo" | "live" | "cached" | "unconfigured";
type CatalogChange = { id: string; title: string; kind: "new" | "changed" | "removed" };
type CatalogMeta = { syncedAt: string | null; source: "demo" | "xyops" | "cache" | "none"; stale: boolean; changes: CatalogChange[] };
type CatalogHistoryEntry = { id: string; syncedAt: number; processCount: number; changes: CatalogChange[] };
type SettingsData = { source: "database" | "environment"; persistenceAvailable: boolean; encryptionConfigured: boolean; updatedAt: number | null; demoMode: boolean; freeipa: { url: string; username: string; passwordConfigured: boolean }; xyops: { url: string; apiKeyConfigured: boolean } };
type PortalRole = "viewer" | "operator" | "admin";
type PortalPermission = "directory.read" | "freeipa.write" | "freeipa.delete" | "xyops.run" | "settings.manage";
type PortalAccess = { identity: string; role: PortalRole; groups?: string[]; permissions: PortalPermission[] };
type CatalogPolicyRule = { id: string; effect: "allow" | "deny"; users: string[]; groups: string[]; roles: PortalRole[]; categories: string[]; processes: string[] };
type CatalogPolicySet = { version: 1; defaultEffect: "allow" | "deny"; adminBypass: boolean; rules: CatalogPolicyRule[] };
type AutomationSection = { category: string; slug: string; count: number; events: number; workflows: number };

const nav: { id: Page; label: string; icon: string }[] = [
  { id: "overview", label: "Обзор", icon: "⌂" },
  { id: "automation", label: "Автоматизация", icon: "⌘" },
  { id: "users", label: "Пользователи", icon: "♙" },
  { id: "groups", label: "Группы", icon: "♧" },
  { id: "operations", label: "Операции", icon: "◷" },
  { id: "settings", label: "Настройки", icon: "⚙" },
];
const roleLabels: Record<PortalRole, string> = { viewer: "Наблюдатель", operator: "Оператор", admin: "Администратор" };
const pagePaths: Record<Page, string> = { overview: "/", automation: "/automation", users: "/users", groups: "/groups", operations: "/operations", settings: "/settings" };

function automationSlug(value: string): string {
  const cyrillic: Record<string, string> = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya" };
  const transliterated = Array.from(value.trim().toLowerCase()).map((letter) => cyrillic[letter] ?? letter).join("");
  const slug = transliterated.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  if (slug) return slug;
  let hash = 2166136261;
  for (const letter of value) { hash ^= letter.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return `section-${(hash >>> 0).toString(36)}`;
}

const routeOperations = [
  ["user_add", "Создать пользователя"], ["user_mod", "Редактировать пользователя"], ["user_enable", "Включить пользователя"], ["user_disable", "Отключить пользователя"], ["user_del", "Удалить пользователя"],
  ["group_add", "Создать группу"], ["group_del", "Удалить группу"], ["group_add_member", "Добавить участника"], ["group_remove_member", "Удалить участника"],
] as const;

const demoUsers: DirectoryUser[] = [
  { uid: "jpetrov", name: "Петров Иван", firstName: "Иван", lastName: "Петров", email: "j.petrov@company.local", groups: 2, groupNames: ["developers", "devops"], active: true },
  { uid: "mivanova", name: "Иванова Мария", firstName: "Мария", lastName: "Иванова", email: "m.ivanova@company.local", groups: 2, groupNames: ["developers", "security"], active: true },
  { uid: "asmirnov", name: "Смирнов Алексей", firstName: "Алексей", lastName: "Смирнов", email: "a.smirnov@company.local", groups: 1, groupNames: ["security"], active: false },
  { uid: "ekuznetsova", name: "Кузнецова Елена", firstName: "Елена", lastName: "Кузнецова", email: "e.kuznetsova@company.local", groups: 1, groupNames: ["marketing"], active: true },
  { uid: "dvolkov", name: "Волков Дмитрий", firstName: "Дмитрий", lastName: "Волков", email: "d.volkov@company.local", groups: 1, groupNames: ["devops"], active: true },
];

const demoGroups: DirectoryGroup[] = [
  { name: "developers", description: "Команда разработки", members: 2, memberUids: ["jpetrov", "mivanova"], type: "POSIX" },
  { name: "devops", description: "Инфраструктура и эксплуатация", members: 2, memberUids: ["jpetrov", "dvolkov"], type: "POSIX" },
  { name: "security", description: "Информационная безопасность", members: 2, memberUids: ["mivanova", "asmirnov"], type: "POSIX" },
  { name: "marketing", description: "Отдел маркетинга", members: 1, memberUids: ["ekuznetsova"], type: "Non-POSIX" },
];

function Status({ children, tone = "success" }: { children: React.ReactNode; tone?: string }) {
  return <span className={`status ${tone}`}>{children}</span>;
}

function routeSchemaDrift(route: AutomationRoute, event: CatalogEvent | undefined) {
  if (!event) return false;
  if (route.schemaVersion && event.schemaVersion) return route.schemaVersion !== event.schemaVersion;
  return JSON.stringify({ fields: event.fields, targets: event.targets, kind: event.kind }) !== JSON.stringify({ fields: route.fields, targets: route.targets, kind: route.kind });
}

export default function Home() {
  const [page, setPage] = useState<Page>("overview");
  const [query, setQuery] = useState("");
  const [freeIpaAction, setFreeIpaAction] = useState<FreeIpaAction | null>(null);
  const [toast, setToast] = useState("");
  const [integration, setIntegration] = useState<{ mode: IntegrationMode; viewer: string; access: PortalAccess; freeipa: { reachable: boolean }; xyops: { reachable: boolean } }>({ mode: "unconfigured", viewer: "Пользователь", access: { identity: "portal-user", role: "viewer", permissions: ["directory.read"] }, freeipa: { reachable: false }, xyops: { reachable: false } });
  const [routes, setRoutes] = useState<AutomationRoute[]>([]);
  const [catalog, setCatalog] = useState<CatalogEvent[]>([]);
  const [catalogMode, setCatalogMode] = useState<IntegrationMode>("unconfigured");
  const [catalogMeta, setCatalogMeta] = useState<CatalogMeta>({ syncedAt: null, source: "none", stale: false, changes: [] });
  const [catalogError, setCatalogError] = useState("");
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [automationCategory, setAutomationCategory] = useState("all");
  const [selectedProcess, setSelectedProcess] = useState<{ event: CatalogEvent; preset: Record<string, string> } | null>(null);
  const [recentRuns, setRecentRuns] = useState<RunRecord[]>([]);
  const [runStats, setRunStats] = useState<RunStats>({ today: 0, queued: 0, success: 0, failed: 0 });
  const [runsLoading, setRunsLoading] = useState(false);
  const [directoryUsers, setDirectoryUsers] = useState<DirectoryUser[]>([]);
  const [directoryGroups, setDirectoryGroups] = useState<DirectoryGroup[]>([]);
  const [directorySource, setDirectorySource] = useState<"demo" | "live" | "unconfigured">("unconfigured");
  const [notifications, setNotifications] = useState<PortalNotification[]>([]);
  const [notificationUnread, setNotificationUnread] = useState(0);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unsupported">("default");
  const shownNotificationIds = useRef(new Set<string>());

  useEffect(() => {
    fetch("/api/integrations/status", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data) => setIntegration(data))
      .catch(() => setIntegration({ mode: "unconfigured", viewer: "Пользователь", access: { identity: "portal-user", role: "viewer", permissions: ["directory.read"] }, freeipa: { reachable: false }, xyops: { reachable: false } }));
    fetch("/api/integrations/routes", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data) => Array.isArray(data.routes) && setRoutes(data.routes))
      .catch(() => setRoutes([]));
    fetch("/api/integrations/catalog", { cache: "no-store" })
      .then(async (response) => { const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || `Ошибка каталога: HTTP ${response.status}`); return data; })
      .then((data) => { setCatalog(Array.isArray(data.events) ? data.events : []); setCatalogMode(["live", "demo", "cached"].includes(data.mode) ? data.mode : "unconfigured"); setCatalogMeta({ syncedAt: data.syncedAt ?? null, source: ["demo", "xyops", "cache"].includes(data.source) ? data.source : "none", stale: data.stale === true, changes: Array.isArray(data.changes) ? data.changes : [] }); setCatalogError(""); })
      .catch((cause) => { setCatalog([]); setCatalogMode("unconfigured"); setCatalogError(cause instanceof Error ? cause.message : "Каталог XYOps недоступен"); });
  }, []);

  const loadDirectory = useCallback(async () => {
    if (integration.mode === "demo") {
      setDirectoryUsers(demoUsers); setDirectoryGroups(demoGroups); setDirectorySource("demo");
      return;
    }
    if (!integration.freeipa.reachable) {
      setDirectoryUsers([]); setDirectoryGroups([]); setDirectorySource("unconfigured");
      return;
    }
    try {
      const [usersResponse, groupsResponse] = await Promise.all([
      fetch("/api/integrations/users", { cache: "no-store" }),
      fetch("/api/integrations/groups", { cache: "no-store" }),
      ]);
      if (!usersResponse.ok || !groupsResponse.ok) throw new Error("FreeIPA data request failed");
      const [usersPayload, groupsPayload] = await Promise.all([usersResponse.json(), groupsResponse.json()]);
      setDirectoryUsers(Array.isArray(usersPayload.users) ? usersPayload.users.map((user: DirectoryUser) => ({ ...user, groupNames: Array.isArray(user.groupNames) ? user.groupNames : [] })) : []);
      setDirectoryGroups(Array.isArray(groupsPayload.groups) ? groupsPayload.groups.map((group: DirectoryGroup) => ({ ...group, memberUids: Array.isArray(group.memberUids) ? group.memberUids : [] })) : []);
      setDirectorySource("live");
    } catch {
      setDirectoryUsers([]);
      setDirectoryGroups([]);
      setDirectorySource("unconfigured");
    }
  }, [integration.freeipa.reachable, integration.mode]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadDirectory(), 0);
    return () => window.clearTimeout(timer);
  }, [loadDirectory]);

  const loadNotifications = useCallback(async (announce = true) => {
    try {
      const response = await fetch("/api/integrations/notifications?limit=50", { cache: "no-store" });
      if (!response.ok) throw new Error("Notification request failed");
      const data = await response.json();
      const items: PortalNotification[] = Array.isArray(data.notifications) ? data.notifications : [];
      const browserSupported = typeof window !== "undefined" && "Notification" in window;
      setNotificationPermission(browserSupported ? window.Notification.permission : "unsupported");
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
    const initial = window.setTimeout(() => void loadNotifications(false), 0);
    const timer = window.setInterval(() => void loadNotifications(true), 15000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, [loadNotifications]);

  const loadRuns = useCallback(async (sync = true) => {
    setRunsLoading(true);
    try {
      const response = await fetch(`/api/integrations/runs?limit=100&sync=${sync ? "1" : "0"}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Журнал операций недоступен");
      const data = await response.json();
      setRecentRuns(Array.isArray(data.runs) ? data.runs : []);
      setRunStats(data.stats ?? { today: 0, queued: 0, success: 0, failed: 0 });
    } catch {
      setRecentRuns([]);
      setRunStats({ today: 0, queued: 0, success: 0, failed: 0 });
    } finally { setRunsLoading(false); }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void loadRuns(true), 0);
    const timer = window.setInterval(() => void loadRuns(true), 15000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, [loadRuns]);

  async function syncCatalog() {
    setCatalogLoading(true); setCatalogError("");
    try {
      const response = await fetch("/api/integrations/catalog", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Ошибка каталога: HTTP ${response.status}`);
      setCatalog(Array.isArray(data.events) ? data.events : []);
      setCatalogMode(["live", "demo", "cached"].includes(data.mode) ? data.mode : "unconfigured");
      setCatalogMeta({ syncedAt: data.syncedAt ?? null, source: ["demo", "xyops", "cache"].includes(data.source) ? data.source : "none", stale: data.stale === true, changes: Array.isArray(data.changes) ? data.changes : [] });
    } catch (cause) {
      setCatalog([]);
      setCatalogMode("unconfigured");
      const message = cause instanceof Error ? cause.message : "Не удалось синхронизировать каталог XYOps";
      setCatalogError(message);
      notify(message);
    } finally {
      setCatalogLoading(false);
    }
  }

  const canWriteFreeIpa = integration.access.permissions.includes("freeipa.write");
  const canDeleteFreeIpa = integration.access.permissions.includes("freeipa.delete");
  const canRunXyops = integration.access.permissions.includes("xyops.run");
  const canManageSettings = integration.access.permissions.includes("settings.manage");
  const visibleNav = nav.filter((item) => item.id !== "settings" || canManageSettings);
  const automationSections = useMemo<AutomationSection[]>(() => Array.from(new Set(catalog.map((event) => event.category || "general"))).sort((left, right) => left.localeCompare(right)).map((category) => {
    const items = catalog.filter((event) => (event.category || "general") === category);
    return { category, slug: automationSlug(category), count: items.length, events: items.filter((event) => event.kind === "event").length, workflows: items.filter((event) => event.kind === "workflow").length };
  }), [catalog]);
  const activeAutomationSection = automationSections.find((section) => section.category === automationCategory) ?? null;
  const title = page === "automation" && activeAutomationSection ? activeAutomationSection.category : nav.find((item) => item.id === page)?.label ?? "Обзор";
  const filteredUsers = useMemo(() => directoryUsers.filter((u) => `${u.uid} ${u.name} ${u.email}`.toLowerCase().includes(query.toLowerCase())), [directoryUsers, query]);
  const filteredGroups = useMemo(() => directoryGroups.filter((g) => `${g.name} ${g.description} ${g.type}`.toLowerCase().includes(query.toLowerCase())), [directoryGroups, query]);
  const filteredCatalog = useMemo(() => catalog.filter((event) => `${event.title} ${event.description} ${event.category} ${event.plugin ?? ""}`.toLowerCase().includes(query.toLowerCase())), [catalog, query]);

  const navigateTo = useCallback((nextPage: Page, category = "all", replace = false) => {
    const section = category === "all" ? null : automationSections.find((item) => item.category === category);
    const path = nextPage === "automation" && section ? `/automation/${section.slug}` : pagePaths[nextPage];
    setPage(nextPage);
    setAutomationCategory(nextPage === "automation" && section ? section.category : "all");
    setQuery("");
    if (window.location.pathname !== path) window.history[replace ? "replaceState" : "pushState"]({}, "", path);
  }, [automationSections]);

  useEffect(() => {
    const applyLocation = () => {
      const path = window.location.pathname.replace(/\/+$/, "") || "/";
      if (path === "/automation" || path.startsWith("/automation/")) {
        const slug = path.split("/")[2] ?? "";
        const section = automationSections.find((item) => item.slug === slug);
        setPage("automation");
        setAutomationCategory(section?.category ?? "all");
        return;
      }
      const match = (Object.entries(pagePaths) as Array<[Page, string]>).find(([, value]) => value === path);
      setPage(match?.[0] ?? "overview");
      setAutomationCategory("all");
    };
    applyLocation();
    window.addEventListener("popstate", applyLocation);
    return () => window.removeEventListener("popstate", applyLocation);
  }, [automationSections]);
  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }

  async function runFreeIpaAction(operation: FreeIpaOperation, payload: Record<string, string>) {
    try {
      const response = await fetch("/api/integrations/freeipa/actions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation, ...payload }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setFreeIpaAction(null);
      await loadDirectory();
      await loadRuns(false);
      notify(result.mode === "live" ? "Изменение применено в FreeIPA" : "Демо-операция FreeIPA выполнена");
      return true;
    } catch (error) {
      await loadRuns(false);
      notify(error instanceof Error ? error.message : "Не удалось выполнить операцию FreeIPA");
      return false;
    }
  }

  async function runProcess(event: CatalogEvent, values: Record<string, unknown>, targets: string[]) {
    try {
      const response = await fetch("/api/integrations/catalog/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ eventId: event.id, values, targets }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      await loadRuns(false);
      setSelectedProcess(null);
      notify(result.mode === "live" ? `XYOps запущен: ${result.jobId}` : `Демо-задание создано: ${result.jobId}`);
      return true;
    } catch (error) {
      await loadRuns(false);
      notify(error instanceof Error ? error.message : "Не удалось запустить процесс");
      return false;
    }
  }

  async function runJobAction(run: RunRecord, action: "cancel" | "rerun") {
    const confirmation = action === "cancel"
      ? `Остановить активное задание ${run.jobId}?`
      : `${run.actions.rerunLabel} процесс «${run.title}» с прежними проверенными параметрами?`;
    if (!window.confirm(confirmation)) return false;
    try {
      const response = await fetch(`/api/integrations/runs/${encodeURIComponent(run.id)}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Операция с заданием не выполнена");
      await loadRuns(true);
      notify(action === "cancel" ? "Команда остановки отправлена в XYOps" : `Создан новый запуск: ${result.jobId ?? "ожидает Job ID"}`);
      return true;
    } catch (error) {
      notify(error instanceof Error ? error.message : "Не удалось выполнить действие с заданием");
      return false;
    }
  }


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

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">◇</span><div><strong>FreeIPA Admin</strong><small>XYOps</small></div></div>
        <nav>{visibleNav.map((item) => <div className="nav-entry" key={item.id}><button className={page === item.id && (item.id !== "automation" || automationCategory === "all") ? "active" : ""} onClick={() => navigateTo(item.id)}><span>{item.icon}</span>{item.label}</button>{item.id === "automation" && automationSections.length > 0 && <div className="generated-nav">{automationSections.map((section) => <button key={section.category} className={page === "automation" && automationCategory === section.category ? "active" : ""} onClick={() => navigateTo("automation", section.category)} title={`${section.events} Events · ${section.workflows} Workflows`}><i /> <span>{section.category}</span><b>{section.count}</b></button>)}</div>}</div>)}</nav>
        <div className="sidebar-bottom"><div className="system-ok"><i className={integration.freeipa.reachable ? "" : "warning"} /> <div><strong>{integration.freeipa.reachable ? "FreeIPA готов" : "Требуется настройка"}</strong><small>{integration.xyops.reachable ? "XYOps также подключён" : "XYOps подключается отдельно"}</small></div></div><p>© 2026 Admin Portal</p></div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div><h1>{page === "overview" ? "Обзор инфраструктуры" : title}</h1><p>{page === "overview" ? "FreeIPA и портал автоматизаций XYOps" : `Управление разделом «${title}»`}</p></div>
          <div className="header-actions"><label className="global-search"><span>⌕</span><input aria-label="Глобальный поиск" placeholder="Поиск процессов, пользователей, групп…" value={query} onChange={(e) => setQuery(e.target.value)} /></label><div className="notification-anchor"><button className={`bell ${notificationsOpen ? "active" : ""}`} aria-label="Уведомления операций" aria-expanded={notificationsOpen} onClick={() => setNotificationsOpen((value) => !value)}>♢{notificationUnread > 0 && <b>{notificationUnread > 99 ? "99+" : notificationUnread}</b>}</button>{notificationsOpen && <NotificationCenter items={notifications} unread={notificationUnread} permission={notificationPermission} close={() => setNotificationsOpen(false)} markAll={() => void updateNotificationReads(null)} enableSystem={() => void enableSystemNotifications()} openItem={(item) => void openPortalNotification(item)} />}</div><button className="profile" title={`Роль: ${roleLabels[integration.access.role]}`}>{integration.viewer.slice(0, 2).toUpperCase()} <span>{integration.viewer}<small>{roleLabels[integration.access.role]}</small></span></button></div>
        </header>

        {page === "overview" && <Overview goTo={(nextPage) => navigateTo(nextPage)} integration={integration} userCount={directoryUsers.length} groupCount={directoryGroups.length} directorySource={directorySource} runs={recentRuns} runStats={runStats} />}
        {page === "automation" && <AutomationCatalog items={filteredCatalog} sections={automationSections} selectedCategory={automationCategory} mode={catalogMode} meta={catalogMeta} error={catalogError} loading={catalogLoading} recentRuns={recentRuns} canRun={canRunXyops} canManageSettings={canManageSettings} onCategoryChange={(category) => navigateTo("automation", category)} onSync={() => void syncCatalog()} onOpenSettings={() => navigateTo("settings")} onLaunch={(event) => setSelectedProcess({ event, preset: {} })} />}
        {page === "users" && <Users items={filteredUsers} allGroups={directoryGroups} total={directoryUsers.length} source={directorySource} canWrite={canWriteFreeIpa} canDelete={canDeleteFreeIpa} onCreate={() => setFreeIpaAction({ operation: "user_add", title: "Новый пользователь", preset: {} })} onAction={setFreeIpaAction} />}
        {page === "groups" && <Groups items={filteredGroups} allUsers={directoryUsers} source={directorySource} canWrite={canWriteFreeIpa} canDelete={canDeleteFreeIpa} onCreate={() => setFreeIpaAction({ operation: "group_add", title: "Новая группа", preset: {} })} onAction={setFreeIpaAction} />}
        {page === "operations" && <Operations runs={recentRuns} stats={runStats} loading={runsLoading} refresh={() => void loadRuns(true)} onAction={runJobAction} />}
        {page === "settings" && canManageSettings && <Settings routes={routes} catalog={catalog} catalogLoading={catalogLoading} onSync={() => void syncCatalog()} onRoutesChange={setRoutes} notify={notify} />}
      </main>

      {freeIpaAction && <FreeIpaActionModal action={freeIpaAction} close={() => setFreeIpaAction(null)} submit={runFreeIpaAction} />}
      {selectedProcess && <ProcessModal event={selectedProcess.event} preset={selectedProcess.preset} close={() => setSelectedProcess(null)} submit={(values, targets) => runProcess(selectedProcess.event, values, targets)} />}
      {toast && <div className="toast"><i />{toast}</div>}
    </div>
  );
}


function NotificationCenter({ items, unread, permission, close, markAll, enableSystem, openItem }: { items: PortalNotification[]; unread: number; permission: NotificationPermission | "unsupported"; close: () => void; markAll: () => void; enableSystem: () => void; openItem: (item: PortalNotification) => void }) {
  return <section className="notification-panel"><div className="notification-head"><div><strong>Уведомления</strong><small>{unread ? `${unread} непрочитанных` : "Новых уведомлений нет"}</small></div><button aria-label="Закрыть уведомления" onClick={close}>×</button></div><div className="notification-tools">{unread > 0 && <button onClick={markAll}>Прочитать все</button>}{permission === "default" && <button onClick={enableSystem}>Включить системные</button>}{permission === "denied" && <small>Системные уведомления запрещены браузером</small>}</div><div className="notification-list">{items.length ? items.map((item) => <button className={`notification-item ${item.status} ${item.readAt ? "read" : "unread"}`} key={item.id} onClick={() => openItem(item)}><i>{item.status === "success" ? "✓" : item.status === "cancelled" ? "■" : "!"}</i><span><strong>{item.title}</strong><p>{item.message}</p><small>{formatDateTime(item.createdAt)}</small></span>{!item.readAt && <b />}</button>) : <div className="notification-empty"><span>♢</span><strong>Уведомлений пока нет</strong><small>Завершения и ошибки заданий XYOps появятся здесь.</small></div>}</div></section>;
}

function Overview({ goTo, integration, userCount, groupCount, directorySource, runs, runStats }: { goTo: (page: Page) => void; integration: { mode: IntegrationMode; freeipa: { reachable: boolean }; xyops: { reachable: boolean } }; userCount: number; groupCount: number; directorySource: "demo" | "live" | "unconfigured"; runs: RunRecord[]; runStats: RunStats }) {
  return <div className="content-stack">
    <section className="metrics">
      <Metric icon="♙" label="Пользователи" value={userCount.toLocaleString("ru-RU")} delta={directorySource === "live" ? "FreeIPA" : directorySource === "demo" ? "Демо" : "Не настроено"} color="violet" />
      <Metric icon="♣" label="Группы" value={groupCount.toLocaleString("ru-RU")} delta={directorySource === "live" ? "FreeIPA" : directorySource === "demo" ? "Демо" : "Не настроено"} color="blue" />
      <Metric icon="⌁" label="Активные операции" value={String(runStats.queued)} delta="сегодня" color="teal" />
      <Metric icon="△" label="Ошибки сегодня" value={String(runStats.failed)} delta="общий журнал" color="red" />
    </section>
    <section className="panel connections"><h2>Состояние подключения</h2><div className="connection-grid">
      <div className="service"><span className="service-icon teal">▤</span><div><h3><i className={`dot ${integration.freeipa.reachable ? "green" : "amber"}`} />FreeIPA {integration.freeipa.reachable ? "подключён" : integration.mode === "demo" ? "демо-режим" : "не настроен"}</h3><small>Источник данных</small><strong>{integration.freeipa.reachable ? "Сохранённая конфигурация" : integration.mode === "demo" ? "Демонстрационные данные" : "Требуется настройка"}</strong></div></div>
      <div className="pulse"><span><i className={`dot ${integration.freeipa.reachable ? "teal-dot" : "amber"}`} /> {integration.freeipa.reachable ? "LIVE" : integration.mode === "demo" ? "DEMO" : "OFF"}</span><b>⌁⌁⌁⌁</b><small>Проверено автоматически</small></div>
      <div className="service"><span className="service-icon violet">⚙</span><div><h3><i className={`dot ${integration.xyops.reachable ? "violet-dot" : "amber"}`} />XYOps {integration.xyops.reachable ? "подключён" : integration.mode === "demo" ? "демо-режим" : "не настроен"}</h3><small>Дополнительная автоматизация</small><strong>{integration.xyops.reachable ? "Events и Workflows доступны" : integration.mode === "demo" ? "Без внешних изменений" : "Не влияет на FreeIPA"}</strong></div></div>
      <div className="pulse purple"><span><i className={`dot ${integration.xyops.reachable ? "violet-dot" : "amber"}`} /> {integration.xyops.reachable ? "LIVE" : integration.mode === "demo" ? "DEMO" : "OFF"}</span><b>⌁⌁⌁⌁</b><small>Проверено автоматически</small></div>
    </div></section>
    <section className="panel table-panel"><div className="panel-title"><h2>Последние операции</h2><button onClick={() => goTo("operations")}>Смотреть все операции →</button></div><OperationTable rows={runs.slice(0, 4)} /></section>
  </div>;
}

function Metric({ icon, label, value, delta, color }: { icon: string; label: string; value: string; delta: string; color: string }) {
  return <article className="metric"><div className={`metric-icon ${color}`}>{icon}</div><div><span>{label}</span><strong>{value}</strong></div><small className={color === "red" ? "down" : "up"}>{delta} <em>{color === "red" ? "по сравнению со вчера" : "за 7 дней"}</em></small></article>;
}

function Users({ items, allGroups, total, source, canWrite, canDelete, onCreate, onAction }: { items: DirectoryUser[]; allGroups: DirectoryGroup[]; total: number; source: "demo" | "live" | "unconfigured"; canWrite: boolean; canDelete: boolean; onCreate: () => void; onAction: (action: FreeIpaAction) => void }) {
  const [filter, setFilter] = useState<"all" | "active" | "disabled">("all");
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const visible = items.filter((user) => filter === "all" || (filter === "active" ? user.active : !user.active));
  const selected = items.find((user) => user.uid === selectedUid) ?? null;
  return <><section className="panel table-panel section-page"><div className="panel-title"><div><h2>Пользователи FreeIPA</h2><p>{`${visible.length} из ${total} учетных записей · ${source === "live" ? "прямое подключение FreeIPA" : source === "demo" ? "демо-данные" : "FreeIPA не настроен"}`}</p></div>{canWrite && <button className="primary" disabled={source === "unconfigured"} onClick={onCreate}>＋ Создать пользователя</button>}</div><div className="filter-row"><button className={`filter ${filter === "all" ? "active-filter" : ""}`} onClick={() => setFilter("all")}>Все</button><button className={`filter ${filter === "active" ? "active-filter" : ""}`} onClick={() => setFilter("active")}>Активные</button><button className={`filter ${filter === "disabled" ? "active-filter" : ""}`} onClick={() => setFilter("disabled")}>Отключённые</button>{!canWrite && <Status tone="neutral">Только просмотр</Status>}</div><div className="data-table"><div className="tr th users-row"><span>Пользователь</span><span>Логин</span><span>Группы</span><span>Статус</span><span>Действия</span></div>{visible.map((u) => <div className="tr users-row" key={u.uid}><span className="person"><b>{u.name.split(" ").map(x => x[0]).join("")}</b><span><strong>{u.name}</strong><small>{u.email}</small></span></span><span className="mono">{u.uid}</span><span>{u.groups}</span><span><Status tone={u.active ? "success" : "neutral"}>{u.active ? "Активен" : "Отключён"}</Status></span><span className="row-actions"><button onClick={() => setSelectedUid(u.uid)}>Карточка</button>{canWrite && <button onClick={() => onAction({ operation: "user_mod", title: `Редактировать ${u.uid}`, preset: { username: u.uid, firstName: u.firstName, lastName: u.lastName, email: u.email } })}>Редактировать</button>}</span></div>)}</div>{source === "unconfigured" && <div className="catalog-empty"><strong>FreeIPA не настроен</strong><span>Сохраните подключение в разделе «Настройки».</span></div>}</section>{selected && <UserDetails user={selected} groups={allGroups} canWrite={canWrite} canDelete={canDelete} close={() => setSelectedUid(null)} action={onAction} />}</>;
}

function Groups({ items, allUsers, source, canWrite, canDelete, onCreate, onAction }: { items: DirectoryGroup[]; allUsers: DirectoryUser[]; source: "demo" | "live" | "unconfigured"; canWrite: boolean; canDelete: boolean; onCreate: () => void; onAction: (action: FreeIpaAction) => void }) {
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const selected = items.find((group) => group.name === selectedName) ?? null;
  return <><div className="content-stack"><div className="page-tools"><div><h2>Группы доступа</h2><p>{`${items.length} групп · ${source === "live" ? "прямое подключение FreeIPA" : source === "demo" ? "демо-данные" : "FreeIPA не настроен"}`}</p></div>{canWrite ? <button className="primary" disabled={source === "unconfigured"} onClick={onCreate}>＋ Создать группу</button> : <Status tone="neutral">Только просмотр</Status>}</div>{source === "unconfigured" ? <section className="panel catalog-empty"><strong>FreeIPA не настроен</strong><span>Сохраните подключение в разделе «Настройки».</span></section> : <section className="group-grid">{items.map((g, i) => <article className="group-card" key={g.name}><div className={`group-avatar c${i % 4}`}>♣</div><h3>{g.name}</h3><p>{g.description}</p><div><span><strong>{g.members}</strong><small>участников</small></span><Status tone="violet">{g.type}</Status></div><div className="group-actions"><button onClick={() => setSelectedName(g.name)}>Открыть группу</button>{canWrite && <button onClick={() => onAction({ operation: "group_add_member", title: `Добавить участника в ${g.name}`, preset: { group: g.name }, choices: { users: allUsers.filter((user) => !g.memberUids.includes(user.uid)).map((user) => user.uid) } })}>＋ Участник</button>}</div></article>)}</section>}</div>{selected && <GroupDetails group={selected} users={allUsers} canWrite={canWrite} canDelete={canDelete} close={() => setSelectedName(null)} action={onAction} />}</>;
}

function UserDetails({ user, groups, canWrite, canDelete, close, action }: { user: DirectoryUser; groups: DirectoryGroup[]; canWrite: boolean; canDelete: boolean; close: () => void; action: (action: FreeIpaAction) => void }) {
  const availableGroups = groups.filter((group) => !user.groupNames.includes(group.name)).map((group) => group.name);
  return <div className="modal-backdrop"><section className="modal identity-modal"><button className="modal-x" onClick={close}>×</button><div className="identity-head"><span>{user.name.split(" ").map((part) => part[0]).join("")}</span><div><small>ПОЛЬЗОВАТЕЛЬ FREEIPA</small><h2>{user.name}</h2><code>{user.uid}</code></div><Status tone={user.active ? "success" : "neutral"}>{user.active ? "Активен" : "Отключён"}</Status></div><div className="identity-facts"><span><small>Email</small><strong>{user.email || "Не указан"}</strong></span><span><small>Группы</small><strong>{user.groups}</strong></span></div><div className="membership-head"><div><h3>Членство в группах</h3><p>{canWrite ? "Изменения применяются напрямую в FreeIPA." : "Доступно только для просмотра."}</p></div>{canWrite && <button className="secondary" disabled={!availableGroups.length} onClick={() => action({ operation: "group_add_member", title: `Добавить ${user.uid} в группу`, preset: { username: user.uid }, choices: { groups: availableGroups } })}>＋ Добавить группу</button>}</div><div className="membership-list">{user.groupNames.map((group) => <span key={group}><b>{group}</b>{canWrite && <button aria-label={`Удалить ${user.uid} из ${group}`} onClick={() => action({ operation: "group_remove_member", title: `Удалить ${user.uid} из ${group}`, preset: { username: user.uid, group } })}>×</button>}</span>)}{!user.groupNames.length && <p>Пользователь не входит в группы.</p>}</div><div className="identity-actions">{canWrite && <><button className="secondary" onClick={() => action({ operation: "user_mod", title: `Редактировать ${user.uid}`, preset: { username: user.uid, firstName: user.firstName, lastName: user.lastName, email: user.email } })}>Редактировать</button><button className="secondary" onClick={() => action({ operation: "user_password", title: `Сбросить пароль ${user.uid}`, preset: { username: user.uid } })}>Сбросить пароль</button><button className="secondary" onClick={() => action({ operation: user.active ? "user_disable" : "user_enable", title: `${user.active ? "Отключить" : "Включить"} ${user.uid}`, preset: { username: user.uid } })}>{user.active ? "Отключить" : "Включить"}</button></>}{canDelete && <button className="danger-button" onClick={() => action({ operation: "user_del", title: `Удалить ${user.uid}`, preset: { username: user.uid } })}>Удалить</button>}<button className="secondary" onClick={close}>Закрыть</button></div></section></div>;
}

function GroupDetails({ group, users, canWrite, canDelete, close, action }: { group: DirectoryGroup; users: DirectoryUser[]; canWrite: boolean; canDelete: boolean; close: () => void; action: (action: FreeIpaAction) => void }) {
  const availableUsers = users.filter((user) => !group.memberUids.includes(user.uid)).map((user) => user.uid);
  return <div className="modal-backdrop"><section className="modal identity-modal"><button className="modal-x" onClick={close}>×</button><div className="identity-head"><span>♣</span><div><small>ГРУППА FREEIPA</small><h2>{group.name}</h2><p>{group.description}</p></div><Status tone="violet">{group.type}</Status></div><div className="membership-head"><div><h3>Участники</h3><p>{group.members} пользователей в группе.</p></div>{canWrite && <button className="primary" disabled={!availableUsers.length} onClick={() => action({ operation: "group_add_member", title: `Добавить участника в ${group.name}`, preset: { group: group.name }, choices: { users: availableUsers } })}>＋ Добавить</button>}</div><div className="member-table">{group.memberUids.map((uid) => { const user = users.find((item) => item.uid === uid); return <div key={uid}><span className="person"><b>{(user?.name || uid).split(" ").map((part) => part[0]).join("")}</b><span><strong>{user?.name || uid}</strong><small>{user?.email || uid}</small></span></span><Status tone={user?.active === false ? "neutral" : "success"}>{user?.active === false ? "Отключён" : "Активен"}</Status>{canWrite && <button className="danger-link" onClick={() => action({ operation: "group_remove_member", title: `Удалить ${uid} из ${group.name}`, preset: { group: group.name, username: uid } })}>Удалить</button>}</div>; })}{!group.memberUids.length && <p>В группе пока нет участников.</p>}</div><div className="identity-actions">{canDelete && <button className="danger-button" onClick={() => action({ operation: "group_del", title: `Удалить группу ${group.name}`, preset: { group: group.name } })}>Удалить группу</button>}<button className="secondary" onClick={close}>Закрыть</button></div></section></div>;
}

function AutomationCatalog({ items, sections, selectedCategory, mode, meta, error, loading, recentRuns, canRun, canManageSettings, onCategoryChange, onSync, onOpenSettings, onLaunch }: { items: CatalogEvent[]; sections: AutomationSection[]; selectedCategory: string; mode: IntegrationMode; meta: CatalogMeta; error: string; loading: boolean; recentRuns: RunRecord[]; canRun: boolean; canManageSettings: boolean; onCategoryChange: (category: string) => void; onSync: () => void; onOpenSettings: () => void; onLaunch: (event: CatalogEvent) => void }) {
  const categories = sections.length;
  const visibleItems = selectedCategory === "all" ? items : items.filter((event) => event.category === selectedCategory);
  const activeSection = sections.find((section) => section.category === selectedCategory) ?? null;
  const changeMap = new Map(meta.changes.map((change) => [change.id, change.kind]));
  return <div className="content-stack automation-page">
    <section className="automation-hero"><div><span className="eyebrow">XYOPS AUTOMATION PORTAL</span><h2>{activeSection ? activeSection.category : "Портал автоматизаций"}</h2><p>{activeSection ? `Автоматически созданный раздел: ${activeSection.events} Events и ${activeSection.workflows} Workflows. Поля форм и правила запуска получены из XYOps.` : "Разделы, маршруты, карточки и формы создаются из метаданных Events и Workflows. XYOps остаётся оркестратором, а портал предоставляет пользовательский интерфейс и визуализацию."}</p>{activeSection && <code className="generated-route">/automation/{activeSection.slug}</code>}</div><div>{!canRun && <Status tone="neutral">Только просмотр</Status>}<button className="secondary" disabled={loading} onClick={onSync}>{loading ? "Синхронизация…" : "⟳ Обновить каталог"}</button></div></section>
    <section className={`catalog-sync ${meta.stale || error ? "stale" : ""}`}><span className={`source-dot ${mode}`} /><div><strong>{error ? "Ошибка загрузки каталога XYOps" : meta.source === "xyops" ? "Каталог синхронизирован с XYOps" : meta.source === "cache" ? "Показан сохранённый снимок" : meta.source === "demo" ? "Демонстрационный каталог" : "XYOps не настроен"}</strong><small>{error || (meta.syncedAt ? `Последняя успешная синхронизация: ${new Date(meta.syncedAt).toLocaleString("ru-RU")}` : "Снимок каталога ещё не создан")}</small></div>{meta.changes.length > 0 && <Status tone="violet">{meta.changes.filter((change) => change.kind === "new").length} новых · {meta.changes.filter((change) => change.kind === "changed").length} изменено · {meta.changes.filter((change) => change.kind === "removed").length} удалено</Status>}{(meta.stale || error) && <Status tone="warning">Требуется проверка</Status>}</section>
    <section className="catalog-summary"><article><span>⌘</span><div><strong>{items.length}</strong><small>доступных процессов</small></div></article><article><span>▦</span><div><strong>{categories}</strong><small>категорий</small></div></article><article><span>◇</span><div><strong>{items.reduce((sum, event) => sum + event.fields.length, 0)}</strong><small>динамических полей</small></div></article><article><span className={`source-dot ${mode}`} /><div><strong>{mode === "live" ? "LIVE" : mode === "cached" ? "CACHE" : mode === "demo" ? "DEMO" : "OFF"}</strong><small>источник каталога</small></div></article></section>
    <div className="category-tabs"><button className={selectedCategory === "all" ? "active" : ""} onClick={() => onCategoryChange("all")}>Все процессы <b>{items.length}</b></button>{sections.map((section) => <button className={selectedCategory === section.category ? "active" : ""} onClick={() => onCategoryChange(section.category)} key={section.category}>{section.category} <b>{section.count}</b></button>)}</div>
    <div className="automation-layout"><section className="process-grid">{visibleItems.map((event) => <article className="process-card" key={event.id}><div className="process-top"><span className={`route-kind ${event.kind}`}>{event.kind === "workflow" ? "⌘" : "▶"}</span><div>{changeMap.get(event.id) && <Status tone="warning">{changeMap.get(event.id) === "new" ? "Новый" : "Схема изменена"}</Status>}<Status tone={event.kind === "workflow" ? "violet" : "success"}>{event.kind === "workflow" ? "Workflow" : "Event"}</Status>{event.dangerous && <Status tone="warning">Подтверждение</Status>}</div></div><small className="process-category">{event.category}{event.plugin ? ` · ${event.plugin}` : ""}</small><h3>{event.title}</h3><p>{event.description || "Описание будет загружено из XYOps."}</p><div className="process-meta"><span>{event.fields.length} полей</span><span>{event.targets.length ? `${event.targets.length} targets` : "Targets из XYOps"}</span></div><button className="primary" disabled={!event.enabled || mode === "cached" || !canRun} onClick={() => onLaunch(event)}>{!canRun ? "Недостаточно прав" : mode === "cached" ? "Ожидается подключение XYOps" : "Сформировать и запустить →"}</button></article>)}</section><aside className="runs-panel panel"><div><h3>Последние запуски</h3><small>Постоянный журнал D1</small></div>{recentRuns.length ? recentRuns.slice(0, 6).map((run) => <article key={run.id}><i className={run.status} /><div><strong>{run.title}</strong><small>{formatDateTime(run.startedAt)} · {run.kind}</small><code>{run.jobId}</code></div><RunStatusBadge status={run.status} /></article>) : <div className="runs-empty"><span>◷</span><strong>Запусков пока нет</strong><small>Выберите процесс из каталога</small></div>}</aside></div>
    {!loading && !items.length && <section className="panel catalog-empty"><strong>{error ? "Каталог не загружен" : "Процессы не найдены"}</strong><span>{error || "XYOps вернул пустой каталог либо текущий поиск не нашёл процессов."}</span><div className="empty-actions">{canManageSettings && <button className="secondary" onClick={onOpenSettings}>Открыть настройки</button>}<button className="primary" onClick={onSync}>Повторить синхронизацию</button></div></section>}
  </div>;
}

function Operations({ runs, stats, loading, refresh, onAction }: { runs: RunRecord[]; stats: RunStats; loading: boolean; refresh: () => void; onAction: (run: RunRecord, action: "cancel" | "rerun") => Promise<boolean> }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = runs.find((run) => run.id === selectedId) ?? null;
  return <div className="content-stack"><section className="panel table-panel section-page"><div className="panel-title"><div><h2>Журнал операций</h2><p>Прямые изменения FreeIPA и запуски автоматизаций XYOps</p></div><button className="secondary" disabled={loading} onClick={refresh}>{loading ? "Обновление…" : "⟳ Обновить"}</button></div><div className="stats-strip"><span><b>{stats.today}</b> операций сегодня</span><span><i className="dot green" /><b>{stats.success}</b> успешно</span><span><i className="dot amber" /><b>{stats.queued}</b> выполняются</span><span><i className="dot red-dot" /><b>{stats.failed}</b> ошибки</span></div><OperationTable rows={runs} detailed onSelect={(run) => setSelectedId(run.id)} /></section>{selected && <RunDetails run={selected} close={() => setSelectedId(null)} onAction={onAction} />}</div>;
}

function RunDetails({ run, close, onAction }: { run: RunRecord; close: () => void; onAction: (run: RunRecord, action: "cancel" | "rerun") => Promise<boolean> }) {
  const [busy, setBusy] = useState<"cancel" | "rerun" | null>(null);
  const act = async (action: "cancel" | "rerun") => { setBusy(action); if (await onAction(run, action)) close(); else setBusy(null); };
  return <div className="modal-backdrop"><section className="modal run-details-modal"><button className="modal-x" onClick={close}>×</button><div className="run-detail-head"><div><span className="eyebrow">XYOPS {run.kind.toUpperCase()}</span><h2>{run.title}</h2><p>{run.subject} · {run.actor}</p></div><RunStatusBadge status={run.status} /></div><div className="run-facts"><span><small>Job ID</small><code>{run.jobId}</code></span><span><small>Запущено</small><strong>{formatDateTime(run.startedAt)}</strong></span><span><small>Обновлено</small><strong>{formatDateTime(run.updatedAt)}</strong></span></div>{run.stages?.length ? <div className="workflow-timeline">{run.stages.map((stage, index) => <article key={stage.id}><div className="timeline-marker"><i className={stage.status}>{stage.status === "success" ? "✓" : stage.status === "failed" || stage.status === "cancelled" ? "!" : index + 1}</i>{index < run.stages.length - 1 && <span />}</div><div><strong>{stage.title}</strong><small>{stage.startedAt ? formatDateTime(stage.startedAt) : "Ожидает данных времени"}{stage.completedAt ? ` → ${formatDateTime(stage.completedAt)}` : ""}</small>{stage.error && <p>{stage.error}</p>}</div><RunStatusBadge status={stage.status} /></article>)}</div> : <div className="catalog-empty"><strong>XYOps не вернул этапы Workflow</strong><span>Отображается общий статус задания. Этапы появятся, если `get_active_jobs` содержит `stages`, `steps`, `tasks` или `nodes`.</span></div>}<RunResultWidgets result={run.result} />{run.error && <div className="settings-error"><strong>{run.status === "cancelled" ? "Остановка" : "Ошибка"}</strong><span>{run.error}</span></div>}{!run.actions.rerun && run.actions.reason && <div className="settings-error"><strong>Повтор недоступен</strong><span>{run.actions.reason}</span></div>}<div className="modal-actions"><button className="secondary" onClick={close}>Закрыть</button>{run.actions.rerun && <button className="primary" disabled={Boolean(busy)} onClick={() => void act("rerun")}>{busy === "rerun" ? "Запуск…" : run.actions.rerunLabel}</button>}{run.actions.cancel && <button className="danger-button" disabled={Boolean(busy)} onClick={() => void act("cancel")}>{busy === "cancel" ? "Остановка…" : "Остановить задание"}</button>}</div></section></div>;
}

function RunResultWidgets({ result }: { result: RunResult | null }) {
  if (!result?.available) return null;
  return <section className="run-results"><div className="run-results-head"><div><span className="eyebrow">РЕЗУЛЬТАТ XYOPS</span><h3>Выходные данные задания</h3></div><small>Получено {formatDateTime(result.capturedAt)}</small></div>{result.summary && <div className="run-result-summary"><strong>Итог</strong><p>{result.summary}</p></div>}{result.values.length > 0 && <div className="run-result-values">{result.values.map((item) => <article key={item.key}><small>{item.label}</small><strong>{item.value}</strong></article>)}</div>}{result.table && <div className="run-result-table-wrap"><table className="run-result-table"><thead><tr>{result.table.columns.map((column, index) => <th key={`${column}-${index}`}>{column}</th>)}</tr></thead><tbody>{result.table.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div>}{result.links.length > 0 && <div className="run-result-links"><strong>Ссылки</strong>{result.links.map((link) => <a key={link.id} href={link.url} target="_blank" rel="noreferrer noopener"><span>↗</span><div><b>{link.title}</b><small>{link.host}</small></div></a>)}</div>}{result.files.length > 0 && <div className="run-result-files"><strong>Файлы</strong>{result.files.map((file) => <a key={file.id} href={file.downloadUrl} download><span>⇩</span><div><b>{file.filename}</b><small>{formatBytes(file.size)} · {file.mimeType}</small></div></a>)}</div>}{result.truncated && <p className="run-result-note">Часть результата скрыта из-за ограничений безопасного отображения.</p>}</section>;
}

function formatBytes(value: number) {
  if (!value) return "Размер не указан";
  const units = ["Б", "КБ", "МБ", "ГБ"];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) { size /= 1024; index += 1; }
  return `${size >= 10 || index === 0 ? Math.round(size) : size.toFixed(1)} ${units[index]}`;
}

function formatDateTime(value: number) { return value ? new Date(value).toLocaleString("ru-RU") : "—"; }

function RunStatusBadge({ status }: { status: RunStatus }) {
  const labels: Record<RunStatus, string> = { queued: "В очереди", running: "Выполняется", success: "Успешно", failed: "Ошибка", cancelled: "Остановлено", unknown: "Неизвестно" };
  const tones: Record<RunStatus, string> = { queued: "warning", running: "violet", success: "success", failed: "error", cancelled: "neutral", unknown: "neutral" };
  return <Status tone={tones[status]}>{labels[status]}</Status>;
}

function OperationTable({ rows, detailed = false, onSelect }: { rows: RunRecord[]; detailed?: boolean; onSelect?: (run: RunRecord) => void }) {
  return <div className="data-table"><div className={`tr th ${detailed ? "ops-detailed" : "ops-row"}`}><span>Операция</span><span>Объект</span><span>Статус</span><span>Инициатор</span><span>Время</span>{detailed && <span>Job</span>}</div>{rows.map((run) => <div className={`tr ${detailed ? "ops-detailed" : "ops-row"} ${onSelect ? "selectable-run" : ""}`} key={run.id} title={run.error ?? ""} onClick={() => onSelect?.(run)}><span className="operation"><i className={run.status}>↗</i>{run.title}</span><span>{run.subject}</span><span><RunStatusBadge status={run.status} /></span><span>{run.actor}</span><span><strong>{new Date(run.startedAt).toLocaleTimeString("ru-RU")}</strong><small>{new Date(run.startedAt).toLocaleDateString("ru-RU")}</small></span>{detailed && <span className="mono">{run.jobId}</span>}</div>)}{!rows.length && <div className="catalog-empty"><strong>Операций пока нет</strong><span>Запуски Events и Workflows появятся здесь автоматически.</span></div>}</div>;
}

function PersistentConnectionSettings({ notify }: { notify: (message: string) => void }) {
  const [adminToken, setAdminToken] = useState(() => typeof window === "undefined" ? "" : window.sessionStorage.getItem("xyops-admin-token") ?? "");
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [draft, setDraft] = useState({ demoMode: false, ipaUrl: "", ipaUsername: "", ipaPassword: "", xyopsUrl: "", xyopsApiKey: "" });
  const [busy, setBusy] = useState<"load" | "save" | "freeipa" | "xyops" | null>(null);
  const [error, setError] = useState("");
  const [tests, setTests] = useState<{ freeipa?: string; xyops?: string }>({});

  const payload = () => ({ ...draft });
  const headers = () => ({ "content-type": "application/json", "x-admin-token": adminToken });

  async function loadSettings() {
    setBusy("load"); setError("");
    try {
      const response = await fetch("/api/integrations/settings", { headers: { "x-admin-token": adminToken }, cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Не удалось загрузить настройки");
      window.sessionStorage.setItem("xyops-admin-token", adminToken);
      setSettings(data);
      setDraft({ demoMode: data.demoMode === true, ipaUrl: data.freeipa.url ?? "", ipaUsername: data.freeipa.username ?? "", ipaPassword: "", xyopsUrl: data.xyops.url ?? "", xyopsApiKey: "" });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Ошибка загрузки"); }
    finally { setBusy(null); }
  }

  async function saveSettings() {
    setBusy("save"); setError("");
    try {
      const response = await fetch("/api/integrations/settings", { method: "PUT", headers: headers(), body: JSON.stringify(payload()) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Не удалось сохранить настройки");
      setSettings(data);
      setDraft((current) => ({ ...current, ipaPassword: "", xyopsApiKey: "" }));
      notify("Настройки зашифрованы и сохранены. Конфигурация перезагружается…");
      window.setTimeout(() => window.location.reload(), 900);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Ошибка сохранения"); }
    finally { setBusy(null); }
  }

  async function testConnection(service: "freeipa" | "xyops") {
    setBusy(service); setError(""); setTests((current) => ({ ...current, [service]: undefined }));
    try {
      const response = await fetch("/api/integrations/settings/test", { method: "POST", headers: headers(), body: JSON.stringify({ ...payload(), service }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Проверка не пройдена");
      setTests((current) => ({ ...current, [service]: `Подключено · ${data.latencyMs} мс` }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Ошибка проверки"); }
    finally { setBusy(null); }
  }

  return <>
    <section className="panel settings-access"><div><span className="eyebrow">ADMIN ACCESS</span><h2>Постоянная конфигурация</h2><p>Токен администратора хранится только в текущей вкладке и не записывается в базу.</p></div><label>ADMIN_TOKEN<input type="password" value={adminToken} onChange={(event) => setAdminToken(event.target.value)} placeholder="Введите серверный ADMIN_TOKEN" autoComplete="off" /></label><button className="primary" disabled={!adminToken || busy === "load"} onClick={() => void loadSettings()}>{busy === "load" ? "Загрузка…" : settings ? "Перезагрузить" : "Открыть настройки"}</button></section>
    {error && <div className="settings-error"><strong>Ошибка конфигурации</strong><span>{error}</span></div>}
    {settings && <><div className="persistence-strip"><Status tone={settings.persistenceAvailable ? "success" : "error"}>{settings.persistenceAvailable ? "D1 / SQLite доступна" : "База недоступна"}</Status><Status tone={settings.encryptionConfigured ? "success" : "error"}>{settings.encryptionConfigured ? "Шифрование настроено" : "Нет ключа шифрования"}</Status><span>Источник: <b>{settings.source === "database" ? "база данных" : "переменные окружения"}</b></span>{settings.updatedAt && <span>Сохранено: {new Date(settings.updatedAt).toLocaleString("ru-RU")}</span>}<label className="demo-switch"><input type="checkbox" checked={draft.demoMode} onChange={(event) => setDraft({ ...draft, demoMode: event.target.checked })} /> Демо-режим</label></div><div className="settings-grid">
      <section className="panel settings-card"><div className="settings-head"><span className="service-icon teal">▤</span><div><h2>FreeIPA — управление</h2><p>Независимый JSON-RPC модуль пользователей и групп</p></div><Status tone={tests.freeipa ? "success" : "neutral"}>{tests.freeipa ?? "Не проверено"}</Status></div><label>Адрес сервера<input value={draft.ipaUrl} onChange={(event) => setDraft({ ...draft, ipaUrl: event.target.value })} placeholder="https://ipa.company.local" /></label><label>Service account<input value={draft.ipaUsername} onChange={(event) => setDraft({ ...draft, ipaUsername: event.target.value })} placeholder="portal-freeipa-manager" /></label><label>Пароль<input type="password" value={draft.ipaPassword} onChange={(event) => setDraft({ ...draft, ipaPassword: event.target.value })} placeholder={settings.freeipa.passwordConfigured ? "Сохранён — оставьте пустым без изменений" : "Введите пароль"} autoComplete="new-password" /></label><p className="settings-note">Учётной записи нужны только разрешения на требуемые операции пользователей и групп. Пароль шифруется AES-GCM.</p><button className="secondary" disabled={Boolean(busy)} onClick={() => void testConnection("freeipa")}>{busy === "freeipa" ? "Проверка…" : "Проверить FreeIPA"}</button></section>
      <section className="panel settings-card"><div className="settings-head"><span className="service-icon violet">⚙</span><div><h2>XYOps — выполнение</h2><p>Каталог Events и запуск Workflows</p></div><Status tone={tests.xyops ? "success" : "neutral"}>{tests.xyops ?? "Не проверено"}</Status></div><label>Адрес XYOps<input value={draft.xyopsUrl} onChange={(event) => setDraft({ ...draft, xyopsUrl: event.target.value })} placeholder="https://xyops.company.local" /></label><label>API Key<input type="password" value={draft.xyopsApiKey} onChange={(event) => setDraft({ ...draft, xyopsApiKey: event.target.value })} placeholder={settings.xyops.apiKeyConfigured ? "Сохранён — оставьте пустым без изменений" : "Введите API Key"} autoComplete="new-password" /></label><p className="settings-note">API Key никогда не возвращается в браузер. Тест выполняет read-only запрос каталога.</p><button className="secondary" disabled={Boolean(busy)} onClick={() => void testConnection("xyops")}>{busy === "xyops" ? "Проверка…" : "Проверить XYOps"}</button></section>
    </div><section className="panel settings-savebar"><div><strong>Сохранение в persistent storage</strong><span>Настройки переживут перезапуск контейнера при подключённом volume.</span></div><button className="primary" disabled={Boolean(busy) || !settings.persistenceAvailable || !settings.encryptionConfigured} onClick={() => void saveSettings()}>{busy === "save" ? "Сохранение…" : "Сохранить настройки"}</button></section></>}
  </>;
}


const exampleCatalogPolicy: CatalogPolicySet = {
  version: 1,
  defaultEffect: "allow",
  adminBypass: true,
  rules: [
    { id: "hide-production", effect: "deny", users: [], groups: ["interns"], roles: [], categories: ["Production"], processes: [] },
    { id: "allow-dba-backups", effect: "allow", users: [], groups: ["dba"], roles: [], categories: [], processes: ["database-backup"] },
  ],
};

function CatalogPolicyEditor({ notify }: { notify: (message: string) => void }) {
  const [adminToken, setAdminToken] = useState(() => typeof window === "undefined" ? "" : window.sessionStorage.getItem("xyops-admin-token") ?? "");
  const [text, setText] = useState(JSON.stringify(exampleCatalogPolicy, null, 2));
  const [source, setSource] = useState<"database" | "environment" | "default" | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [busy, setBusy] = useState<"load" | "save" | null>(null);

  async function loadPolicies() {
    setBusy("load");
    try {
      const response = await fetch("/api/integrations/catalog/policies", { headers: { "x-admin-token": adminToken }, cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Не удалось загрузить политики");
      window.sessionStorage.setItem("xyops-admin-token", adminToken);
      setText(JSON.stringify(data.policy, null, 2));
      setSource(data.source ?? "default");
      setUpdatedAt(data.updatedAt ?? null);
    } catch (error) { notify(error instanceof Error ? error.message : "Ошибка загрузки политик"); }
    finally { setBusy(null); }
  }

  async function savePolicies() {
    setBusy("save");
    try {
      const policy = JSON.parse(text) as CatalogPolicySet;
      const response = await fetch("/api/integrations/catalog/policies", { method: "PUT", headers: { "content-type": "application/json", "x-admin-token": adminToken }, body: JSON.stringify({ policy }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Не удалось сохранить политики");
      window.sessionStorage.setItem("xyops-admin-token", adminToken);
      setText(JSON.stringify(data.policy, null, 2));
      setSource("database");
      setUpdatedAt(data.updatedAt ?? Date.now());
      notify("Политики каталога сохранены");
    } catch (error) { notify(error instanceof Error ? error.message : "Некорректный JSON политик"); }
    finally { setBusy(null); }
  }

  return <section className="panel policy-editor"><div className="panel-title"><div><span className="eyebrow">CATALOG ACCESS</span><h2>Видимость категорий и процессов</h2><p>Правила применяются сервером к каталогу, dynamic options, запуску и safe re-run. Deny имеет приоритет над allow.</p></div>{source && <Status tone={source === "database" ? "success" : "neutral"}>{source === "database" ? "D1" : source === "environment" ? "ENV" : "По умолчанию"}</Status>}</div><div className="policy-toolbar"><label>ADMIN_TOKEN<input type="password" value={adminToken} onChange={(event) => setAdminToken(event.target.value)} placeholder="Токен администратора" autoComplete="off" /></label><button className="secondary" disabled={!adminToken || Boolean(busy)} onClick={() => void loadPolicies()}>{busy === "load" ? "Загрузка…" : "Загрузить"}</button><button className="primary" disabled={!adminToken || Boolean(busy)} onClick={() => void savePolicies()}>{busy === "save" ? "Сохранение…" : "Сохранить политики"}</button></div><textarea className="policy-json" value={text} onChange={(event) => setText(event.target.value)} spellCheck={false} aria-label="JSON политик каталога" /><div className="policy-help"><span>Субъекты: <code>users</code>, <code>groups</code>, <code>roles</code></span><span>Ресурсы: <code>categories</code>, <code>processes</code></span><span>{updatedAt ? `Сохранено: ${new Date(updatedAt).toLocaleString("ru-RU")}` : "defaultEffect: allow сохраняет текущую доступность"}</span></div></section>;
}

function Settings({ routes, catalog, catalogLoading, onSync, onRoutesChange, notify }: { routes: AutomationRoute[]; catalog: CatalogEvent[]; catalogLoading: boolean; onSync: () => void; onRoutesChange: (routes: AutomationRoute[]) => void; notify: (message: string) => void }) {
  const [expanded, setExpanded] = useState<string | null>(routes[0]?.key ?? null);
  const [operation, setOperation] = useState<string>(routeOperations[0][0]);
  const [eventId, setEventId] = useState(catalog[0]?.id ?? "");
  const [routeTitle, setRouteTitle] = useState("");
  const [adminToken, setAdminToken] = useState(() => typeof window === "undefined" ? "" : window.sessionStorage.getItem("xyops-admin-token") ?? "");
  const [savingRoutes, setSavingRoutes] = useState(false);
  const [reviewRouteKey, setReviewRouteKey] = useState<string | null>(null);
  const [catalogHistory, setCatalogHistory] = useState<CatalogHistoryEntry[]>([]);
  const selectedEvent = catalog.find((event) => event.id === eventId) ?? catalog[0];

  useEffect(() => {
    fetch("/api/integrations/catalog/history?limit=10", { cache: "no-store" }).then((response) => response.ok ? response.json() : Promise.reject()).then((data) => setCatalogHistory(Array.isArray(data.history) ? data.history : [])).catch(() => setCatalogHistory([]));
  }, [catalog]);

  async function persistRoutes(next: AutomationRoute[], successMessage: string) {
    setSavingRoutes(true);
    try {
      const response = await fetch("/api/integrations/routes", { method: "PUT", headers: { "content-type": "application/json", "x-admin-token": adminToken }, body: JSON.stringify({ routes: next }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Не удалось сохранить маршруты");
      window.sessionStorage.setItem("xyops-admin-token", adminToken);
      onRoutesChange(Array.isArray(data.routes) ? data.routes : next);
      notify(successMessage);
    } catch (cause) { notify(cause instanceof Error ? cause.message : "Ошибка сохранения маршрутов"); }
    finally { setSavingRoutes(false); }
  }

  function addRoute() {
    if (!selectedEvent) return;
    const baseKey = `${operation}-${selectedEvent.id}`.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "");
    const route: AutomationRoute = { key: baseKey || `${operation}-${routes.length + 1}`, title: routeTitle.trim() || selectedEvent.title, operation, eventId: selectedEvent.id, schemaVersion: selectedEvent.schemaVersion, kind: selectedEvent.kind, enabled: true, targets: selectedEvent.targets, fields: selectedEvent.fields };
    const next = [...routes.filter((item) => item.key !== route.key), route];
    void persistRoutes(next, "Маршрут сохранён");
    setExpanded(route.key);
    setRouteTitle("");
  }
  return <div className="settings-page">
    <PersistentConnectionSettings notify={notify} />
    <CatalogPolicyEditor notify={notify} />
    <section className="panel inspector-panel"><span className="service-icon violet">◇</span><div><span className="eyebrow">CONTRACT INSPECTOR</span><h2>Проверка реальной схемы XYOps</h2><p>Read-only утилита собирает структуру Events, Workflows, Toolsets, targets и jobs, удаляя ключ API, заголовки, сырые ответы и секретные значения.</p></div><code>npm run inspect:xyops</code><Status tone="neutral">Запуск локально</Status></section>
    <section className="panel contract-history"><div className="panel-title"><div><h2>История контрактов XYOps</h2><p>Сохраняются только синхронизации, в которых изменился каталог</p></div><Status tone="violet">{catalogHistory.length} версий</Status></div><div className="history-list">{catalogHistory.map((entry) => <article key={entry.id}><i>⌁</i><div><strong>{new Date(entry.syncedAt).toLocaleString("ru-RU")}</strong><small>{entry.processCount} процессов</small></div><span><b className="new">＋{entry.changes.filter((change) => change.kind === "new").length}</b><b className="changed">△{entry.changes.filter((change) => change.kind === "changed").length}</b><b className="removed">−{entry.changes.filter((change) => change.kind === "removed").length}</b></span></article>)}{!catalogHistory.length && <div className="catalog-empty"><strong>История пока пуста</strong><span>Первая версия появится после синхронизации реального каталога XYOps.</span></div>}</div></section>
    <section className="panel routes-panel"><div className="panel-title"><div><h2>Маршруты автоматизации</h2><p>Привяжите действие интерфейса к любому Event или Workflow из каталога XYOps</p></div><Status tone="success">D1 / SQLite</Status></div>
      <div className="route-editor"><label>Операция<select value={operation} onChange={(event) => setOperation(event.target.value)}>{routeOperations.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>Event / Workflow<select value={selectedEvent?.id ?? ""} onChange={(event) => { setEventId(event.target.value); setRouteTitle(""); }} disabled={!catalog.length}>{catalog.map((event) => <option value={event.id} key={event.id}>{event.title} · {event.kind}</option>)}</select></label><label>Название маршрута<input value={routeTitle} onChange={(event) => setRouteTitle(event.target.value)} placeholder={selectedEvent?.title ?? "Сначала синхронизируйте каталог"} /></label><label>ADMIN_TOKEN<input type="password" value={adminToken} onChange={(event) => setAdminToken(event.target.value)} placeholder="Токен для сохранения" autoComplete="off" /></label><button className="primary" disabled={!selectedEvent || !adminToken || savingRoutes} onClick={addRoute}>{savingRoutes ? "Сохранение…" : "＋ Добавить маршрут"}</button></div>
      <div className="route-list">{routes.map((route) => <article className={`route-card ${expanded === route.key ? "expanded" : ""}`} key={route.key}>
        <button className="route-main" onClick={() => setExpanded(expanded === route.key ? null : route.key)}><span className={`route-kind ${route.kind}`}>{route.kind === "workflow" ? "⌘" : "▶"}</span><span><strong>{route.title}</strong><small>{route.operation}</small></span><Status tone={route.kind === "workflow" ? "violet" : "success"}>{route.kind === "workflow" ? "Workflow" : "Event"}</Status><code>{route.schemaVersion ?? route.eventId}</code><b className={routeSchemaDrift(route, catalog.find((event) => event.id === route.eventId)) ? "schema-warning" : ""}>{routeSchemaDrift(route, catalog.find((event) => event.id === route.eventId)) ? "Схема изменилась" : route.enabled ? "Совместим" : "Отключён"}</b><i>{expanded === route.key ? "⌃" : "⌄"}</i></button>
        {expanded === route.key && <div className="route-details"><div><h4>Пользовательские переменные</h4><div className="variable-table"><div className="variable-row head"><span>Поле</span><span>Тип</span><span>Секция / условие</span><span>Обязательное</span></div>{route.fields.map((field) => <div className="variable-row" key={field.key}><span><strong>{field.label}</strong><code>{field.key}</code></span><span>{field.type}</span><span><Status tone="neutral">{field.groupPath?.join(" / ") || field.section || field.visibleWhen ? `${field.groupPath?.join(" / ") || field.section || "Параметры"}${field.visibleWhen ? ` · ${conditionFieldNames(field.visibleWhen).join(", ")}` : ""}` : field.target ?? "params"}</Status></span><span>{field.required ? "Да" : "Нет"}</span></div>)}</div></div><aside><h4>Параметры запуска</h4><p><span>Event ID</span><code>{route.eventId}</code></p><p><span>Targets</span><strong>{route.targets.length ? route.targets.join(", ") : "из Event"}</strong></p>{!catalog.some((event) => event.id === route.eventId) && <Status tone="warning">Процесс отсутствует в каталоге</Status>}<div className="route-actions"><button className="secondary" disabled={!adminToken || savingRoutes || !catalog.some((event) => event.id === route.eventId)} onClick={() => setReviewRouteKey(route.key)}>Сравнить схему</button><button className="secondary" disabled={!adminToken || savingRoutes} onClick={() => void persistRoutes(routes.map((item) => item.key === route.key ? { ...item, enabled: !item.enabled } : item), route.enabled ? "Маршрут отключён" : "Маршрут включён")}>{route.enabled ? "Отключить" : "Включить"}</button><button className="danger-button" disabled={!adminToken || savingRoutes} onClick={() => void persistRoutes(routes.filter((item) => item.key !== route.key), "Маршрут удалён")}>Удалить</button></div></aside></div>}
      </article>)}</div>
      {!routes.length && <div className="catalog-empty"><strong>Маршрутов пока нет</strong><span>Выберите процесс из каталога и операцию интерфейса.</span></div>}
      <div className="routes-footer"><span>Маршруты хранятся постоянно в D1. Секретные значения полей не копируются из XYOps и API Key не попадает в браузер.</span></div>
    </section>
    <section className="panel catalog-panel"><div className="panel-title"><div><h2>Каталог XYOps</h2><p>Events и Workflows, полученные через get_events API</p></div><button className="secondary" disabled={catalogLoading} onClick={onSync}>{catalogLoading ? "Синхронизация…" : "⟳ Синхронизировать"}</button></div><div className="catalog-stats"><span><b>{catalog.length}</b> всего</span><span><b>{catalog.filter((event) => event.kind === "event").length}</b> Events</span><span><b>{catalog.filter((event) => event.kind === "workflow").length}</b> Workflows</span><span><b>{catalog.reduce((sum, event) => sum + event.fields.length, 0)}</b> пользовательских полей</span></div><div className="catalog-grid">{catalog.map((event) => <article key={event.id}><span className={`route-kind ${event.kind}`}>{event.kind === "workflow" ? "⌘" : "▶"}</span><div><strong>{event.title}</strong><code>{event.id}</code><small>{event.category}{event.plugin ? ` · ${event.plugin}` : ""}</small></div><Status tone="neutral">{event.schemaVersion ?? "legacy"}</Status><Status tone={event.kind === "workflow" ? "violet" : "success"}>{event.fields.length} полей</Status></article>)}</div>{!catalogLoading && !catalog.length && <div className="catalog-empty"><strong>Каталог пуст</strong><span>Сохраните подключение XYOps или включите DEMO_MODE явно.</span></div>}</section>
    {reviewRouteKey && (() => { const route = routes.find((item) => item.key === reviewRouteKey); const source = route && catalog.find((event) => event.id === route.eventId); return route && source ? <SchemaReviewModal route={route} source={source} busy={savingRoutes} close={() => setReviewRouteKey(null)} apply={() => { setReviewRouteKey(null); void persistRoutes(routes.map((item) => item.key === route.key ? { ...item, kind: source.kind, schemaVersion: source.schemaVersion, fields: source.fields, targets: source.targets } : item), "Схема маршрута обновлена из XYOps"); }} /> : null; })()}
  </div>;
}

function SchemaReviewModal({ route, source, busy, close, apply }: { route: AutomationRoute; source: CatalogEvent; busy: boolean; close: () => void; apply: () => void }) {
  const before = new Map(route.fields.map((field) => [field.key, field]));
  const after = new Map(source.fields.map((field) => [field.key, field]));
  const added = source.fields.filter((field) => !before.has(field.key));
  const removed = route.fields.filter((field) => !after.has(field.key));
  const changed = source.fields.filter((field) => before.has(field.key) && JSON.stringify(before.get(field.key)) !== JSON.stringify(field));
  const topologyChanged = route.kind !== source.kind || JSON.stringify(route.targets) !== JSON.stringify(source.targets);
  const hasChanges = added.length + removed.length + changed.length > 0 || topologyChanged;
  return <div className="modal-backdrop"><div className="modal schema-review-modal"><button className="modal-x" onClick={close}>×</button><span className="eyebrow">SCHEMA REVIEW</span><h2>Изменения маршрута «{route.title}»</h2><p>Сравнение сохранённой схемы с текущим процессом XYOps. Обновление выполняется только после подтверждения.</p><div className="schema-version-line"><code>{route.schemaVersion ?? "legacy"}</code><span>→</span><code>{source.schemaVersion ?? "legacy"}</code></div><div className="schema-diff-summary"><Status tone="success">＋ {added.length} добавлено</Status><Status tone="warning">△ {changed.length} изменено</Status><Status tone="error">− {removed.length} удалено</Status>{topologyChanged && <Status tone="violet">Targets или тип изменены</Status>}</div><div className="schema-diff-list">{added.map((field) => <article key={`add-${field.key}`}><i className="added">＋</i><div><strong>{field.label}</strong><code>{field.key}</code><small>{field.type} · {field.target ?? "params"}</small></div><Status tone="success">Новое поле</Status></article>)}{changed.map((field) => <article key={`change-${field.key}`}><i className="changed">△</i><div><strong>{field.label}</strong><code>{field.key}</code><small>{before.get(field.key)?.type} → {field.type}{before.get(field.key)?.required !== field.required ? ` · обязательность: ${field.required ? "да" : "нет"}` : ""}</small></div><Status tone="warning">Изменено</Status></article>)}{removed.map((field) => <article key={`remove-${field.key}`}><i className="removed">−</i><div><strong>{field.label}</strong><code>{field.key}</code><small>Поле отсутствует в актуальной схеме</small></div><Status tone="error">Будет удалено</Status></article>)}{!hasChanges && <div className="catalog-empty"><strong>Схемы совпадают</strong><span>Маршрут уже использует актуальный контракт XYOps.</span></div>}</div><div className="modal-actions"><button className="secondary" onClick={close}>Закрыть</button><button className="primary" disabled={!hasChanges || busy} onClick={apply}>{busy ? "Сохранение…" : "Применить новую схему"}</button></div></div></div>;
}

function FreeIpaActionModal({ action, close, submit }: { action: FreeIpaAction; close: () => void; submit: (operation: FreeIpaOperation, data: Record<string, string>) => Promise<boolean> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { operation, preset } = action;
  const isUserForm = operation === "user_add" || operation === "user_mod";
  const isGroupForm = operation === "group_add";
  const isMemberForm = operation === "group_add_member" || operation === "group_remove_member";
  const isPassword = operation === "user_password";
  const destructive = operation === "user_del" || operation === "group_del" || operation === "user_disable" || operation === "group_remove_member" || isPassword;
  return <div className="modal-backdrop"><form className="modal dynamic-modal" onSubmit={async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(Array.from(new FormData(event.currentTarget).entries()).map(([key, value]) => [key, String(value)]));
    if (isPassword && data.password !== data.passwordConfirm) { setError("Пароли не совпадают"); return; }
    setError(""); setBusy(true);
    if (!await submit(operation, data)) setBusy(false);
  }}><button type="button" className="modal-x" onClick={close}>×</button><span className="eyebrow">ПРЯМОЕ УПРАВЛЕНИЕ FREEIPA</span><h2>{action.title}</h2><p>Операция выполняется отдельным модулем FreeIPA. XYOps для неё не требуется.</p>
    {(isUserForm || isPassword || operation === "user_enable" || operation === "user_disable" || operation === "user_del") && <label>Логин<input name="username" required readOnly={operation !== "user_add"} defaultValue={preset.username ?? ""} pattern="[A-Za-z0-9_.@$-]+" autoFocus={operation !== "user_add" && !isPassword} /></label>}
    {isUserForm && <div className="two-cols"><label>Имя<input name="firstName" required={operation === "user_add"} defaultValue={preset.firstName ?? ""} autoFocus={operation === "user_add"} /></label><label>Фамилия<input name="lastName" required={operation === "user_add"} defaultValue={preset.lastName ?? ""} /></label></div>}
    {isUserForm && <label>Email<input name="email" type="email" defaultValue={preset.email ?? ""} /></label>}
    {operation === "user_add" && <label>Начальный пароль<input name="password" type="password" autoComplete="new-password" /><small>Необязательно. Пароль передаётся напрямую в FreeIPA и не сохраняется порталом.</small></label>}
    {isPassword && <><label>Новый временный пароль<input name="password" type="password" minLength={8} required autoComplete="new-password" autoFocus /></label><label>Повторите пароль<input name="passwordConfirm" type="password" minLength={8} required autoComplete="new-password" /></label></>}
    {(isGroupForm || isMemberForm || operation === "group_del") && <label>Группа{action.choices?.groups?.length ? <select name="group" required autoFocus defaultValue=""><option value="" disabled>Выберите группу</option>{action.choices.groups.map((group) => <option value={group} key={group}>{group}</option>)}</select> : <input name="group" required readOnly={!isGroupForm} defaultValue={preset.group ?? ""} pattern="[A-Za-z0-9_.@$-]+" autoFocus={isGroupForm} />}</label>}
    {isGroupForm && <label>Описание<input name="description" defaultValue={preset.description ?? ""} /></label>}
    {isMemberForm && <label>Логин участника{action.choices?.users?.length ? <select name="username" required autoFocus defaultValue=""><option value="" disabled>Выберите пользователя</option>{action.choices.users.map((uid) => <option value={uid} key={uid}>{uid}</option>)}</select> : <input name="username" required readOnly={Boolean(preset.username)} defaultValue={preset.username ?? ""} pattern="[A-Za-z0-9_.@$-]+" autoFocus={!preset.username} />}</label>}
    {error && <div className="settings-error"><strong>Ошибка</strong><span>{error}</span></div>}
    {destructive && <label className="checkbox-field danger-confirm"><input type="checkbox" required /><span><strong>Подтверждаю выполнение операции</strong><small>Изменение будет немедленно применено в FreeIPA</small></span></label>}
    <div className="schema-note"><span>▤</span><div><strong>Независимый модуль FreeIPA</strong><small>JSON-RPC через защищённый серверный Gateway</small></div></div>
    <div className="modal-actions"><button type="button" className="secondary" onClick={close}>Отмена</button><button className="primary" disabled={busy}>{busy ? "Выполнение…" : "Применить в FreeIPA"}</button></div>
  </form></div>;
}

function ProcessModal({ event, preset = {}, close, submit }: { event: CatalogEvent; preset?: Record<string, string>; close: () => void; submit: (values: Record<string, unknown>, targets: string[]) => Promise<boolean> }) {
  const [submitting, setSubmitting] = useState(false);
  return <div className="modal-backdrop"><form className="modal process-modal" onSubmit={async (formEvent) => { formEvent.preventDefault(); setSubmitting(true); const form = new FormData(formEvent.currentTarget); const values: Record<string, unknown> = {}; for (const field of event.fields) { if (field.type === "boolean") values[field.key] = form.has(field.key); else if (field.type === "multiselect") values[field.key] = form.getAll(field.key).map(String); else values[field.key] = String(form.get(field.key) ?? ""); } const succeeded = await submit(values, form.getAll("__targets").map(String)); if (!succeeded) setSubmitting(false); }}><button type="button" className="modal-x" onClick={close}>×</button><div className="process-modal-head"><span className={`route-kind ${event.kind}`}>{event.kind === "workflow" ? "⌘" : "▶"}</span><div><span className="eyebrow">{event.category} · {event.kind}</span><h2>{event.title}</h2><p>{event.description || "Параметры процесса загружены из XYOps."}</p></div></div><div className="schema-note"><span>◇</span><div><strong>Форма сгенерирована автоматически</strong><small>{event.fields.length} полей из схемы XYOps · ID: {event.id}{event.operation ? ` · ${event.operation}` : ""}</small></div></div>{event.targets.length > 0 && <label>Целевые системы{event.targets.length > 1 && <em>можно выбрать несколько</em>}<select name="__targets" multiple={event.targets.length > 1} required defaultValue={event.targets.length === 1 ? [event.targets[0]] : []}>{event.targets.map((target) => <option key={target} value={target}>{target}</option>)}</select><small>targets → run_event</small></label>}<GeneratedFields fields={event.fields} eventId={event.id} preset={preset} />{event.dangerous && <label className="checkbox-field danger-confirm"><input type="checkbox" required /><span><strong>Подтверждаю выполнение потенциально опасной операции</strong><small>XYOps получит команду только после подтверждения</small></span></label>}<div className="modal-actions"><button type="button" className="secondary" onClick={close}>Отмена</button><button className="primary" disabled={submitting}>{submitting ? "Отправка…" : `Запустить ${event.kind === "workflow" ? "Workflow" : "Event"}`}</button></div></form></div>;
}

function conditionMatches(field: RouteField, values: Record<string, unknown>) {
  return fieldConditionMatches(field.visibleWhen, values);
}

function GeneratedFields({ fields, eventId, preset = {} }: { fields: RouteField[]; eventId: string; preset?: Record<string, string> }) {
  const [values, setValues] = useState<Record<string, unknown>>(() => Object.fromEntries(fields.map((field) => [field.key, preset[field.key] ?? field.default ?? (field.type === "boolean" ? false : "")])));
  const visibleFields = [...fields].sort((left, right) => (left.order ?? 0) - (right.order ?? 0)).filter((field) => conditionMatches(field, values));
  const tree: FieldGroupNode = { title: "", fields: [], children: [] };
  for (const field of visibleFields) {
    const path = field.groupPath?.length ? field.groupPath : field.section ? [field.section] : [];
    let node = tree;
    for (const title of path) {
      let child = node.children.find((item) => item.title === title);
      if (!child) { child = { title, fields: [], children: [] }; node.children.push(child); }
      node = child;
    }
    node.fields.push(field);
  }
  return <div className="generated-form" onChangeCapture={(event) => {
    const target = event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    if (!target.name || target.name.startsWith("__")) return;
    const value = target instanceof HTMLInputElement && target.type === "checkbox" ? target.checked : target instanceof HTMLSelectElement && target.multiple ? Array.from(target.selectedOptions).map((option) => option.value) : target.value;
    setValues((current) => ({ ...current, [target.name]: value }));
  }}><FieldGroup group={tree} eventId={eventId} preset={preset} root /></div>;
}

type FieldGroupNode = { title: string; fields: RouteField[]; children: FieldGroupNode[] };

function FieldGroup({ group, eventId, preset, root = false }: { group: FieldGroupNode; eventId: string; preset: Record<string, string>; root?: boolean }) {
  const total = group.fields.length + group.children.reduce((sum, child) => sum + child.fields.length, 0);
  return <section className={root ? "generated-root" : "generated-section"}>{!root && <div className="generated-section-title"><strong>{group.title}</strong><span>{total} полей</span></div>}{group.fields.length > 0 && <div className="dynamic-fields">{group.fields.map((field) => <DynamicField field={field} eventId={eventId} preset={preset} key={field.key} />)}</div>}{group.children.map((child) => <FieldGroup group={child} eventId={eventId} preset={preset} key={child.title} />)}</section>;
}

function RemoteOptionsField({ field, eventId, defaultValue }: { field: RouteField; eventId: string; defaultValue: unknown }) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<string[]>(field.options ?? []);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!field.optionsSource) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/integrations/catalog/options?eventId=${encodeURIComponent(eventId)}&fieldKey=${encodeURIComponent(field.key)}&query=${encodeURIComponent(query)}`, { signal: controller.signal, cache: "no-store" });
        const data = await response.json();
        if (response.ok && Array.isArray(data.options)) setOptions(data.options.map(String));
      } catch {} finally { setLoading(false); }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [eventId, field.key, field.optionsSource, query]);
  return <label>{field.label}{field.required && <em>обязательно</em>}<input className="option-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск вариантов в XYOps…" aria-label={`Поиск вариантов: ${field.label}`} /><select name={field.key} required={field.required} defaultValue={String(defaultValue ?? "")}><option value="" disabled>{loading ? "Загрузка…" : "Выберите значение"}</option>{options.map((option) => <option value={option} key={option}>{option}</option>)}</select><small>{loading ? "Получение вариантов из XYOps" : field.description || `${field.key} → ${field.target ?? "params"}`}</small></label>;
}

function DynamicField({ field, eventId, preset = {} }: { field: RouteField; eventId: string; preset?: Record<string, string> }) {
  const defaultValue = preset[field.key] ?? field.default;
  if (field.type === "select" && field.optionsSource) return <RemoteOptionsField field={field} eventId={eventId} defaultValue={defaultValue} />;
  if (field.type === "boolean") return <label className="checkbox-field"><input name={field.key} type="checkbox" defaultChecked={defaultValue === true || defaultValue === "true"} /><span><strong>{field.label}</strong><small>{field.key} · {field.target ?? "params"}</small></span></label>;
  if (field.type === "select" && field.options?.length) return <label>{field.label}{field.required && <em>обязательно</em>}<select name={field.key} required={field.required} disabled={field.readOnly} defaultValue={String(defaultValue ?? field.options[0] ?? "")}><option value="" disabled>Выберите значение</option>{field.options.map((option) => <option value={option} key={option}>{option}</option>)}</select>{field.readOnly && <input type="hidden" name={field.key} value={String(defaultValue ?? "")} />}<small>{field.description || `${field.key} → ${field.target ?? "params"}`}</small></label>;
  if (field.type === "select") return <label>{field.label}{field.required && <em>обязательно</em>}<input name={field.key} type="text" required={field.required} readOnly={field.readOnly} defaultValue={defaultValue === undefined ? "" : String(defaultValue)} placeholder={field.placeholder || field.key} /><small>{field.description || "XYOps не опубликовал список вариантов — разрешён ручной ввод"}</small></label>;
  if (field.type === "multiselect") return <label>{field.label}{field.required && <em>обязательно</em>}<select name={field.key} multiple required={field.required} defaultValue={Array.isArray(defaultValue) ? defaultValue : []}>{(field.options ?? []).map((option) => <option value={option} key={option}>{option}</option>)}</select><small>{field.description || `${field.key} → ${field.target ?? "params"}`}</small></label>;
  if (field.type === "textarea" || field.type === "json") return <label className="field-wide">{field.label}{field.required && <em>обязательно</em>}<textarea name={field.key} required={field.required} readOnly={field.readOnly} defaultValue={defaultValue === undefined ? "" : typeof defaultValue === "string" ? defaultValue : JSON.stringify(defaultValue, null, 2)} placeholder={field.placeholder || (field.type === "json" ? "{ }" : field.key)} /><small>{field.description || `${field.key} → ${field.target ?? "params"}`}</small></label>;
  const inputType = field.type === "number" ? "number" : field.type === "password" ? "password" : field.type === "email" ? "email" : field.type === "url" ? "url" : field.type === "date" ? "date" : field.type === "datetime" ? "datetime-local" : "text";
  return <label>{field.label}{field.required && <em>обязательно</em>}<input name={field.key} type={inputType} required={field.required} readOnly={field.readOnly} pattern={field.pattern} min={field.min} max={field.max} defaultValue={defaultValue === undefined ? "" : String(defaultValue)} placeholder={field.placeholder || field.key} autoComplete={field.type === "password" ? "new-password" : undefined} /><small>{field.description || `${field.key} → ${field.target ?? "params"}`}</small></label>;
}
