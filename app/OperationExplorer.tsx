"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  buildOperationTimeline,
  formatOperationDuration,
  normalizeOperationQuery,
  operationDurationMs,
  queryOperationRuns,
  type OperationQuery,
  type OperationRun,
  type OperationRunStatus,
  type OperationSort,
  type OperationStatusFilter,
} from "../operation-explorer";

type RunsPayload = {
  runs?: OperationRun[];
  error?: string;
};

type OperationsMount = {
  node: HTMLElement;
  page: HTMLElement;
};

type DetailMount = {
  node: HTMLElement;
  modal: HTMLElement;
  jobId: string;
};

const defaultQuery: OperationQuery = {
  q: "",
  status: "all",
  actor: "",
  from: "",
  to: "",
  sort: "started_desc",
  page: 1,
  pageSize: 25,
};

const statusLabels: Record<OperationRunStatus, string> = {
  queued: "В очереди",
  running: "Выполняется",
  success: "Успешно",
  failed: "Ошибка",
  cancelled: "Остановлено",
  unknown: "Неизвестно",
};

function readQuery(): OperationQuery {
  if (typeof window === "undefined") return defaultQuery;
  const params = new URLSearchParams();
  const source = new URLSearchParams(window.location.search);
  const copy = (from: string, to: string) => {
    const value = source.get(from);
    if (value !== null) params.set(to, value);
  };
  copy("oq", "q");
  copy("ostatus", "status");
  copy("oactor", "actor");
  copy("ofrom", "from");
  copy("oto", "to");
  copy("osort", "sort");
  copy("opage", "page");
  copy("osize", "pageSize");
  return normalizeOperationQuery(params);
}

function writeQuery(query: OperationQuery): void {
  const url = new URL(window.location.href);
  const set = (name: string, value: string, fallback = "") => {
    if (value && value !== fallback) url.searchParams.set(name, value);
    else url.searchParams.delete(name);
  };
  set("oq", query.q);
  set("ostatus", query.status, "all");
  set("oactor", query.actor);
  set("ofrom", query.from);
  set("oto", query.to);
  set("osort", query.sort, "started_desc");
  set("opage", String(query.page), "1");
  set("osize", String(query.pageSize), "25");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function operationsPage(): HTMLElement | null {
  return Array.from(document.querySelectorAll<HTMLElement>(".section-page"))
    .find((page) => page.querySelector("h2")?.textContent?.trim() === "Журнал операций") ?? null;
}

function useOperationsMount(active: boolean): OperationsMount | null {
  const [mount, setMount] = useState<OperationsMount | null>(null);
  const current = useRef<OperationsMount | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const clear = () => {
      const previous = current.current;
      if (!previous) return;
      previous.page.classList.remove("operation-explorer-host");
      previous.node.remove();
      current.current = null;
      if (!cancelled) setMount(null);
    };
    const install = () => {
      if (cancelled) return;
      const page = operationsPage();
      const table = page?.querySelector<HTMLElement>(".data-table");
      if (!page || !table) {
        if (current.current && !current.current.page.isConnected) clear();
        return;
      }
      if (current.current?.page === page && current.current.node.isConnected) return;
      clear();
      document.getElementById("operation-explorer")?.remove();
      const node = document.createElement("div");
      node.id = "operation-explorer";
      table.before(node);
      page.classList.add("operation-explorer-host");
      const next = { node, page };
      current.current = next;
      setMount(next);
    };
    const timer = window.setTimeout(install, 0);
    const observer = new MutationObserver(install);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      observer.disconnect();
      const previous = current.current;
      previous?.page.classList.remove("operation-explorer-host");
      previous?.node.remove();
      current.current = null;
    };
  }, [active]);

  return mount;
}

function runDetailsModal(): { modal: HTMLElement; jobId: string } | null {
  const modal = document.querySelector<HTMLElement>(".run-details-modal");
  if (!modal) return null;
  const jobId = modal.querySelector<HTMLElement>(".run-facts code")?.textContent?.trim() ?? "";
  return jobId ? { modal, jobId } : null;
}

function useDetailMount(active: boolean): DetailMount | null {
  const [mount, setMount] = useState<DetailMount | null>(null);
  const current = useRef<DetailMount | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const clear = () => {
      const previous = current.current;
      if (!previous) return;
      previous.modal.classList.remove("operation-timeline-enhanced");
      previous.node.remove();
      current.current = null;
      if (!cancelled) setMount(null);
    };
    const install = () => {
      if (cancelled) return;
      const details = runDetailsModal();
      if (!details) {
        if (current.current && !current.current.modal.isConnected) clear();
        return;
      }
      if (current.current?.modal === details.modal && current.current.jobId === details.jobId && current.current.node.isConnected) return;
      clear();
      const node = document.createElement("div");
      node.id = "operation-timeline-details";
      const anchor = details.modal.querySelector<HTMLElement>(".workflow-timeline, .run-results, .settings-error, .modal-actions");
      if (anchor) anchor.before(node);
      else details.modal.appendChild(node);
      details.modal.classList.add("operation-timeline-enhanced");
      const next = { node, modal: details.modal, jobId: details.jobId };
      current.current = next;
      setMount(next);
    };
    const timer = window.setTimeout(install, 0);
    const observer = new MutationObserver(install);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      observer.disconnect();
      const previous = current.current;
      previous?.modal.classList.remove("operation-timeline-enhanced");
      previous?.node.remove();
      current.current = null;
    };
  }, [active]);

  return mount;
}

function formatDateTime(value: number | null): string {
  return value ? new Date(value).toLocaleString("ru-RU") : "—";
}

function statusTone(status: OperationRunStatus): string {
  return status === "success" ? "success" : status === "failed" ? "error" : status === "running" ? "violet" : status === "queued" ? "warning" : "neutral";
}

function clickLegacyRun(page: HTMLElement, jobId: string): boolean {
  const rows = Array.from(page.querySelectorAll<HTMLElement>(".data-table .tr.ops-detailed:not(.th)"));
  const row = rows.find((item) => item.querySelector(".mono")?.textContent?.trim() === jobId);
  if (!row) return false;
  row.click();
  return true;
}

function TimelineDetails({ run, now }: { run: OperationRun; now: number }) {
  const timeline = buildOperationTimeline(run, now);
  return <section className="operation-timeline-panel">
    <div className="operation-timeline-head">
      <div><span>ВРЕМЕННАЯ ШКАЛА</span><h3>Продолжительность выполнения</h3></div>
      <strong>{formatOperationDuration(timeline.totalDurationMs)}</strong>
    </div>
    <div className="operation-timeline-facts">
      <span><small>Начало</small><b>{formatDateTime(timeline.startedAt)}</b></span>
      <span><small>{timeline.completedAt ? "Завершение" : "Последнее обновление"}</small><b>{formatDateTime(timeline.completedAt ?? timeline.updatedAt)}</b></span>
      <span><small>Состояние</small><b>{timeline.active ? "Выполняется сейчас" : statusLabels[run.status]}</b></span>
    </div>
    {timeline.stages.length ? <div className="operation-stage-list">{timeline.stages.map((stage, index) => <article key={stage.id}>
      <div className="operation-stage-index"><i className={stage.status}>{stage.status === "success" ? "✓" : stage.status === "failed" || stage.status === "cancelled" ? "!" : index + 1}</i>{index < timeline.stages.length - 1 && <span />}</div>
      <div className="operation-stage-body">
        <div><strong>{stage.title}</strong><em className={statusTone(stage.status)}>{statusLabels[stage.status]}</em></div>
        <p><span>Начало: {formatDateTime(stage.startedAt)}</span><span>Конец: {formatDateTime(stage.completedAt)}</span></p>
        <div className="operation-stage-bar"><i style={{ width: `${stage.progress}%` }} /></div>
        <small>Длительность: <b>{formatOperationDuration(stage.durationMs)}</b>{stage.waitingMs && stage.waitingMs > 0 ? ` · ожидание до этапа: ${formatOperationDuration(stage.waitingMs)}` : ""}{stage.offsetMs !== null ? ` · от старта: +${formatOperationDuration(stage.offsetMs)}` : ""}</small>
        {stage.error && <p className="operation-stage-error">{stage.error}</p>}
      </div>
    </article>)}</div> : <div className="operation-timeline-empty"><strong>Детализация этапов отсутствует</strong><span>Общая продолжительность рассчитана по времени запуска, обновления и завершения задания.</span></div>}
  </section>;
}

export default function OperationExplorer() {
  const [pathname, setPathname] = useState(() => typeof window === "undefined" ? "" : window.location.pathname);
  const active = pathname === "/operations";
  const mount = useOperationsMount(active);
  const detailMount = useDetailMount(active);
  const [query, setQuery] = useState<OperationQuery>(() => readQuery());
  const [draft, setDraft] = useState(() => ({ q: readQuery().q, actor: readQuery().actor }));
  const [runs, setRuns] = useState<OperationRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
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
    const next = readQuery();
    const timer = window.setTimeout(() => {
      setQuery(next);
      setDraft({ q: next.q, actor: next.actor });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [active]);

  const load = useCallback(async (sync = false) => {
    if (!active) return;
    const id = ++requestId.current;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/integrations/runs?limit=500&sync=${sync ? "1" : "0"}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({})) as RunsPayload;
      if (!response.ok) throw new Error(data.error || "Журнал операций недоступен");
      if (id !== requestId.current) return;
      setRuns(Array.isArray(data.runs) ? data.runs : []);
      setNow(Date.now());
    } catch (cause) {
      if (id !== requestId.current) return;
      setRuns([]);
      setError(cause instanceof Error ? cause.message : "Журнал операций недоступен");
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [active]);

  useEffect(() => {
    if (!active || !mount) return;
    const initial = window.setTimeout(() => void load(false), 0);
    const timer = window.setInterval(() => void load(false), 15_000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, [active, load, mount]);

  useEffect(() => {
    const enabled = Boolean(active && mount);
    document.body.classList.toggle("operation-explorer-active", enabled);
    return () => document.body.classList.remove("operation-explorer-active");
  }, [active, mount]);

  const result = useMemo(() => queryOperationRuns(runs, query, now), [now, query, runs]);
  const detailJobId = detailMount?.jobId ?? "";
  const detailNode = detailMount?.node ?? null;
  const detailRun = useMemo(() => runs.find((run) => run.jobId === detailJobId) ?? null, [detailJobId, runs]);

  const setFilter = useCallback((change: Partial<OperationQuery>) => {
    setQuery((current) => {
      const next = { ...current, ...change, page: change.page ?? 1 };
      writeQuery(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setDraft({ q: "", actor: "" });
    setQuery(defaultQuery);
    writeQuery(defaultQuery);
  }, []);

  const pages = useMemo(() => {
    const values = new Set([1, result.pagination.totalPages, result.pagination.page - 1, result.pagination.page, result.pagination.page + 1]);
    return Array.from(values).filter((value) => value >= 1 && value <= result.pagination.totalPages).sort((left, right) => left - right);
  }, [result.pagination.page, result.pagination.totalPages]);

  if (!active || !mount) return null;

  return <>
    {createPortal(<section className="operation-explorer-shell">
      <div className="operation-explorer-summary">
        <article><small>Всего</small><strong>{result.summary.total}</strong></article>
        <article><small>Активные</small><strong>{result.summary.active}</strong></article>
        <article><small>Успешно</small><strong>{result.summary.success}</strong></article>
        <article><small>Ошибки</small><strong>{result.summary.failed}</strong></article>
        <article><small>Остановлено</small><strong>{result.summary.cancelled}</strong></article>
      </div>

      <form className="operation-explorer-filters" onSubmit={(event) => { event.preventDefault(); setFilter({ q: draft.q, actor: draft.actor }); }}>
        <label className="operation-explorer-search"><span>Процесс, Job или объект</span><input value={draft.q} onChange={(event) => setDraft((current) => ({ ...current, q: event.target.value }))} placeholder="backup, job-42, billing…" /></label>
        <label><span>Статус</span><select value={query.status} onChange={(event) => setFilter({ status: event.target.value as OperationStatusFilter })}><option value="all">Все статусы</option><option value="active">Все активные</option><option value="finished">Все завершённые</option><option value="queued">В очереди</option><option value="running">Выполняется</option><option value="success">Успешно</option><option value="failed">Ошибка</option><option value="cancelled">Остановлено</option><option value="unknown">Неизвестно</option></select></label>
        <label><span>Пользователь</span><input list="operation-actors" value={draft.actor} onChange={(event) => setDraft((current) => ({ ...current, actor: event.target.value }))} placeholder="operator@example.test" /><datalist id="operation-actors">{result.options.actors.map((actor) => <option value={actor} key={actor} />)}</datalist></label>
        <label><span>С даты</span><input type="date" value={query.from} onChange={(event) => setFilter({ from: event.target.value })} /></label>
        <label><span>По дату</span><input type="date" value={query.to} onChange={(event) => setFilter({ to: event.target.value })} /></label>
        <label><span>Сортировка</span><select value={query.sort} onChange={(event) => setFilter({ sort: event.target.value as OperationSort })}><option value="started_desc">Сначала новые</option><option value="started_asc">Сначала старые</option><option value="duration_desc">Сначала долгие</option><option value="duration_asc">Сначала быстрые</option></select></label>
        <div className="operation-explorer-filter-actions"><button className="primary">Применить</button><button type="button" className="secondary" onClick={reset}>Сбросить</button><button type="button" className="secondary" disabled={loading} onClick={() => void load(true)}>{loading ? "Синхронизация…" : "⟳ Обновить XYOps"}</button></div>
      </form>

      {error && <div className="operation-explorer-state error"><span>{error}</span><button className="secondary" onClick={() => void load(true)}>Повторить</button></div>}
      {!error && loading && !runs.length && <div className="operation-explorer-state"><span>Загрузка журнала операций…</span></div>}
      {!error && <>
        <div className="operation-explorer-result"><span>{result.pagination.from ? `${result.pagination.from}–${result.pagination.to} из ${result.pagination.total}` : "Операции не найдены"}</span><b>Фильтр: {result.summary.filtered} из {result.summary.total}</b></div>
        <div className="operation-explorer-table">
          <div className="operation-explorer-row head"><span>Операция</span><span>Статус</span><span>Инициатор</span><span>Начало</span><span>Длительность</span></div>
          {result.runs.map((run) => <button className="operation-explorer-row" key={run.id} onClick={() => { if (!clickLegacyRun(mount.page, run.jobId)) setError(`Операция ${run.jobId} отсутствует в текущей legacy-таблице`); }}>
            <span><strong>{run.title}</strong><small>{run.subject || run.eventId} · {run.kind} · {run.mode.toUpperCase()}</small><code>{run.jobId}</code></span>
            <span><em className={statusTone(run.status)}>{statusLabels[run.status]}</em></span>
            <span>{run.actor || "—"}</span>
            <span><strong>{new Date(run.startedAt).toLocaleTimeString("ru-RU")}</strong><small>{new Date(run.startedAt).toLocaleDateString("ru-RU")}</small></span>
            <span><strong>{formatOperationDuration(operationDurationMs(run, now))}</strong><small>{run.completedAt ? `завершено ${new Date(run.completedAt).toLocaleTimeString("ru-RU")}` : "обновляется"}</small></span>
          </button>)}
          {!result.runs.length && <div className="operation-explorer-empty"><strong>Совпадений нет</strong><span>Измените статус, пользователя, период или поисковую строку.</span></div>}
        </div>
        <div className="operation-explorer-pagination">
          <label>На странице<select value={query.pageSize} onChange={(event) => setFilter({ pageSize: Number(event.target.value) })}><option value="10">10</option><option value="25">25</option><option value="50">50</option><option value="100">100</option></select></label>
          <div><button disabled={result.pagination.page <= 1} onClick={() => setFilter({ page: result.pagination.page - 1 })}>←</button>{pages.map((page, index) => <span key={page}>{index > 0 && page - pages[index - 1] > 1 && <i>…</i>}<button className={page === result.pagination.page ? "active" : ""} onClick={() => setFilter({ page })}>{page}</button></span>)}<button disabled={result.pagination.page >= result.pagination.totalPages} onClick={() => setFilter({ page: result.pagination.page + 1 })}>→</button></div>
          <span>Страница {result.pagination.page} из {result.pagination.totalPages}</span>
        </div>
      </>}
    </section>, mount.node)}
    {detailNode && detailRun && createPortal(<TimelineDetails run={detailRun} now={now} />, detailNode)}
  </>;
}
