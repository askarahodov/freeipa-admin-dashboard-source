"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AutomationRoute as SourceAutomationRoute, CatalogEvent, RouteField } from "../automation-types";

type Page = "overview" | "automation" | "users" | "groups" | "operations" | "settings";
type AutomationRoute = SourceAutomationRoute & { enabled: boolean; targets: string[]; fields: RouteField[] };
type RunStatus = "queued" | "running" | "success" | "failed" | "unknown";
type RunRecord = { id: string; jobId: string; eventId: string; title: string; kind: "event" | "workflow"; mode: "demo" | "live"; status: RunStatus; actor: string; subject: string; error: string | null; startedAt: number; updatedAt: number; completedAt: number | null };
type RunStats = { today: number; queued: number; success: number; failed: number };
type DirectoryUser = { uid: string; name: string; email: string; groups: number; active: boolean };
type DirectoryGroup = { name: string; description: string; members: number; type: string };
type IntegrationMode = "demo" | "live" | "unconfigured";
type SettingsData = { source: "database" | "environment"; persistenceAvailable: boolean; encryptionConfigured: boolean; updatedAt: number | null; demoMode: boolean; freeipa: { url: string; username: string; passwordConfigured: boolean }; xyops: { url: string; apiKeyConfigured: boolean } };

const nav: { id: Page; label: string; icon: string }[] = [
  { id: "overview", label: "Обзор", icon: "⌂" },
  { id: "automation", label: "Автоматизация", icon: "⌘" },
  { id: "users", label: "Пользователи", icon: "♙" },
  { id: "groups", label: "Группы", icon: "♧" },
  { id: "operations", label: "Операции", icon: "◷" },
  { id: "settings", label: "Настройки", icon: "⚙" },
];

const demoUsers: DirectoryUser[] = [
  { uid: "jpetrov", name: "Петров Иван", email: "j.petrov@company.local", groups: 4, active: true },
  { uid: "mivanova", name: "Иванова Мария", email: "m.ivanova@company.local", groups: 3, active: true },
  { uid: "asmirnov", name: "Смирнов Алексей", email: "a.smirnov@company.local", groups: 2, active: false },
  { uid: "ekuznetsova", name: "Кузнецова Елена", email: "e.kuznetsova@company.local", groups: 5, active: true },
  { uid: "dvolkov", name: "Волков Дмитрий", email: "d.volkov@company.local", groups: 1, active: true },
];

const demoGroups: DirectoryGroup[] = [
  { name: "developers", description: "Команда разработки", members: 38, type: "POSIX" },
  { name: "devops", description: "Инфраструктура и эксплуатация", members: 12, type: "POSIX" },
  { name: "security", description: "Информационная безопасность", members: 8, type: "POSIX" },
  { name: "marketing", description: "Отдел маркетинга", members: 21, type: "Non-POSIX" },
];

function Status({ children, tone = "success" }: { children: React.ReactNode; tone?: string }) {
  return <span className={`status ${tone}`}>{children}</span>;
}

export default function Home() {
  const [page, setPage] = useState<Page>("overview");
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState<"user" | "group" | null>(null);
  const [toast, setToast] = useState("");
  const [integration, setIntegration] = useState<{ mode: IntegrationMode; viewer: string; freeipa: { reachable: boolean }; xyops: { reachable: boolean } }>({ mode: "unconfigured", viewer: "Пользователь", freeipa: { reachable: false }, xyops: { reachable: false } });
  const [routes, setRoutes] = useState<AutomationRoute[]>([]);
  const [catalog, setCatalog] = useState<CatalogEvent[]>([]);
  const [catalogMode, setCatalogMode] = useState<IntegrationMode>("unconfigured");
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [selectedProcess, setSelectedProcess] = useState<CatalogEvent | null>(null);
  const [recentRuns, setRecentRuns] = useState<RunRecord[]>([]);
  const [runStats, setRunStats] = useState<RunStats>({ today: 0, queued: 0, success: 0, failed: 0 });
  const [runsLoading, setRunsLoading] = useState(false);
  const [directoryUsers, setDirectoryUsers] = useState<DirectoryUser[]>([]);
  const [directoryGroups, setDirectoryGroups] = useState<DirectoryGroup[]>([]);
  const [directorySource, setDirectorySource] = useState<"demo" | "live" | "unconfigured">("unconfigured");

  useEffect(() => {
    fetch("/api/integrations/status", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data) => setIntegration(data))
      .catch(() => setIntegration({ mode: "unconfigured", viewer: "Пользователь", freeipa: { reachable: false }, xyops: { reachable: false } }));
    fetch("/api/integrations/routes", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data) => Array.isArray(data.routes) && setRoutes(data.routes))
      .catch(() => setRoutes([]));
    fetch("/api/integrations/catalog", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data) => { setCatalog(Array.isArray(data.events) ? data.events : []); setCatalogMode(data.mode === "live" || data.mode === "demo" ? data.mode : "unconfigured"); })
      .catch(() => setCatalog([]));
  }, []);

  useEffect(() => {
    if (integration.mode === "demo") {
      Promise.resolve().then(() => { setDirectoryUsers(demoUsers); setDirectoryGroups(demoGroups); setDirectorySource("demo"); });
      return;
    }
    if (!integration.freeipa.reachable) {
      Promise.resolve().then(() => { setDirectoryUsers([]); setDirectoryGroups([]); setDirectorySource("unconfigured"); });
      return;
    }
    let cancelled = false;
    Promise.all([
      fetch("/api/integrations/users", { cache: "no-store" }),
      fetch("/api/integrations/groups", { cache: "no-store" }),
    ]).then(async ([usersResponse, groupsResponse]) => {
      if (!usersResponse.ok || !groupsResponse.ok) throw new Error("FreeIPA data request failed");
      const [usersPayload, groupsPayload] = await Promise.all([usersResponse.json(), groupsResponse.json()]);
      if (cancelled) return;
      setDirectoryUsers(Array.isArray(usersPayload.users) ? usersPayload.users : []);
      setDirectoryGroups(Array.isArray(groupsPayload.groups) ? groupsPayload.groups : []);
      setDirectorySource("live");
    }).catch(() => {
      if (cancelled) return;
      setDirectoryUsers([]);
      setDirectoryGroups([]);
      setDirectorySource("unconfigured");
    });
    return () => { cancelled = true; };
  }, [integration.freeipa.reachable, integration.mode]);

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
    setCatalogLoading(true);
    try {
      const response = await fetch("/api/integrations/catalog", { cache: "no-store" });
      if (!response.ok) throw new Error();
      const data = await response.json();
      setCatalog(Array.isArray(data.events) ? data.events : []);
      setCatalogMode(data.mode === "live" || data.mode === "demo" ? data.mode : "unconfigured");
    } catch {
      setCatalog([]);
      notify("Не удалось синхронизировать каталог XYOps");
    } finally {
      setCatalogLoading(false);
    }
  }

  const title = nav.find((item) => item.id === page)?.label ?? "Обзор";
  const filteredUsers = useMemo(() => directoryUsers.filter((u) => `${u.uid} ${u.name} ${u.email}`.toLowerCase().includes(query.toLowerCase())), [directoryUsers, query]);
  const filteredGroups = useMemo(() => directoryGroups.filter((g) => `${g.name} ${g.description} ${g.type}`.toLowerCase().includes(query.toLowerCase())), [directoryGroups, query]);
  const filteredCatalog = useMemo(() => catalog.filter((event) => `${event.title} ${event.description} ${event.category} ${event.plugin ?? ""}`.toLowerCase().includes(query.toLowerCase())), [catalog, query]);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }

  async function queueAction(operation: string, payload: Record<string, string>) {
    try {
      const response = await fetch("/api/integrations/actions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation, ...payload }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      await loadRuns(false);
      notify(result.mode === "live" ? "Задание отправлено в XYOps" : `Демо-задание создано: ${result.jobId}`);
    } catch (error) {
      await loadRuns(false);
      notify(error instanceof Error ? error.message : "Не удалось отправить задание");
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

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">◇</span><div><strong>FreeIPA Admin</strong><small>XYOps</small></div></div>
        <nav>{nav.map((item) => <button key={item.id} className={page === item.id ? "active" : ""} onClick={() => { setPage(item.id); setQuery(""); }}><span>{item.icon}</span>{item.label}</button>)}</nav>
        <div className="sidebar-bottom"><div className="system-ok"><i className={integration.freeipa.reachable && integration.xyops.reachable ? "" : "warning"} /> <div><strong>{integration.freeipa.reachable && integration.xyops.reachable ? "Система в норме" : "Требуется настройка"}</strong><small>{integration.freeipa.reachable && integration.xyops.reachable ? "FreeIPA и XYOps доступны" : "Проверьте подключения"}</small></div></div><p>© 2026 XYOps</p></div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div><h1>{page === "overview" ? "Обзор инфраструктуры" : title}</h1><p>{page === "overview" ? "Управление FreeIPA через XYOps" : `Управление разделом «${title}»`}</p></div>
          <div className="header-actions"><label className="global-search"><span>⌕</span><input aria-label="Глобальный поиск" placeholder="Поиск процессов, пользователей, групп…" value={query} onChange={(e) => setQuery(e.target.value)} /></label><button className="bell" aria-label="Ошибки операций" onClick={() => notify(runStats.failed ? `Ошибок сегодня: ${runStats.failed}` : "Новых ошибок нет")}>♢{runStats.failed > 0 && <b>{runStats.failed}</b>}</button><button className="profile">{integration.viewer.slice(0, 2).toUpperCase()} <span>{integration.viewer}</span></button></div>
        </header>

        {page === "overview" && <Overview goTo={setPage} integration={integration} userCount={directoryUsers.length} groupCount={directoryGroups.length} directorySource={directorySource} runs={recentRuns} runStats={runStats} />}
        {page === "automation" && <AutomationCatalog items={filteredCatalog} mode={catalogMode} loading={catalogLoading} recentRuns={recentRuns} onSync={() => void syncCatalog()} onLaunch={setSelectedProcess} />}
        {page === "users" && <Users items={filteredUsers} total={directoryUsers.length} source={directorySource} onCreate={() => setModal("user")} />}
        {page === "groups" && <Groups items={filteredGroups} source={directorySource} onCreate={() => setModal("group")} />}
        {page === "operations" && <Operations runs={recentRuns} stats={runStats} loading={runsLoading} refresh={() => void loadRuns(true)} />}
        {page === "settings" && <Settings routes={routes} catalog={catalog} catalogLoading={catalogLoading} onSync={() => void syncCatalog()} notify={notify} />}
      </main>

      {modal && <Modal type={modal} routes={routes} close={() => setModal(null)} submit={(message, payload) => { setModal(null); if (payload) void queueAction(payload.operation, payload.data); else notify(message); }} />}
      {selectedProcess && <ProcessModal event={selectedProcess} close={() => setSelectedProcess(null)} submit={(values, targets) => runProcess(selectedProcess, values, targets)} />}
      {toast && <div className="toast"><i />{toast}</div>}
    </div>
  );
}

function Overview({ goTo, integration, userCount, groupCount, directorySource, runs, runStats }: { goTo: (page: Page) => void; integration: { mode: IntegrationMode; freeipa: { reachable: boolean }; xyops: { reachable: boolean } }; userCount: number; groupCount: number; directorySource: "demo" | "live" | "unconfigured"; runs: RunRecord[]; runStats: RunStats }) {
  return <div className="content-stack">
    <section className="metrics">
      <Metric icon="♙" label="Пользователи" value={userCount.toLocaleString("ru-RU")} delta={directorySource === "live" ? "FreeIPA" : directorySource === "demo" ? "Демо" : "Не настроено"} color="violet" />
      <Metric icon="♣" label="Группы" value={groupCount.toLocaleString("ru-RU")} delta={directorySource === "live" ? "FreeIPA" : directorySource === "demo" ? "Демо" : "Не настроено"} color="blue" />
      <Metric icon="⌁" label="Активные операции" value={String(runStats.queued)} delta="сегодня" color="teal" />
      <Metric icon="△" label="Ошибки сегодня" value={String(runStats.failed)} delta="журнал XYOps" color="red" />
    </section>
    <section className="panel connections"><h2>Состояние подключения</h2><div className="connection-grid">
      <div className="service"><span className="service-icon teal">▤</span><div><h3><i className={`dot ${integration.freeipa.reachable ? "green" : "amber"}`} />FreeIPA {integration.freeipa.reachable ? "подключён" : integration.mode === "demo" ? "демо-режим" : "не настроен"}</h3><small>Источник данных</small><strong>{integration.freeipa.reachable ? "Сохранённая конфигурация" : integration.mode === "demo" ? "Демонстрационные данные" : "Требуется настройка"}</strong></div></div>
      <div className="pulse"><span><i className={`dot ${integration.freeipa.reachable ? "teal-dot" : "amber"}`} /> {integration.freeipa.reachable ? "LIVE" : integration.mode === "demo" ? "DEMO" : "OFF"}</span><b>⌁⌁⌁⌁</b><small>Проверено автоматически</small></div>
      <div className="service"><span className="service-icon violet">⚙</span><div><h3><i className={`dot ${integration.xyops.reachable ? "violet-dot" : "amber"}`} />XYOps {integration.xyops.reachable ? "подключён" : integration.mode === "demo" ? "демо-режим" : "не настроен"}</h3><small>Исполнение операций</small><strong>{integration.xyops.reachable ? "Задания отправляются" : integration.mode === "demo" ? "Без внешних изменений" : "Требуется настройка"}</strong></div></div>
      <div className="pulse purple"><span><i className={`dot ${integration.xyops.reachable ? "violet-dot" : "amber"}`} /> {integration.xyops.reachable ? "LIVE" : integration.mode === "demo" ? "DEMO" : "OFF"}</span><b>⌁⌁⌁⌁</b><small>Проверено автоматически</small></div>
    </div></section>
    <section className="panel table-panel"><div className="panel-title"><h2>Последние операции</h2><button onClick={() => goTo("operations")}>Смотреть все операции →</button></div><OperationTable rows={runs.slice(0, 4)} /></section>
  </div>;
}

function Metric({ icon, label, value, delta, color }: { icon: string; label: string; value: string; delta: string; color: string }) {
  return <article className="metric"><div className={`metric-icon ${color}`}>{icon}</div><div><span>{label}</span><strong>{value}</strong></div><small className={color === "red" ? "down" : "up"}>{delta} <em>{color === "red" ? "по сравнению со вчера" : "за 7 дней"}</em></small></article>;
}

function Users({ items, total, source, onCreate }: { items: DirectoryUser[]; total: number; source: "demo" | "live" | "unconfigured"; onCreate: () => void }) {
  const [filter, setFilter] = useState<"all" | "active" | "disabled">("all");
  const visible = items.filter((user) => filter === "all" || (filter === "active" ? user.active : !user.active));
  return <section className="panel table-panel section-page"><div className="panel-title"><div><h2>Пользователи FreeIPA</h2><p>{`${visible.length} из ${total} учетных записей · ${source === "live" ? "данные FreeIPA" : source === "demo" ? "демо-данные" : "FreeIPA не настроен"}`}</p></div><button className="primary" disabled={source === "unconfigured"} onClick={onCreate}>＋ Создать пользователя</button></div><div className="filter-row"><button className={`filter ${filter === "all" ? "active-filter" : ""}`} onClick={() => setFilter("all")}>Все</button><button className={`filter ${filter === "active" ? "active-filter" : ""}`} onClick={() => setFilter("active")}>Активные</button><button className={`filter ${filter === "disabled" ? "active-filter" : ""}`} onClick={() => setFilter("disabled")}>Отключённые</button></div><div className="data-table"><div className="tr th users-row"><span>Пользователь</span><span>Логин</span><span>Группы</span><span>Статус</span><span /></div>{visible.map((u) => <div className="tr users-row" key={u.uid}><span className="person"><b>{u.name.split(" ").map(x => x[0]).join("")}</b><span><strong>{u.name}</strong><small>{u.email}</small></span></span><span className="mono">{u.uid}</span><span>{u.groups}</span><span><Status tone={u.active ? "success" : "neutral"}>{u.active ? "Активен" : "Отключён"}</Status></span><span className="row-actions"><Status tone="neutral">Только чтение</Status></span></div>)}</div>{source === "unconfigured" && <div className="catalog-empty"><strong>FreeIPA не настроен</strong><span>Сохраните подключение в разделе «Настройки».</span></div>}</section>;
}

function Groups({ items, source, onCreate }: { items: DirectoryGroup[]; source: "demo" | "live" | "unconfigured"; onCreate: () => void }) {
  return <div className="content-stack"><div className="page-tools"><div><h2>Группы доступа</h2><p>{`${items.length} групп · ${source === "live" ? "данные FreeIPA" : source === "demo" ? "демо-данные" : "FreeIPA не настроен"}`}</p></div><button className="primary" disabled={source === "unconfigured"} onClick={onCreate}>＋ Создать группу</button></div>{source === "unconfigured" ? <section className="panel catalog-empty"><strong>FreeIPA не настроен</strong><span>Сохраните подключение в разделе «Настройки».</span></section> : <section className="group-grid">{items.map((g, i) => <article className="group-card" key={g.name}><div className={`group-avatar c${i % 4}`}>♣</div><h3>{g.name}</h3><p>{g.description}</p><div><span><strong>{g.members}</strong><small>участников</small></span><Status tone="violet">{g.type}</Status></div><span className="settings-note">Управление участниками будет доступно через маршрут XYOps</span></article>)}</section>}</div>;
}

function AutomationCatalog({ items, mode, loading, recentRuns, onSync, onLaunch }: { items: CatalogEvent[]; mode: IntegrationMode; loading: boolean; recentRuns: RunRecord[]; onSync: () => void; onLaunch: (event: CatalogEvent) => void }) {
  const categories = new Set(items.map((event) => event.category)).size;
  return <div className="content-stack automation-page">
    <section className="automation-hero"><div><span className="eyebrow">XYOPS SELF-SERVICE</span><h2>Каталог рабочих процессов</h2><p>Формы создаются автоматически из полей Events и Workflows. Новые процессы появляются после синхронизации без изменения кода.</p></div><button className="secondary" disabled={loading} onClick={onSync}>{loading ? "Синхронизация…" : "⟳ Обновить каталог"}</button></section>
    <section className="catalog-summary"><article><span>⌘</span><div><strong>{items.length}</strong><small>доступных процессов</small></div></article><article><span>▦</span><div><strong>{categories}</strong><small>категорий</small></div></article><article><span>◇</span><div><strong>{items.reduce((sum, event) => sum + event.fields.length, 0)}</strong><small>динамических полей</small></div></article><article><span className={`source-dot ${mode}`} /><div><strong>{mode === "live" ? "LIVE" : mode === "demo" ? "DEMO" : "OFF"}</strong><small>источник каталога</small></div></article></section>
    <div className="automation-layout"><section className="process-grid">{items.map((event) => <article className="process-card" key={event.id}><div className="process-top"><span className={`route-kind ${event.kind}`}>{event.kind === "workflow" ? "⌘" : "▶"}</span><div><Status tone={event.kind === "workflow" ? "violet" : "success"}>{event.kind === "workflow" ? "Workflow" : "Event"}</Status>{event.dangerous && <Status tone="warning">Подтверждение</Status>}</div></div><small className="process-category">{event.category}{event.plugin ? ` · ${event.plugin}` : ""}</small><h3>{event.title}</h3><p>{event.description || "Описание будет загружено из XYOps."}</p><div className="process-meta"><span>{event.fields.length} полей</span><span>{event.targets.length ? `${event.targets.length} targets` : "Targets из XYOps"}</span></div><button className="primary" disabled={!event.enabled} onClick={() => onLaunch(event)}>Сформировать и запустить →</button></article>)}</section><aside className="runs-panel panel"><div><h3>Последние запуски</h3><small>Постоянный журнал D1</small></div>{recentRuns.length ? recentRuns.slice(0, 6).map((run) => <article key={run.id}><i className={run.status} /><div><strong>{run.title}</strong><small>{formatDateTime(run.startedAt)} · {run.kind}</small><code>{run.jobId}</code></div><RunStatusBadge status={run.status} /></article>) : <div className="runs-empty"><span>◷</span><strong>Запусков пока нет</strong><small>Выберите процесс из каталога</small></div>}</aside></div>
    {!loading && !items.length && <section className="panel catalog-empty"><strong>Процессы не найдены</strong><span>Проверьте подключение XYOps или измените поисковый запрос.</span></section>}
  </div>;
}

function Operations({ runs, stats, loading, refresh }: { runs: RunRecord[]; stats: RunStats; loading: boolean; refresh: () => void }) { return <section className="panel table-panel section-page"><div className="panel-title"><div><h2>Журнал операций XYOps</h2><p>Постоянная история запусков и актуальные состояния заданий</p></div><button className="secondary" disabled={loading} onClick={refresh}>{loading ? "Обновление…" : "⟳ Обновить"}</button></div><div className="stats-strip"><span><b>{stats.today}</b> операций сегодня</span><span><i className="dot green" /><b>{stats.success}</b> успешно</span><span><i className="dot amber" /><b>{stats.queued}</b> выполняются</span><span><i className="dot red-dot" /><b>{stats.failed}</b> ошибки</span></div><OperationTable rows={runs} detailed /></section>; }

function formatDateTime(value: number) { return value ? new Date(value).toLocaleString("ru-RU") : "—"; }

function RunStatusBadge({ status }: { status: RunStatus }) {
  const labels: Record<RunStatus, string> = { queued: "В очереди", running: "Выполняется", success: "Успешно", failed: "Ошибка", unknown: "Неизвестно" };
  const tones: Record<RunStatus, string> = { queued: "warning", running: "violet", success: "success", failed: "error", unknown: "neutral" };
  return <Status tone={tones[status]}>{labels[status]}</Status>;
}

function OperationTable({ rows, detailed = false }: { rows: RunRecord[]; detailed?: boolean }) {
  return <div className="data-table"><div className={`tr th ${detailed ? "ops-detailed" : "ops-row"}`}><span>Операция</span><span>Объект</span><span>Статус</span><span>Инициатор</span><span>Время</span>{detailed && <span>Job</span>}</div>{rows.map((run) => <div className={`tr ${detailed ? "ops-detailed" : "ops-row"}`} key={run.id} title={run.error ?? ""}><span className="operation"><i className={run.status}>↗</i>{run.title}</span><span>{run.subject}</span><span><RunStatusBadge status={run.status} /></span><span>{run.actor}</span><span><strong>{new Date(run.startedAt).toLocaleTimeString("ru-RU")}</strong><small>{new Date(run.startedAt).toLocaleDateString("ru-RU")}</small></span>{detailed && <span className="mono">{run.jobId}</span>}</div>)}{!rows.length && <div className="catalog-empty"><strong>Операций пока нет</strong><span>Запуски Events и Workflows появятся здесь автоматически.</span></div>}</div>;
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
      <section className="panel settings-card"><div className="settings-head"><span className="service-icon teal">▤</span><div><h2>FreeIPA — чтение</h2><p>JSON-RPC с серверными учётными данными</p></div><Status tone={tests.freeipa ? "success" : "neutral"}>{tests.freeipa ?? "Не проверено"}</Status></div><label>Адрес сервера<input value={draft.ipaUrl} onChange={(event) => setDraft({ ...draft, ipaUrl: event.target.value })} placeholder="https://ipa.company.local" /></label><label>Service account<input value={draft.ipaUsername} onChange={(event) => setDraft({ ...draft, ipaUsername: event.target.value })} placeholder="xyops-freeipa-reader" /></label><label>Пароль<input type="password" value={draft.ipaPassword} onChange={(event) => setDraft({ ...draft, ipaPassword: event.target.value })} placeholder={settings.freeipa.passwordConfigured ? "Сохранён — оставьте пустым без изменений" : "Введите пароль"} autoComplete="new-password" /></label><p className="settings-note">Пароль шифруется AES-GCM перед записью. Пустое поле сохраняет текущий пароль.</p><button className="secondary" disabled={Boolean(busy)} onClick={() => void testConnection("freeipa")}>{busy === "freeipa" ? "Проверка…" : "Проверить FreeIPA"}</button></section>
      <section className="panel settings-card"><div className="settings-head"><span className="service-icon violet">⚙</span><div><h2>XYOps — выполнение</h2><p>Каталог Events и запуск Workflows</p></div><Status tone={tests.xyops ? "success" : "neutral"}>{tests.xyops ?? "Не проверено"}</Status></div><label>Адрес XYOps<input value={draft.xyopsUrl} onChange={(event) => setDraft({ ...draft, xyopsUrl: event.target.value })} placeholder="https://xyops.company.local" /></label><label>API Key<input type="password" value={draft.xyopsApiKey} onChange={(event) => setDraft({ ...draft, xyopsApiKey: event.target.value })} placeholder={settings.xyops.apiKeyConfigured ? "Сохранён — оставьте пустым без изменений" : "Введите API Key"} autoComplete="new-password" /></label><p className="settings-note">API Key никогда не возвращается в браузер. Тест выполняет read-only запрос каталога.</p><button className="secondary" disabled={Boolean(busy)} onClick={() => void testConnection("xyops")}>{busy === "xyops" ? "Проверка…" : "Проверить XYOps"}</button></section>
    </div><section className="panel settings-savebar"><div><strong>Сохранение в persistent storage</strong><span>Настройки переживут перезапуск контейнера при подключённом volume.</span></div><button className="primary" disabled={Boolean(busy) || !settings.persistenceAvailable || !settings.encryptionConfigured} onClick={() => void saveSettings()}>{busy === "save" ? "Сохранение…" : "Сохранить настройки"}</button></section></>}
  </>;
}

function Settings({ routes, catalog, catalogLoading, onSync, notify }: { routes: AutomationRoute[]; catalog: CatalogEvent[]; catalogLoading: boolean; onSync: () => void; notify: (message: string) => void }) {
  const [expanded, setExpanded] = useState<string | null>(routes[0]?.key ?? null);
  return <div className="settings-page">
    <PersistentConnectionSettings notify={notify} />
    <section className="panel inspector-panel"><span className="service-icon violet">◇</span><div><span className="eyebrow">CONTRACT INSPECTOR</span><h2>Проверка реальной схемы XYOps</h2><p>Read-only утилита собирает структуру Events, Workflows, Toolsets, targets и jobs, удаляя ключ API, заголовки, сырые ответы и секретные значения.</p></div><code>npm run inspect:xyops</code><Status tone="neutral">Запуск локально</Status></section>
    <section className="panel routes-panel"><div className="panel-title"><div><h2>Маршруты автоматизации</h2><p>Маршруты из серверной переменной XYOPS_ROUTES_JSON</p></div><Status tone="neutral">Только чтение</Status></div>
      <div className="route-list">{routes.map((route) => <article className={`route-card ${expanded === route.key ? "expanded" : ""}`} key={route.key}>
        <button className="route-main" onClick={() => setExpanded(expanded === route.key ? null : route.key)}><span className={`route-kind ${route.kind}`}>{route.kind === "workflow" ? "⌘" : "▶"}</span><span><strong>{route.title}</strong><small>{route.operation}</small></span><Status tone={route.kind === "workflow" ? "violet" : "success"}>{route.kind === "workflow" ? "Workflow" : "Event"}</Status><code>{route.eventId}</code><b>{route.enabled ? "Включён" : "Отключён"}</b><i>{expanded === route.key ? "⌃" : "⌄"}</i></button>
        {expanded === route.key && <div className="route-details"><div><h4>Пользовательские переменные</h4><div className="variable-table"><div className="variable-row head"><span>Поле</span><span>Тип</span><span>Передача</span><span>Обязательное</span></div>{route.fields.map((field) => <div className="variable-row" key={field.key}><span><strong>{field.label}</strong><code>{field.key}</code></span><span>{field.type}</span><span><Status tone="neutral">{field.target ?? "params"}</Status></span><span>{field.required ? "Да" : "Нет"}</span></div>)}</div></div><aside><h4>Параметры запуска</h4><p><span>Event ID</span><code>{route.eventId}</code></p><p><span>Targets</span><strong>{route.targets.length ? route.targets.join(", ") : "из Event"}</strong></p><small>Изменения выполняются в серверной конфигурации.</small></aside></div>}
      </article>)}</div>
      <div className="routes-footer"><span>Конфигурация хранится на сервере в <code>XYOPS_ROUTES_JSON</code>. Интерфейс не получает API Key.</span></div>
    </section>
    <section className="panel catalog-panel"><div className="panel-title"><div><h2>Каталог XYOps</h2><p>Events и Workflows, полученные через get_events API</p></div><button className="secondary" disabled={catalogLoading} onClick={onSync}>{catalogLoading ? "Синхронизация…" : "⟳ Синхронизировать"}</button></div><div className="catalog-stats"><span><b>{catalog.length}</b> всего</span><span><b>{catalog.filter((event) => event.kind === "event").length}</b> Events</span><span><b>{catalog.filter((event) => event.kind === "workflow").length}</b> Workflows</span><span><b>{catalog.reduce((sum, event) => sum + event.fields.length, 0)}</b> пользовательских полей</span></div><div className="catalog-grid">{catalog.map((event) => <article key={event.id}><span className={`route-kind ${event.kind}`}>{event.kind === "workflow" ? "⌘" : "▶"}</span><div><strong>{event.title}</strong><code>{event.id}</code><small>{event.category}{event.plugin ? ` · ${event.plugin}` : ""}</small></div><Status tone={event.kind === "workflow" ? "violet" : "success"}>{event.fields.length} полей</Status></article>)}</div>{!catalogLoading && !catalog.length && <div className="catalog-empty"><strong>Каталог пуст</strong><span>Сохраните подключение XYOps или включите DEMO_MODE явно.</span></div>}</section>
  </div>;
}

function Modal({ type, routes, close, submit }: { type: "user" | "group"; routes: AutomationRoute[]; close: () => void; submit: (s: string, payload?: { operation: string; data: Record<string, string> }) => void }) {
  const isUser = type === "user";
  const operation = isUser ? "user_add" : "group_add";
  const availableRoutes = routes.filter((route) => route.operation === operation && route.enabled);
  const [selectedKey, setSelectedKey] = useState(availableRoutes[0]?.key ?? "");
  const selectedRoute = availableRoutes.find((route) => route.key === selectedKey) ?? availableRoutes[0];
  return <div className="modal-backdrop"><form className="modal dynamic-modal" onSubmit={(e) => { e.preventDefault(); const form = new FormData(e.currentTarget); const data = Object.fromEntries(Array.from(form.entries()).map(([key, value]) => [key, String(value)])); submit("", { operation, data }); }}><button type="button" className="modal-x" onClick={close}>×</button><h2>{isUser ? "Новый пользователь" : "Новая группа"}</h2><p>Форма сформирована из схемы выбранного маршрута XYOps.</p><label>Маршрут автоматизации<select name="routeKey" value={selectedRoute?.key ?? ""} onChange={(event) => setSelectedKey(event.target.value)}>{availableRoutes.map((route) => <option key={route.key} value={route.key}>{route.title} · {route.kind === "workflow" ? "Workflow" : "Event"}</option>)}</select></label>{selectedRoute ? <><div className="selected-route"><span className={`route-kind ${selectedRoute.kind}`}>{selectedRoute.kind === "workflow" ? "⌘" : "▶"}</span><div><strong>{selectedRoute.title}</strong><code>{selectedRoute.eventId}</code></div><Status tone={selectedRoute.kind === "workflow" ? "violet" : "success"}>{selectedRoute.fields.length} полей</Status></div><div className="dynamic-fields" key={selectedRoute.key}>{selectedRoute.fields.map((field) => <DynamicField field={field} key={field.key} />)}</div></> : <div className="catalog-empty"><strong>Нет доступного маршрута</strong><span>Создайте привязку для операции {operation}.</span></div>}<div className="modal-actions"><button type="button" className="secondary" onClick={close}>Отмена</button><button className="primary" disabled={!selectedRoute}>Запустить</button></div></form></div>;
}

function ProcessModal({ event, close, submit }: { event: CatalogEvent; close: () => void; submit: (values: Record<string, unknown>, targets: string[]) => Promise<boolean> }) {
  const [submitting, setSubmitting] = useState(false);
  return <div className="modal-backdrop"><form className="modal process-modal" onSubmit={async (formEvent) => { formEvent.preventDefault(); setSubmitting(true); const form = new FormData(formEvent.currentTarget); const values: Record<string, unknown> = {}; for (const field of event.fields) { if (field.type === "boolean") values[field.key] = form.has(field.key); else if (field.type === "multiselect") values[field.key] = form.getAll(field.key).map(String); else values[field.key] = String(form.get(field.key) ?? ""); } const succeeded = await submit(values, form.getAll("__targets").map(String)); if (!succeeded) setSubmitting(false); }}><button type="button" className="modal-x" onClick={close}>×</button><div className="process-modal-head"><span className={`route-kind ${event.kind}`}>{event.kind === "workflow" ? "⌘" : "▶"}</span><div><span className="eyebrow">{event.category} · {event.kind}</span><h2>{event.title}</h2><p>{event.description || "Параметры процесса загружены из XYOps."}</p></div></div><div className="schema-note"><span>◇</span><div><strong>Форма сгенерирована автоматически</strong><small>{event.fields.length} полей из схемы XYOps · ID: {event.id}</small></div></div>{event.targets.length > 0 && <label>Целевые системы{event.targets.length > 1 && <em>можно выбрать несколько</em>}<select name="__targets" multiple={event.targets.length > 1} required defaultValue={event.targets.length === 1 ? [event.targets[0]] : []}>{event.targets.map((target) => <option key={target} value={target}>{target}</option>)}</select><small>targets → run_event</small></label>}<div className="dynamic-fields">{event.fields.map((field) => <DynamicField field={field} key={field.key} />)}</div>{event.dangerous && <label className="checkbox-field danger-confirm"><input type="checkbox" required /><span><strong>Подтверждаю выполнение потенциально опасной операции</strong><small>XYOps получит команду только после подтверждения</small></span></label>}<div className="modal-actions"><button type="button" className="secondary" onClick={close}>Отмена</button><button className="primary" disabled={submitting}>{submitting ? "Отправка…" : `Запустить ${event.kind === "workflow" ? "Workflow" : "Event"}`}</button></div></form></div>;
}

function DynamicField({ field }: { field: RouteField }) {
  if (field.type === "boolean") return <label className="checkbox-field"><input name={field.key} type="checkbox" defaultChecked={field.default === true || field.default === "true"} /><span><strong>{field.label}</strong><small>{field.key} · {field.target ?? "params"}</small></span></label>;
  if (field.type === "select") return <label>{field.label}{field.required && <em>обязательно</em>}<select name={field.key} required={field.required} defaultValue={String(field.default ?? field.options?.[0] ?? "")}><option value="" disabled>Выберите значение</option>{(field.options ?? []).map((option) => <option value={option} key={option}>{option}</option>)}</select><small>{field.description || `${field.key} → ${field.target ?? "params"}`}</small></label>;
  if (field.type === "multiselect") return <label>{field.label}{field.required && <em>обязательно</em>}<select name={field.key} multiple required={field.required} defaultValue={Array.isArray(field.default) ? field.default : []}>{(field.options ?? []).map((option) => <option value={option} key={option}>{option}</option>)}</select><small>{field.description || `${field.key} → ${field.target ?? "params"}`}</small></label>;
  if (field.type === "textarea" || field.type === "json") return <label className="field-wide">{field.label}{field.required && <em>обязательно</em>}<textarea name={field.key} required={field.required} defaultValue={field.default === undefined ? "" : typeof field.default === "string" ? field.default : JSON.stringify(field.default, null, 2)} placeholder={field.placeholder || (field.type === "json" ? "{ }" : field.key)} /><small>{field.description || `${field.key} → ${field.target ?? "params"}`}</small></label>;
  const inputType = field.type === "number" ? "number" : field.type === "password" ? "password" : field.type === "date" ? "date" : field.type === "datetime" ? "datetime-local" : "text";
  return <label>{field.label}{field.required && <em>обязательно</em>}<input name={field.key} type={inputType} required={field.required} min={field.min} max={field.max} defaultValue={field.default === undefined ? "" : String(field.default)} placeholder={field.placeholder || field.key} autoComplete={field.type === "password" ? "new-password" : undefined} /><small>{field.description || `${field.key} → ${field.target ?? "params"}`}</small></label>;
}
