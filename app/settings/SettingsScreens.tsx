"use client";

import { useEffect, useState } from "react";
import type { AutomationRoute as SourceAutomationRoute, CatalogEvent, RouteField } from "../../src/automation/automation-types";
import { conditionFieldNames } from "../../src/automation/field-conditions";
import { resolveProcessIconGlyph } from "../shell/home-presentation";

export type AutomationRoute = SourceAutomationRoute & { enabled: boolean; targets: string[]; fields: RouteField[] };
type CatalogHistoryEntry = { id: string; syncedAt: number; processCount: number; changes: { id: string; title: string; kind: "new" | "changed" | "removed" }[] };
type SettingsData = { source: "database" | "environment"; persistenceAvailable: boolean; encryptionConfigured: boolean; updatedAt: number | null; demoMode: boolean; freeipa: { url: string; username: string; passwordConfigured: boolean }; xyops: { url: string; apiKeyConfigured: boolean } };
type PortalRole = "viewer" | "operator" | "approver" | "admin";
type CatalogPolicyRule = { id: string; effect: "allow" | "deny"; users: string[]; groups: string[]; roles: PortalRole[]; categories: string[]; processes: string[] };
type CatalogPolicySet = { version: 1; defaultEffect: "allow" | "deny"; adminBypass: boolean; rules: CatalogPolicyRule[] };
type LocalizedProcessPresentation = { title?: string; description?: string; category?: string; help?: string };
type ProcessPresentationSet = { version: 1; defaultLocale?: string; processes: Record<string, LocalizedProcessPresentation & { icon?: string; order?: number; locales?: Record<string, LocalizedProcessPresentation> }> };

const routeOperations = [
  ["user_add", "Создать пользователя"], ["user_mod", "Редактировать пользователя"], ["user_enable", "Включить пользователя"], ["user_disable", "Отключить пользователя"], ["user_del", "Удалить пользователя"],
  ["group_add", "Создать группу"], ["group_del", "Удалить группу"], ["group_add_member", "Добавить участника"], ["group_remove_member", "Удалить участника"],
] as const;

function Status({ children, tone = "success" }: { children: React.ReactNode; tone?: string }) {
  return <span className={`status ${tone}`}>{children}</span>;
}

function routeSchemaDrift(route: AutomationRoute, event: CatalogEvent | undefined) {
  if (!event) return false;
  if (route.schemaVersion && event.schemaVersion) return route.schemaVersion !== event.schemaVersion;
  return JSON.stringify({ fields: event.fields, targets: event.targets, kind: event.kind }) !== JSON.stringify({ fields: route.fields, targets: route.targets, kind: route.kind });
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


const exampleProcessPresentation: ProcessPresentationSet = {
  version: 1,
  defaultLocale: "ru",
  processes: {
    "database-backup": {
      title: "Резервное копирование БД", category: "Базы данных", icon: "backup", order: 10, help: "Ограничения выполнения настраиваются в XYOps.",
      locales: { en: { title: "Database backup", category: "Databases", help: "Execution limits are configured in XYOps." }, "en-GB": { title: "Database backup (UK)" } },
    },
  },
};

function ProcessPresentationEditor({ catalog, onChanged, notify }: { catalog: CatalogEvent[]; onChanged: () => void; notify: (message: string) => void }) {
  const [adminToken, setAdminToken] = useState(() => typeof window === "undefined" ? "" : window.sessionStorage.getItem("xyops-admin-token") ?? "");
  const [text, setText] = useState(JSON.stringify(exampleProcessPresentation, null, 2));
  const [source, setSource] = useState<"database" | "environment" | "default" | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [availableLocales, setAvailableLocales] = useState<string[]>([]);
  const [busy, setBusy] = useState<"load" | "save" | null>(null);
  async function request(method: "GET" | "PUT") {
    setBusy(method === "GET" ? "load" : "save");
    try {
      const body = method === "PUT" ? JSON.stringify({ metadata: JSON.parse(text) }) : undefined;
      const response = await fetch("/api/integrations/catalog/presentation", { method, headers: { "content-type": "application/json", "x-admin-token": adminToken }, body, cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Не удалось обработать презентационные метаданные");
      window.sessionStorage.setItem("xyops-admin-token", adminToken);
      setText(JSON.stringify(data.metadata, null, 2)); setSource(data.source ?? "default"); setUpdatedAt(data.updatedAt ?? null); setAvailableLocales(Array.isArray(data.availableLocales) ? data.availableLocales : []);
      if (method === "PUT") { onChanged(); notify("Презентационные метаданные сохранены"); }
      else notify("Презентационные метаданные загружены");
    } catch (error) { notify(error instanceof Error ? error.message : "Некорректные метаданные процессов"); }
    finally { setBusy(null); }
  }
  return <section className="panel policy-editor"><div className="panel-title"><div><span className="eyebrow">PROCESS PRESENTATION</span><h2>Многоязычное представление процессов</h2><p>Браузер выбирает локализованные title, description, category и help через Accept-Language. Process ID, schemaVersion, visibility, approval, targets и выполнение остаются под контролем XYOps.</p></div>{source && <Status tone={source === "database" ? "success" : "neutral"}>{source === "database" ? "D1" : source === "environment" ? "ENV" : "XYOps"}</Status>}</div><div className="policy-toolbar"><label>ADMIN_TOKEN<input type="password" value={adminToken} onChange={(event) => setAdminToken(event.target.value)} placeholder="Токен администратора" autoComplete="off" /></label><button className="secondary" disabled={!adminToken || Boolean(busy)} onClick={() => void request("GET")}>{busy === "load" ? "Загрузка…" : "Загрузить"}</button><button className="primary" disabled={!adminToken || Boolean(busy)} onClick={() => void request("PUT")}>{busy === "save" ? "Сохранение…" : "Сохранить представление"}</button></div><textarea className="policy-json" value={text} onChange={(event) => setText(event.target.value)} spellCheck={false} aria-label="JSON презентационных метаданных процессов" /><div className="policy-help"><span>Процессов в текущем каталоге: <b>{catalog.length}</b></span><span>Поля: defaultLocale / locales / title / description / category / help / icon / order</span><span>Языки: <b>{availableLocales.length ? availableLocales.join(", ") : "не заданы"}</b></span><span>{updatedAt ? `Сохранено: ${new Date(updatedAt).toLocaleString("ru-RU")}` : "D1 имеет приоритет над PORTAL_PROCESS_METADATA_JSON"}</span></div></section>;
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

export function Settings({ routes, catalog, catalogLoading, onSync, onRoutesChange, notify }: { routes: AutomationRoute[]; catalog: CatalogEvent[]; catalogLoading: boolean; onSync: () => void; onRoutesChange: (routes: AutomationRoute[]) => void; notify: (message: string) => void }) {
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
    <ApprovalPolicyEditor notify={notify} />
    <ProcessPresentationEditor catalog={catalog} onChanged={onSync} notify={notify} />
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
    <section className="panel catalog-panel"><div className="panel-title"><div><h2>Каталог XYOps</h2><p>Events и Workflows, полученные через get_events API</p></div><button className="secondary" disabled={catalogLoading} onClick={onSync}>{catalogLoading ? "Синхронизация…" : "⟳ Синхронизировать"}</button></div><div className="catalog-stats"><span><b>{catalog.length}</b> всего</span><span><b>{catalog.filter((event) => event.kind === "event").length}</b> Events</span><span><b>{catalog.filter((event) => event.kind === "workflow").length}</b> Workflows</span><span><b>{catalog.reduce((sum, event) => sum + event.fields.length, 0)}</b> пользовательских полей</span></div><div className="catalog-grid">{catalog.map((event) => <article key={event.id}><span className={`route-kind ${event.kind}`}>{resolveProcessIconGlyph(event.icon, event.kind)}</span><div><strong>{event.title}</strong><code>{event.id}</code><small>{event.category}{event.plugin ? ` · ${event.plugin}` : ""}</small></div><Status tone="neutral">{event.schemaVersion ?? "legacy"}</Status><Status tone={event.kind === "workflow" ? "violet" : "success"}>{event.fields.length} полей</Status></article>)}</div>{!catalogLoading && !catalog.length && <div className="catalog-empty"><strong>Каталог пуст</strong><span>Сохраните подключение XYOps или включите DEMO_MODE явно.</span></div>}</section>
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
