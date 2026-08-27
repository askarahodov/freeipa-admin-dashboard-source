"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { FreeIpaDirectoryUser, FreeIpaSortDirection, FreeIpaUserSort, FreeIpaUserStatus } from "../src/freeipa/freeipa-user-query";
import { FREEIPA_DIRECTORY_CHANGED_EVENT, announceFreeIpaDirectoryChanged, loadFreeIpaAccess, openFreeIpaAction } from "../src/freeipa/freeipa-ui-events";

type QueryState = {
  q: string;
  status: FreeIpaUserStatus;
  group: string;
  sort: FreeIpaUserSort;
  direction: FreeIpaSortDirection;
  page: number;
  pageSize: number;
};

type UsersPayload = {
  mode: "demo" | "live" | "unconfigured";
  users: FreeIpaDirectoryUser[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number; from: number; to: number };
  filters: QueryState & { availableGroups: string[] };
  summary: { total: number; active: number; disabled: number; filtered: number };
};

type BulkAction = "enable" | "disable" | "add_to_group";

type BulkPayload = {
  ok: boolean;
  action: BulkAction;
  group: string | null;
  requested: number;
  succeeded: number;
  failed: number;
  results: Array<{ uid: string; ok: boolean; status: number; runId: string; error: string }>;
  error?: string;
};

const defaultQuery: QueryState = { q: "", status: "all", group: "", sort: "uid", direction: "asc", page: 1, pageSize: 25 };
const maxBulkUsers = 50;

function readQuery(): QueryState {
  if (typeof window === "undefined") return defaultQuery;
  const params = new URLSearchParams(window.location.search);
  const status = params.get("ustatus");
  const sort = params.get("usort");
  const direction = params.get("udir");
  const pageValue = Number(params.get("upage"));
  const pageSize = Number(params.get("usize"));
  return {
    q: String(params.get("uq") ?? "").slice(0, 160),
    status: status === "active" || status === "disabled" ? status : "all",
    group: String(params.get("ugroup") ?? "").slice(0, 120),
    sort: sort === "name" || sort === "email" || sort === "groups" || sort === "status" ? sort : "uid",
    direction: direction === "desc" ? "desc" : "asc",
    page: Number.isFinite(pageValue) ? Math.max(1, Math.min(Math.floor(pageValue), 100_000)) : 1,
    pageSize: [10, 25, 50, 100].includes(pageSize) ? pageSize : 25,
  };
}

function writeQuery(query: QueryState): void {
  const url = new URL(window.location.href);
  const set = (name: string, value: string, defaultValue = "") => {
    if (value && value !== defaultValue) url.searchParams.set(name, value);
    else url.searchParams.delete(name);
  };
  set("uq", query.q);
  set("ustatus", query.status, "all");
  set("ugroup", query.group);
  set("usort", query.sort, "uid");
  set("udir", query.direction, "asc");
  set("upage", String(query.page), "1");
  set("usize", String(query.pageSize), "25");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function initials(user: FreeIpaDirectoryUser): string {
  const value = user.name || user.uid;
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "U";
}

function useUsersMount(active: boolean): HTMLElement | null {
  const [mount, setMount] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;
    let observer: MutationObserver | null = null;
    let cancelled = false;

    const install = () => {
      if (cancelled) return true;
      const page = document.querySelector<HTMLElement>(".section-page");
      if (!page || !page.querySelector(".users-row")) return false;
      document.getElementById("freeipa-user-browser")?.remove();
      const node = document.createElement("div");
      node.id = "freeipa-user-browser";
      page.prepend(node);
      setMount(node);
      return true;
    };

    const initial = window.setTimeout(() => {
      if (install()) return;
      observer = new MutationObserver(() => {
        if (install()) observer?.disconnect();
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(initial);
      observer?.disconnect();
      setMount((current) => {
        current?.remove();
        return null;
      });
    };
  }, [active]);

  return mount;
}

function bulkLabel(action: BulkAction): string {
  if (action === "enable") return "включить";
  if (action === "disable") return "отключить";
  return "добавить в группу";
}

function FreeIpaUserDetails({ user, groups, canWrite, canDelete, close }: { user: FreeIpaDirectoryUser; groups: string[]; canWrite: boolean; canDelete: boolean; close: () => void }) {
  const availableGroups = groups.filter((group) => !user.groupNames.includes(group));
  return <div className="modal-backdrop"><section className="modal identity-modal"><button className="modal-x" onClick={close}>×</button><div className="identity-head"><span>{initials(user)}</span><div><small>ПОЛЬЗОВАТЕЛЬ FREEIPA</small><h2>{user.name || user.uid}</h2><code>{user.uid}</code></div><span className={`freeipa-user-status ${user.active ? "active" : "disabled"}`}>{user.active ? "Активен" : "Отключён"}</span></div><div className="identity-facts"><span><small>Email</small><strong>{user.email || "Не указан"}</strong></span><span><small>Группы</small><strong>{user.groups}</strong></span></div><div className="membership-head"><div><h3>Членство в группах</h3><p>{canWrite ? "Изменения применяются напрямую в FreeIPA." : "Доступно только для просмотра."}</p></div>{canWrite && <button className="secondary" disabled={!availableGroups.length} onClick={() => openFreeIpaAction({ operation: "group_add_member", title: `Добавить ${user.uid} в группу`, preset: { username: user.uid }, choices: { groups: availableGroups } })}>＋ Добавить группу</button>}</div><div className="membership-list">{user.groupNames.map((group) => <span key={group}><b>{group}</b>{canWrite && <button data-portal-confirmation-control="1" aria-label={`Удалить ${user.uid} из ${group}`} onClick={() => openFreeIpaAction({ operation: "group_remove_member", title: `Удалить ${user.uid} из ${group}`, preset: { username: user.uid, group } })}>×</button>}</span>)}{!user.groupNames.length && <p>Пользователь не входит в группы.</p>}</div><div className="identity-actions">{canWrite && <><button className="secondary" onClick={() => openFreeIpaAction({ operation: "user_mod", title: `Редактировать ${user.uid}`, preset: { username: user.uid, firstName: user.firstName, lastName: user.lastName, email: user.email } })}>Редактировать</button><button className="secondary" onClick={() => openFreeIpaAction({ operation: "user_password", title: `Сбросить пароль ${user.uid}`, preset: { username: user.uid } })}>Сбросить пароль</button><button className="secondary" data-portal-confirmation-control={user.active ? "1" : undefined} onClick={() => openFreeIpaAction({ operation: user.active ? "user_disable" : "user_enable", title: `${user.active ? "Отключить" : "Включить"} ${user.uid}`, preset: { username: user.uid } })}>{user.active ? "Отключить" : "Включить"}</button></>}{canDelete && <button className="danger-button" data-portal-confirmation-control="1" onClick={() => openFreeIpaAction({ operation: "user_del", title: `Удалить ${user.uid}`, preset: { username: user.uid } })}>Удалить</button>}<button className="secondary" onClick={close}>Закрыть</button></div></section></div>;
}

export default function FreeIpaUserBrowser() {
  const [pathname, setPathname] = useState(() => typeof window === "undefined" ? "" : window.location.pathname);
  const active = pathname === "/users";
  const mount = useUsersMount(active);
  const [query, setQuery] = useState<QueryState>(() => readQuery());
  const [draft, setDraft] = useState(() => readQuery().q);
  const [payload, setPayload] = useState<UsersPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [canWrite, setCanWrite] = useState(false);
  const [canDelete, setCanDelete] = useState(false);
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [bulkAction, setBulkAction] = useState<BulkAction | null>(null);
  const [bulkGroup, setBulkGroup] = useState("");
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkError, setBulkError] = useState("");
  const [bulkResult, setBulkResult] = useState<BulkPayload | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const next = window.location.pathname;
      setPathname((current) => current === next ? current : next);
    }, 200);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => {
      const current = readQuery();
      setQuery(current);
      setDraft(current.q);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const reset = window.setTimeout(() => {
      if (cancelled) return;
      setCanWrite(false);
      setCanDelete(false);
    }, 0);
    void loadFreeIpaAccess().then((access) => {
      if (cancelled) return;
      setCanWrite(access.canWrite);
      setCanDelete(access.canDelete);
    }).catch(() => {
      if (cancelled) return;
      setCanWrite(false);
      setCanDelete(false);
    });
    return () => {
      cancelled = true;
      window.clearTimeout(reset);
    };
  }, [active]);

  const load = useCallback(async () => {
    if (!active) return;
    const id = ++requestId.current;
    setLoading(true);
    setError("");
    writeQuery(query);
    const params = new URLSearchParams({
      q: query.q,
      status: query.status,
      group: query.group,
      sort: query.sort,
      direction: query.direction,
      page: String(query.page),
      pageSize: String(query.pageSize),
    });
    try {
      const response = await fetch(`/api/integrations/users?${params}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({})) as Partial<UsersPayload> & { error?: string };
      if (!response.ok) throw new Error(data.error || "Не удалось загрузить пользователей FreeIPA");
      if (id !== requestId.current) return;
      setPayload(data as UsersPayload);
      if (data.pagination?.page && data.pagination.page !== query.page) {
        setQuery((current) => ({ ...current, page: data.pagination!.page }));
      }
    } catch (cause) {
      if (id !== requestId.current) return;
      setPayload(null);
      setError(cause instanceof Error ? cause.message : "Не удалось загрузить пользователей FreeIPA");
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [active, query]);

  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [active, load]);

  useEffect(() => {
    if (!active) return;
    const refresh = () => void load();
    window.addEventListener(FREEIPA_DIRECTORY_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(FREEIPA_DIRECTORY_CHANGED_EVENT, refresh);
  }, [active, load]);

  useEffect(() => {
    const enhanced = active && payload?.mode !== "demo";
    document.body.classList.toggle("freeipa-user-browser-active", enhanced);
    return () => document.body.classList.remove("freeipa-user-browser-active");
  }, [active, payload?.mode]);

  useEffect(() => {
    if (active) return;
    const timer = window.setTimeout(() => {
      setSelected(new Set());
      setBulkAction(null);
      setBulkError("");
      setBulkResult(null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [active]);

  const setFilter = useCallback((change: Partial<QueryState>) => {
    setQuery((current) => ({ ...current, ...change, page: change.page ?? 1 }));
  }, []);

  const pages = useMemo(() => {
    const total = payload?.pagination.totalPages ?? 1;
    const page = payload?.pagination.page ?? 1;
    const values = new Set([1, total, page - 1, page, page + 1]);
    return Array.from(values).filter((value) => value >= 1 && value <= total).sort((left, right) => left - right);
  }, [payload?.pagination]);

  const toggleUser = useCallback((uid: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
    setBulkResult(null);
    setBulkError("");
  }, []);

  const exportFiltered = useCallback(() => {
    const params = new URLSearchParams({
      q: query.q,
      status: query.status,
      group: query.group,
      sort: query.sort,
      direction: query.direction,
    });
    const link = document.createElement("a");
    link.href = `/api/integrations/users/export.csv?${params}`;
    link.download = "freeipa-users.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }, [query]);

  const executeBulk = useCallback(async () => {
    if (!bulkAction || !selected.size || selected.size > maxBulkUsers) return;
    if (bulkAction === "add_to_group" && !bulkGroup) {
      setBulkError("Выберите группу FreeIPA");
      return;
    }
    setBulkLoading(true);
    setBulkError("");
    setBulkResult(null);
    try {
      const response = await fetch("/api/integrations/freeipa/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: bulkAction, users: Array.from(selected), group: bulkGroup }),
      });
      const data = await response.json().catch(() => ({})) as BulkPayload;
      if (!response.ok) throw new Error(data.error || "Массовая операция FreeIPA не выполнена");
      setBulkResult(data);
      const completed = new Set(data.results.filter((result) => result.ok).map((result) => result.uid));
      setSelected((current) => new Set(Array.from(current).filter((uid) => !completed.has(uid))));
      setBulkAction(null);
      await load();
      announceFreeIpaDirectoryChanged();
    } catch (cause) {
      setBulkError(cause instanceof Error ? cause.message : "Массовая операция FreeIPA не выполнена");
    } finally {
      setBulkLoading(false);
    }
  }, [bulkAction, bulkGroup, load, selected]);

  if (!active || !mount || payload?.mode === "demo") return null;

  const users = payload?.users ?? [];
  const pagination = payload?.pagination ?? { page: query.page, pageSize: query.pageSize, total: 0, totalPages: 1, from: 0, to: 0 };
  const summary = payload?.summary ?? { total: 0, active: 0, disabled: 0, filtered: 0 };
  const groups = payload?.filters.availableGroups ?? [];
  const selectedUser = selectedUid ? users.find((user) => user.uid === selectedUid) ?? null : null;
  const pageSelected = users.length > 0 && users.every((user) => selected.has(user.uid));
  const bulkSelectionValid = selected.size > 0 && selected.size <= maxBulkUsers;

  return createPortal(
    <>
    <div className="freeipa-user-browser-shell">
      <div className="freeipa-user-browser-head">
        <div><span className="eyebrow">FREEIPA DIRECTORY</span><h2>Пользователи FreeIPA</h2><p>{summary.total} учётных записей · {summary.active} активны · {summary.disabled} отключены</p></div>
        <div><button className="secondary" disabled={payload?.mode !== "live"} onClick={exportFiltered}>⇩ Экспорт CSV</button><button className="secondary" disabled={loading} onClick={() => void load()}>{loading ? "Обновление…" : "⟳ Обновить"}</button>{canWrite ? <button className="primary" disabled={payload?.mode !== "live"} onClick={() => openFreeIpaAction({ operation: "user_add", title: "Новый пользователь", preset: {} })}>＋ Создать пользователя</button> : <span className="freeipa-user-readonly">Только просмотр</span>}</div>
      </div>

      <form className="freeipa-user-query" onSubmit={(event) => { event.preventDefault(); setFilter({ q: draft.trim() }); }}>
        <label className="freeipa-user-search"><span>Поиск</span><input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Логин, ФИО, email или группа" maxLength={160} /></label>
        <label><span>Состояние</span><select value={query.status} onChange={(event) => setFilter({ status: event.target.value as FreeIpaUserStatus })}><option value="all">Все</option><option value="active">Активные</option><option value="disabled">Отключённые</option></select></label>
        <label><span>Группа</span><select value={query.group} onChange={(event) => setFilter({ group: event.target.value })}><option value="">Все группы</option>{groups.map((group) => <option value={group} key={group}>{group}</option>)}</select></label>
        <label><span>Сортировка</span><select value={query.sort} onChange={(event) => setFilter({ sort: event.target.value as FreeIpaUserSort })}><option value="uid">Логин</option><option value="name">Имя</option><option value="email">Email</option><option value="groups">Количество групп</option><option value="status">Статус</option></select></label>
        <label><span>На странице</span><select value={query.pageSize} onChange={(event) => setFilter({ pageSize: Number(event.target.value) })}>{[10, 25, 50, 100].map((size) => <option value={size} key={size}>{size}</option>)}</select></label>
        <button className="secondary freeipa-sort-direction" type="button" onClick={() => setFilter({ direction: query.direction === "asc" ? "desc" : "asc" })}>{query.direction === "asc" ? "↑ По возрастанию" : "↓ По убыванию"}</button>
        <button className="primary" type="submit">Найти</button>
        {(query.q || query.status !== "all" || query.group || query.sort !== "uid" || query.direction !== "asc") && <button className="secondary" type="button" onClick={() => { setDraft(""); setQuery({ ...defaultQuery, pageSize: query.pageSize }); }}>Сбросить</button>}
      </form>

      {canWrite && payload?.mode === "live" && <div className="freeipa-user-bulk-bar">
        <div><strong>Выбрано: {selected.size}</strong><span>За один запуск — не более {maxBulkUsers} пользователей.</span></div>
        <label><span>Целевая группа</span><select value={bulkGroup} onChange={(event) => setBulkGroup(event.target.value)}><option value="">Выберите группу</option>{groups.map((group) => <option value={group} key={group}>{group}</option>)}</select></label>
        <div className="freeipa-user-bulk-actions"><button className="secondary" disabled={!bulkSelectionValid || bulkLoading} onClick={() => setBulkAction("enable")}>Включить</button><button className="secondary" disabled={!bulkSelectionValid || bulkLoading} onClick={() => setBulkAction("disable")}>Отключить</button><button className="secondary" disabled={!bulkSelectionValid || !bulkGroup || bulkLoading} onClick={() => setBulkAction("add_to_group")}>Добавить в группу</button><button className="secondary" disabled={!selected.size || bulkLoading} onClick={() => { setSelected(new Set()); setBulkAction(null); }}>Очистить</button></div>
      </div>}

      {bulkAction && <div className="freeipa-user-bulk-confirm" role="dialog" aria-label="Подтверждение массовой операции"><div><strong>Подтвердите массовую операцию</strong><span>Будет выполнено действие «{bulkLabel(bulkAction)}» для {selected.size} пользователей{bulkAction === "add_to_group" ? `, группа: ${bulkGroup}` : ""}.</span></div><div><button className="secondary" disabled={bulkLoading} onClick={() => setBulkAction(null)}>Отмена</button><button className="primary" disabled={bulkLoading || !bulkSelectionValid} onClick={() => void executeBulk()}>{bulkLoading ? "Выполнение…" : "Подтвердить"}</button></div></div>}
      {bulkError && <div className="freeipa-user-query-state error"><strong>Массовая операция не выполнена</strong><span>{bulkError}</span></div>}
      {bulkResult && <div className={`freeipa-user-bulk-result ${bulkResult.failed ? "partial" : "success"}`}><strong>{bulkResult.failed ? "Операция завершена частично" : "Операция выполнена"}</strong><span>Успешно: {bulkResult.succeeded} · Ошибок: {bulkResult.failed}</span>{bulkResult.failed > 0 && <details><summary>Показать ошибки</summary><ul>{bulkResult.results.filter((result) => !result.ok).map((result) => <li key={result.uid}><code>{result.uid}</code>: {result.error}</li>)}</ul></details>}</div>}

      {error && <div className="freeipa-user-query-state error"><strong>Пользователи не загружены</strong><span>{error}</span><button className="secondary" onClick={() => void load()}>Повторить</button></div>}
      {!error && loading && !payload && <div className="freeipa-user-query-state"><strong>Загрузка пользователей…</strong><span>Портал получает и фильтрует каталог FreeIPA.</span></div>}
      {!error && payload?.mode === "unconfigured" && <div className="freeipa-user-query-state"><strong>FreeIPA не настроен</strong><span>Сохраните подключение во вкладке настроек FreeIPA.</span></div>}

      {!error && payload?.mode === "live" && <>
        <div className="freeipa-user-result-summary"><span>Показано <b>{pagination.from}–{pagination.to}</b> из <b>{pagination.total}</b></span><span>{summary.filtered !== summary.total ? `Фильтр: ${summary.filtered} из ${summary.total}` : "Без фильтра"}</span></div>
        <div className="freeipa-user-table-wrap"><table className="freeipa-user-table ds-table"><thead><tr>{canWrite && <th className="freeipa-user-select"><input type="checkbox" aria-label="Выбрать текущую страницу" checked={pageSelected} onChange={() => setSelected((current) => { const next = new Set(current); for (const user of users) { if (pageSelected) next.delete(user.uid); else next.add(user.uid); } return next; })} /></th>}<th>Пользователь</th><th>Логин</th><th>Группы</th><th>Статус</th><th>Действия</th></tr></thead><tbody>{users.map((user) => <tr key={user.uid} className={selected.has(user.uid) ? "selected" : ""}>{canWrite && <td className="freeipa-user-select"><input type="checkbox" aria-label={`Выбрать ${user.uid}`} checked={selected.has(user.uid)} onChange={() => toggleUser(user.uid)} /></td>}<td><span className="freeipa-user-person"><b>{initials(user)}</b><span><strong>{user.name || user.uid}</strong><small>{user.email || "Email не указан"}</small></span></span></td><td><code>{user.uid}</code></td><td><strong>{user.groups}</strong><small title={user.groupNames.join(", ")}>{user.groupNames.slice(0, 2).join(", ") || "—"}{user.groupNames.length > 2 ? ` +${user.groupNames.length - 2}` : ""}</small></td><td><span className={`freeipa-user-status ${user.active ? "active" : "disabled"}`}>{user.active ? "Активен" : "Отключён"}</span></td><td><div className="freeipa-user-actions"><button onClick={() => setSelectedUid(user.uid)}>Карточка</button>{canWrite && <button onClick={() => openFreeIpaAction({ operation: "user_mod", title: `Редактировать ${user.uid}`, preset: { username: user.uid, firstName: user.firstName, lastName: user.lastName, email: user.email } })}>Редактировать</button>}</div></td></tr>)}</tbody></table></div>
        {!users.length && <div className="freeipa-user-query-state"><strong>Пользователи не найдены</strong><span>Измените поисковую строку, состояние или выбранную группу.</span></div>}
        <div className="freeipa-user-pagination"><button className="secondary" disabled={pagination.page <= 1 || loading} onClick={() => setFilter({ page: pagination.page - 1 })}>← Назад</button><div>{pages.map((page, index) => <span key={page}>{index > 0 && page - pages[index - 1] > 1 && <i>…</i>}<button className={page === pagination.page ? "active" : ""} onClick={() => setFilter({ page })}>{page}</button></span>)}</div><button className="secondary" disabled={pagination.page >= pagination.totalPages || loading} onClick={() => setFilter({ page: pagination.page + 1 })}>Вперёд →</button></div>
      </>}
    </div>
    {selectedUser && <FreeIpaUserDetails user={selectedUser} groups={groups} canWrite={canWrite} canDelete={canDelete} close={() => setSelectedUid(null)} />}
    </>,
    mount,
  );
}
