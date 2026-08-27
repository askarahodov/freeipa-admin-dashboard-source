"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  FreeIpaDirectoryGroup,
  FreeIpaGroupMember,
  FreeIpaGroupMemberDirection,
  FreeIpaGroupMemberSort,
  FreeIpaGroupMemberStatus,
} from "../src/freeipa/freeipa-group-member-query";
import { FREEIPA_DIRECTORY_CHANGED_EVENT, loadFreeIpaAccess, openFreeIpaAction } from "../src/freeipa/freeipa-ui-events";

type QueryState = {
  q: string;
  status: FreeIpaGroupMemberStatus;
  sort: FreeIpaGroupMemberSort;
  direction: FreeIpaGroupMemberDirection;
  page: number;
  pageSize: number;
};

type MembersPayload = {
  mode: "demo" | "live" | "unconfigured";
  group: FreeIpaDirectoryGroup;
  members: FreeIpaGroupMember[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number; from: number; to: number };
  filters: QueryState;
  summary: { total: number; active: number; disabled: number; unknown: number; filtered: number };
};

type GroupMount = {
  node: HTMLElement;
  modal: HTMLElement;
  groupName: string;
};

const defaultQuery: QueryState = { q: "", status: "all", sort: "uid", direction: "asc", page: 1, pageSize: 10 };

function groupModal(): HTMLElement | null {
  return Array.from(document.querySelectorAll<HTMLElement>(".identity-modal"))
    .find((modal) => Array.from(modal.querySelectorAll("small")).some((node) => node.textContent?.trim() === "ГРУППА FREEIPA")) ?? null;
}

function useGroupMount(active: boolean): GroupMount | null {
  const [target, setTarget] = useState<GroupMount | null>(null);
  const current = useRef<GroupMount | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    const clear = () => {
      const previous = current.current;
      if (!previous) return;
      previous.modal.classList.remove("freeipa-group-member-browser-active");
      previous.node.remove();
      current.current = null;
      if (!cancelled) setTarget(null);
    };

    const install = () => {
      if (cancelled) return;
      const modal = groupModal();
      const groupName = modal?.querySelector("h2")?.textContent?.trim() ?? "";
      const legacyTable = modal?.querySelector<HTMLElement>(".member-table");
      if (!modal || !groupName || !legacyTable) {
        if (current.current && !current.current.modal.isConnected) clear();
        return;
      }
      if (current.current?.modal === modal && current.current.node.isConnected && current.current.groupName === groupName) return;
      clear();
      const node = document.createElement("div");
      node.id = "freeipa-group-member-browser";
      legacyTable.before(node);
      const next = { node, modal, groupName };
      current.current = next;
      setTarget(next);
    };

    const timer = window.setTimeout(install, 0);
    const observer = new MutationObserver(install);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      observer.disconnect();
      const previous = current.current;
      previous?.modal.classList.remove("freeipa-group-member-browser-active");
      previous?.node.remove();
      current.current = null;
    };
  }, [active]);

  return target;
}

function initials(member: FreeIpaGroupMember): string {
  return (member.name || member.uid).split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "U";
}

function statusLabel(member: FreeIpaGroupMember): string {
  return member.active === true ? "Активен" : member.active === false ? "Отключён" : "Не определён";
}

export default function FreeIpaGroupMemberBrowser() {
  const [pathname, setPathname] = useState(() => typeof window === "undefined" ? "" : window.location.pathname);
  const active = pathname === "/groups";
  const target = useGroupMount(active);
  const groupName = target?.groupName ?? "";
  const modal = target?.modal ?? null;
  const [query, setQuery] = useState<QueryState>(defaultQuery);
  const [draft, setDraft] = useState("");
  const [payload, setPayload] = useState<MembersPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [canWrite, setCanWrite] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const next = window.location.pathname;
      setPathname((current) => current === next ? current : next);
    }, 200);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!modal || !groupName) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setQuery(defaultQuery);
      setDraft("");
      setPayload(null);
      setError("");
    }, 0);
    void loadFreeIpaAccess().then((access) => {
      if (!cancelled) setCanWrite(access.canWrite);
    }).catch(() => {
      if (!cancelled) setCanWrite(false);
    });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [groupName, modal]);

  const load = useCallback(async () => {
    if (!active || !groupName) return;
    const id = ++requestId.current;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      group: groupName,
      q: query.q,
      status: query.status,
      sort: query.sort,
      direction: query.direction,
      page: String(query.page),
      pageSize: String(query.pageSize),
    });
    try {
      const response = await fetch(`/api/integrations/groups/members?${params}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({})) as Partial<MembersPayload> & { error?: string };
      if (!response.ok) throw new Error(data.error || "Не удалось загрузить участников группы FreeIPA");
      if (id !== requestId.current) return;
      setPayload(data as MembersPayload);
      if (data.pagination?.page && data.pagination.page !== query.page) {
        setQuery((current) => ({ ...current, page: data.pagination!.page }));
      }
    } catch (cause) {
      if (id !== requestId.current) return;
      setPayload(null);
      setError(cause instanceof Error ? cause.message : "Не удалось загрузить участников группы FreeIPA");
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [active, groupName, query]);

  useEffect(() => {
    if (!active || !groupName) return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [active, groupName, load]);

  useEffect(() => {
    if (!modal) return;
    const enhanced = payload?.mode === "live";
    modal.classList.toggle("freeipa-group-member-browser-active", enhanced);
    return () => modal.classList.remove("freeipa-group-member-browser-active");
  }, [modal, payload?.mode]);

  useEffect(() => {
    if (!active || !modal) return;
    const refresh = () => void load();
    window.addEventListener(FREEIPA_DIRECTORY_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(FREEIPA_DIRECTORY_CHANGED_EVENT, refresh);
  }, [active, load, modal]);

  const setFilter = useCallback((change: Partial<QueryState>) => {
    setQuery((current) => ({ ...current, ...change, page: change.page ?? 1 }));
  }, []);

  const pages = useMemo(() => {
    const total = payload?.pagination.totalPages ?? 1;
    const page = payload?.pagination.page ?? 1;
    return Array.from(new Set([1, total, page - 1, page, page + 1]))
      .filter((value) => value >= 1 && value <= total)
      .sort((left, right) => left - right);
  }, [payload?.pagination]);

  if (!active || !target) return null;
  if (payload?.mode === "demo") return null;

  const members = payload?.members ?? [];
  const pagination = payload?.pagination ?? { page: 1, pageSize: query.pageSize, total: 0, totalPages: 1, from: 0, to: 0 };
  const summary = payload?.summary ?? { total: 0, active: 0, disabled: 0, unknown: 0, filtered: 0 };

  return createPortal(<section className="freeipa-group-member-shell">
    <div className="freeipa-group-member-summary">
      <div><strong>Участники группы</strong><span>{summary.total} всего · {summary.active} активных · {summary.disabled} отключённых{summary.unknown ? ` · ${summary.unknown} без карточки` : ""}</span></div>
      <button className="secondary" disabled={loading} onClick={() => void load()}>{loading ? "Обновление…" : "Обновить"}</button>
    </div>

<form className="freeipa-group-member-query" onSubmit={(event) => { event.preventDefault(); setFilter({ q: draft }); }}>
        <div className="ds-field"><label className="ds-field-label">Поиск</label><input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Логин, имя или email" /></div>
        <div className="ds-field"><label className="ds-field-label">Статус</label><select value={query.status} onChange={(event) => setFilter({ status: event.target.value as FreeIpaGroupMemberStatus })}><option value="all">Все</option><option value="active">Активные</option><option value="disabled">Отключённые</option><option value="unknown">Без карточки</option></select></div>
        <div className="ds-field"><label className="ds-field-label">Сортировка</label><select value={query.sort} onChange={(event) => setFilter({ sort: event.target.value as FreeIpaGroupMemberSort })}><option value="uid">Логин</option><option value="name">Имя</option><option value="email">Email</option><option value="status">Статус</option></select></div>
        <button type="button" className="secondary freeipa-group-member-direction" onClick={() => setFilter({ direction: query.direction === "asc" ? "desc" : "asc" })}>{query.direction === "asc" ? "↑ По возрастанию" : "↓ По убыванию"}</button>
        <button className="primary" type="submit">Найти</button>
    </form>

    {error && <div className="freeipa-group-member-state error"><span>{error}</span><button className="secondary" onClick={() => void load()}>Повторить</button></div>}
    {!error && loading && !payload && <div className="freeipa-group-member-state"><span>Загрузка участников FreeIPA…</span></div>}
    {!error && payload && <>
      <div className="freeipa-group-member-result"><span>{pagination.from ? `${pagination.from}–${pagination.to} из ${pagination.total}` : "Участники не найдены"}</span>{!canWrite && <b>Только просмотр</b>}</div>
      <div className="freeipa-group-member-table">
        {members.map((member) => <div className="freeipa-group-member-row" key={member.uid}>
          <span className="person"><b>{initials(member)}</b><span><strong>{member.name}</strong><small>{member.email || member.uid}</small></span></span>
          <code>{member.uid}</code>
          <span className={`freeipa-group-member-status ${member.active === true ? "active" : member.active === false ? "disabled" : "unknown"}`}>{statusLabel(member)}</span>
          {canWrite ? <button className="danger-link" data-portal-confirmation-control="1" onClick={() => openFreeIpaAction({ operation: "group_remove_member", title: `Удалить ${member.uid} из ${groupName}`, preset: { group: groupName, username: member.uid } })}>Удалить</button> : <span />}
        </div>)}
        {!members.length && <div className="freeipa-group-member-empty"><strong>Совпадений нет</strong><span>Измените поиск или фильтр статуса.</span></div>}
      </div>
      <div className="freeipa-group-member-pagination">
        <label>На странице<select value={query.pageSize} onChange={(event) => setFilter({ pageSize: Number(event.target.value) })}><option value="10">10</option><option value="25">25</option><option value="50">50</option><option value="100">100</option></select></label>
        <div><button disabled={pagination.page <= 1} onClick={() => setFilter({ page: pagination.page - 1 })}>←</button>{pages.map((page, index) => <span key={page}>{index > 0 && page - pages[index - 1] > 1 && <i>…</i>}<button className={page === pagination.page ? "active" : ""} onClick={() => setFilter({ page })}>{page}</button></span>)}<button disabled={pagination.page >= pagination.totalPages} onClick={() => setFilter({ page: pagination.page + 1 })}>→</button></div>
        <span>Страница {pagination.page} из {pagination.totalPages}</span>
      </div>
    </>}
  </section>, target.node);
}