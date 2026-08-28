"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { resolveLegacyOperationTarget } from "../src/operations/operation-explorer-legacy-bridge";
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

type RunsPayload = { runs?: OperationRun[]; error?: string };
type OperationsMount = { node: HTMLElement; page: HTMLElement };
type DetailMount = { node: HTMLElement; modal: HTMLElement; jobId: string };

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

function legacyRunRow(page: HTMLElement, jobId: string): HTMLElement | null {
  const rows = Array.from(page.querySelectorAll<HTMLElement>(".data-table .tr.ops-detailed:not(.th)"));
  return rows.find((item) => item.querySelector(".mono")?.textContent?.trim() === jobId) ?? null;
}

function requestLegacyRunsRefresh(page: HTMLElement): void {
  const refresh = page.querySelector<HTMLButtonElement>(".panel-title button.secondary");
  if (refresh && !refresh.disabled) refresh.click();
}

function waitForLegacyRunRow(page: HTMLElement, jobId: string, timeoutMs = 5_000): Promise<HTMLElement | null> {
  const current = legacyRunRow(page, jobId);
  if (current) return Promise.resolve(current);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (row: HTMLElement | null) => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      window.clearTimeout(timer);
      resolve(row);
    };
    const observer = new MutationObserver(() => {
      const row = legacyRunRow(page, jobId);
      if (row) finish(row);
    });
    observer.observe(page, { childList: true, subtree: true });
    const timer = window.setTimeout(() => finish(null), timeoutMs);
    const afterSubscribe = legacyRunRow(page, jobId);
    if (afterSubscribe) finish(afterSubscribe);
  });
}

async function openLegacyRun(page: HTMLElement, jobId: string): Promise<boolean> {
  const row = await resolveLegacyOperationTarget({
    find: () => legacyRunRow(page, jobId),
    refresh: () => requestLegacyRunsRefresh(page),
    wait: () => waitForLegacyRunRow(page, jobId),
  });
  if (!row) return false;
  row.click();
  return true;
}

function TimelineDetails({ run, now }: { run: OperationRun; now: number }) {
  const timeline = buildOperationTimeline(run, now);
  return <section className="operation-timeline-panel">
    <div className="operation-timeline-head">
      <div><span>ВРЕМЕННЯ ШКАЛА</span><h3>Продолжительность выполнения</h3></div>
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
        <div className="operation-stage-bar"><i style={{ width: `${stage.progress}%`} } /></div>
        <small>Длительность: <b>{formatOperationDuration(stage.durationMs)}</b>{stage.waitingMs && stage.waitingMs > 0 ? ` · ожидание до этапа: ${formatOperationDuration(stage.waitingMs)}` : ""}{stage.offsetMs !== null ? ` µ от старта: +${formatOperationDuration(stage.offsetMs)}` : ""}</small>
        {stage.error && <p className="operation-stage-error">{stage.error}</p>}
      </div>
    </article>)}</div> : <div className="operation-timeline-empty"><strong>Детализация нт етапов отсутствует</strong><span>Общая время рассчитана по времени запуска, обновления и завершения задания.</span></div>}
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
    const id = +