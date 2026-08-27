"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AutomationRoute as SourceAutomationRoute, CatalogEvent, RouteField } from "../automation-types";
import { conditionFieldNames } from "../field-conditions";
import { FREEIPA_DIRECTORY_CHANGED_EVENT, FREEIPA_OPEN_ACTION_EVENT, announceFreeIpaDirectoryChanged, type FreeIpaAction, type FreeIpaOperation } from "../freeipa-ui-events";
import { portalRoleLabels, type PortalPermission, type PortalRole } from "../portal-permissions";
import { buildHomePath, resolveHomeLocation, type HomePage } from "./shell/home-navigation";
import { buildAutomationSlug } from "./shell/home-presentation";
import { LegacyOverview } from "./overview/LegacyOverview";
import { Groups, Users, type DirectoryGroup, type DirectoryUser } from "./directory/DirectoryScreens";
import { Approvals, Operations, OperationTable, type ApprovalRecord, type RunRecord, type RunStats } from "./operations/OperationsApprovalsScreens";
import { AutomationCatalog } from "./automation/AutomationCatalog";
import { AuditLog } from "./audit/AuditLog";
import { Settings } from "./settings/SettingsScreens";
import { FreeIpaActionModal, NotificationCenter, ProcessModal, type PortalNotification } from "./shell/PortalOverlays";

type Page = HomePage;
type AutomationRoute = SourceAutomationRoute & { enabled: boolean; targets: string[]; fields: RouteField[] };
type IntegrationMode = "demo" | "live" | "cached" | "unconfigured";
type CatalogChange = { id: string; title: string; kind: "new" | "changed" | "removed" };
type CatalogMeta = { syncedAt: string | null; source: "demo" | "xyops" | "cache" | "none"; stale: boolean; changes: CatalogChange[] };
type PortalAccess = { identity: string; role: PortalRole; groups?: string[]; permissions: PortalPermission[] };
type AutomationSection = { category: string; slug: string; count: number; events: number; workflows: number; order: number };

const nav: { id: Page; label: string; icon: string }[] = [
  { id: "overview", label: "Обзор", icon: "⌂" },
  { id: "automation", label: "Автоматизация", icon: "⌘" },
  { id: "users", label: "Пользователи", icon: "♙" },
  { id: "groups", label: "Группы", icon: "♧" },
  { id: "operations", label: "Операции", icon: "◷" },
  { id: "approvals", label: "Согласования", icon: "✓" },
  { id: "audit", label: "Аудит", icon: "≣" },
  { id: "settings", label: "Настройки", icon: "⚙" },
];


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
  const [approvals, setApprovals] = useState<ApprovalRecord[]>([]);
  const [approvalPendingForMe, setApprovalPendingForMe] = useState(0);
  const [approvalsLoading, setApprovalsLoading] = useState(false);
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

  useEffect(() => {
    const openAction = (event: Event) => {
      const action = (event as CustomEvent<FreeIpaAction>).detail;
      if (action) setFreeIpaAction(action);
    };
    const refreshDirectory = () => void loadDirectory();
    window.addEventListener(FREEIPA_OPEN_ACTION_EVENT, openAction);
    window.addEventListener(FREEIPA_DIRECTORY_CHANGED_EVENT, refreshDirectory);
    return () => {
      window.removeEventListener(FREEIPA_OPEN_ACTION_EVENT, openAction);
      window.removeEventListener(FREEIPA_DIRECTORY_CHANGED_EVENT, refreshDirectory);
    };
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
  const canApproveXyops = integration.access.permissions.includes("xyops.approve");
  const canManageSettings = integration.access.permissions.includes("settings.manage");
  const visibleNav = nav.filter((item) => !["settings", "audit"].includes(item.id) || canManageSettings);
  const automationSections = useMemo<AutomationSection[]>(() => Array.from(new Set(catalog.map((event) => event.category || "general"))).map((category) => {
    const items = catalog.filter((event) => (event.category || "general") === category);
    return { category, slug: buildAutomationSlug(category), count: items.length, events: items.filter((event) => event.kind === "event").length, workflows: items.filter((event) => event.kind === "workflow").length, order: Math.min(...items.map((event) => event.order ?? 0)) };
  }).sort((left, right) => left.order - right.order || left.category.localeCompare(right.category)), [catalog]);
  const activeAutomationSection = automationSections.find((section) => section.category === automationCategory) ?? null;
  const title = page === "automation" && activeAutomationSection ? activeAutomationSection.category : nav.find((item) => item.id === page)?.label ?? "Обзор";
  const filteredUsers = useMemo(() => directoryUsers.filter((u) => `${u.uid} ${u.name} ${u.email}`.toLowerCase().includes(query.toLowerCase())), [directoryUsers, query]);
  const filteredGroups = useMemo(() => directoryGroups.filter((g) => `${g.name} ${g.description} ${g.type}`.toLowerCase().includes(query.toLowerCase())), [directoryGroups, query]);
  const filteredCatalog = useMemo(() => catalog.filter((event) => `${event.title} ${event.description} ${event.help ?? ""} ${event.category} ${event.icon ?? ""} ${event.plugin ?? ""}`.toLowerCase().includes(query.toLowerCase())), [catalog, query]);

  const navigateTo = useCallback((nextPage: Page, category = "all", replace = false) => {
    const section = category === "all" ? null : automationSections.find((item) => item.category === category);
    const resolvedCategory = nextPage === "automation" && section ? section.category : "all";
    const path = buildHomePath(nextPage, resolvedCategory, automationSections);
    setPage(nextPage);
    setAutomationCategory(resolvedCategory);
    setQuery("");
    if (window.location.pathname !== path) window.history[replace ? "replaceState" : "pushState"]({}, "", path);
  }, [automationSections]);

  useEffect(() => {
    const applyLocation = () => {
      const location = resolveHomeLocation(window.location.pathname, automationSections);
      setPage(location.page);
      setAutomationCategory(location.automationCategory);
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
      announceFreeIpaDirectoryChanged();
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
      if (!response.ok) throw new Error(result.retryAfter ? `${result.error || "XYOps отклонил запуск"}. Повторите после: ${result.retryAfter}` : result.error);
      if (result.approvalRequired) { await loadApprovals(); setSelectedProcess(null); navigateTo("approvals"); notify(`Заявка на согласование создана: ${result.approvalId}`); return true; }
      await loadRuns(false);
      setSelectedProcess(null);
      notify(result.mode === "live" ? `XYOps запущен: ${result.process?.title ?? result.jobId}` : `Демо-задание создано: ${result.process?.title ?? result.jobId}`);
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
      if (result.approvalRequired) { await loadApprovals(); navigateTo("approvals"); notify(`Повторный запуск ожидает согласования: ${result.approvalId}`); return true; }
      await loadRuns(true);
      notify(action === "cancel" ? "Команда остановки отправлена в XYOps" : `Создан новый запуск: ${result.process?.title ?? result.jobId ?? "ожидает Job ID"}`);
      return true;
    } catch (error) {
      notify(error instanceof Error ? error.message : "Не удалось выполнить действие с заданием");
      return false;
    }
  }

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
      notify(action === "approve" ? "Заявка согласована" : action === "reject" ? "Заявка отклонена" : action === "cancel" ? "Заявка отменена" : `XYOps запущен: ${data.process?.title ?? data.jobId ?? "ожидает Job ID"}`);
      if (action === "execute") navigateTo("operations");
      return true;
    } catch (error) { notify(error instanceof Error ? error.message : "Действие с заявкой не выполнено"); return false; }
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
        <div className="brand"><span className="brand-mark">◇</span><div><strong>Admin Dashboard Softrust</strong><small>FreeIPA · XYOps</small></div></div>
        <nav>{visibleNav.map((item) => <div className="nav-entry" key={item.id}><button className={page === item.id && (item.id !== "automation" || automationCategory === "all") ? "active" : ""} onClick={() => navigateTo(item.id)}><span>{item.icon}</span>{item.label}{item.id === "approvals" && approvalPendingForMe > 0 && <b className="nav-count">{approvalPendingForMe}</b>}</button>{item.id === "automation" && automationSections.length > 0 && <div className="generated-nav">{automationSections.map((section) => <button key={section.category} className={page === "automation" && automationCategory === section.category ? "active" : ""} onClick={() => navigateTo("automation", section.category)} title={`${section.events} Events · ${section.workflows} Workflows`}><i /> <span>{section.category}</span><b>{section.count}</b></button>)}</div>}</div>)}</nav>
        <div className="sidebar-bottom"><div className="system-ok"><i className={integration.freeipa.reachable ? "" : "warning"} /> <div><strong>{integration.freeipa.reachable ? "FreeIPA готов" : "Требуется настройка"}</strong><small>{integration.xyops.reachable ? "XYOps также подключён" : "XYOps подключается отдельно"}</small></div></div><p>© 2026 Admin Portal</p></div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div><h1>{page === "overview" ? "Обзор инфраструктуры" : title}</h1><p>{page === "overview" ? "FreeIPA и портал автоматизаций XYOps" : `Управление разделом «${title}»`}</p></div>
          <div className="header-actions"><label className="global-search"><span>⌕</span><input aria-label="Глобальный поиск" placeholder="Поиск процессов, пользователей, групп…" value={query} onChange={(e) => setQuery(e.target.value)} /></label><div className="notification-anchor"><button className={`bell ${notificationsOpen ? "active" : ""}`} aria-label="Уведомления операций" aria-expanded={notificationsOpen} onClick={() => setNotificationsOpen((value) => !value)}>♢{notificationUnread > 0 && <b>{notificationUnread > 99 ? "99+" : notificationUnread}</b>}</button>{notificationsOpen && <NotificationCenter items={notifications} unread={notificationUnread} permission={notificationPermission} close={() => setNotificationsOpen(false)} markAll={() => void updateNotificationReads(null)} enableSystem={() => void enableSystemNotifications()} openItem={(item) => void openPortalNotification(item)} />}</div><button className="profile" title={`Роль: ${portalRoleLabels[integration.access.role]}`}>{integration.viewer.slice(0, 2).toUpperCase()} <span>{integration.viewer}<small>{portalRoleLabels[integration.access.role]}</small></span></button></div>
        </header>

        {page === "overview" && <LegacyOverview goToOperations={() => navigateTo("operations")} integration={integration} userCount={directoryUsers.length} groupCount={directoryGroups.length} directorySource={directorySource} runStats={runStats} recentOperations={<OperationTable rows={recentRuns.slice(0, 4)} />} />}
        {page === "automation" && <AutomationCatalog items={filteredCatalog} sections={automationSections} selectedCategory={automationCategory} mode={catalogMode} meta={catalogMeta} error={catalogError} loading={catalogLoading} recentRuns={recentRuns} canRun={canRunXyops} canManageSettings={canManageSettings} onCategoryChange={(category) => navigateTo("automation", category)} onSync={() => void syncCatalog()} onOpenSettings={() => navigateTo("settings")} onLaunch={(event) => setSelectedProcess({ event, preset: {} })} />}
        {page === "users" && <Users items={filteredUsers} allGroups={directoryGroups} total={directoryUsers.length} source={directorySource} canWrite={canWriteFreeIpa} canDelete={canDeleteFreeIpa} onCreate={() => setFreeIpaAction({ operation: "user_add", title: "Новый пользователь", preset: {} })} onAction={setFreeIpaAction} />}
        {page === "groups" && <Groups items={filteredGroups} allUsers={directoryUsers} source={directorySource} canWrite={canWriteFreeIpa} canDelete={canDeleteFreeIpa} onCreate={() => setFreeIpaAction({ operation: "group_add", title: "Новая группа", preset: {} })} onAction={setFreeIpaAction} />}
        {page === "operations" && <Operations runs={recentRuns} stats={runStats} loading={runsLoading} refresh={() => void loadRuns(true)} onAction={runJobAction} />}
        {page === "approvals" && <Approvals items={approvals} pendingForMe={approvalPendingForMe} loading={approvalsLoading} canApprove={canApproveXyops} refresh={() => void loadApprovals()} onAction={actOnApproval} />}
        {page === "audit" && canManageSettings && <AuditLog />}
        {page === "settings" && canManageSettings && <Settings routes={routes} catalog={catalog} catalogLoading={catalogLoading} onSync={() => void syncCatalog()} onRoutesChange={setRoutes} notify={notify} />}
      </main>

      {freeIpaAction && <FreeIpaActionModal action={freeIpaAction} close={() => setFreeIpaAction(null)} submit={runFreeIpaAction} />}
      {selectedProcess && <ProcessModal event={selectedProcess.event} preset={selectedProcess.preset} close={() => setSelectedProcess(null)} submit={(values, targets) => runProcess(selectedProcess.event, values, targets)} />}
      {toast && <div className="toast"><i />{toast}</div>}
    </div>
  );
}


