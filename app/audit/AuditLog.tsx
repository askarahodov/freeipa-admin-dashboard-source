"use client";

import { useCallback, useEffect, useState } from "react";

export type AuditEvent = {
  id: string;
  action: string;
  createdAt: number;
  actorIdentity: string;
  actorRole: string;
  outcome: string;
  correlationId: string;
  eventId?: string | null;
  schemaVersion?: string | null;
  approvalId?: string | null;
  runId?: string | null;
  jobId?: string | null;
  errorCode?: string | null;
  metadata?: Record<string, unknown>;
};

function Status({ children, tone = "success" }: { children: React.ReactNode; tone?: string }) {
  return <span className={`status ${tone}`}>{children}</span>;
}

export function AuditLog() {
  const [items, setItems] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [actor, setActor] = useState("");
  const [action, setAction] = useState("");
  const [outcome, setOutcome] = useState("");
  const [correlationId, setCorrelationId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "200" });
      if (actor.trim()) params.set("actor", actor.trim());
      if (action.trim()) params.set("action", action.trim());
      if (outcome) params.set("outcome", outcome);
      if (correlationId.trim()) params.set("correlationId", correlationId.trim());
      const response = await fetch(`/api/integrations/audit?${params}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Журнал аудита недоступен");
      setItems(Array.isArray(data.events) ? data.events : []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [actor, action, outcome, correlationId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  return <div className="audit-page">
    <section className="panel audit-toolbar"><div><span className="eyebrow">APPEND-ONLY AUDIT</span><h2>Журнал административных действий</h2><p>Correlation ID связывает approval, запуск, XYOps Job, изменение статуса и результат. Секретные значения не сохраняются.</p></div><button className="secondary" disabled={loading} onClick={() => void load()}>{loading ? "Загрузка…" : "Обновить"}</button></section>
    <section className="panel audit-filters"><label>Пользователь<input value={actor} onChange={(event) => setActor(event.target.value)} placeholder="admin@example.test" /></label><label>Действие<input value={action} onChange={(event) => setAction(event.target.value)} placeholder="approval.approve" /></label><label>Результат<select value={outcome} onChange={(event) => setOutcome(event.target.value)}><option value="">Все</option><option value="success">success</option><option value="failure">failure</option><option value="pending">pending</option><option value="unknown">unknown</option><option value="info">info</option></select></label><label>Correlation ID<input value={correlationId} onChange={(event) => setCorrelationId(event.target.value)} placeholder="cor_…" /></label></section>
    <section className="audit-list">{items.map((item) => <article className="panel audit-entry" key={item.id}><div className="audit-entry-head"><div><strong>{item.action}</strong><small>{new Date(item.createdAt).toLocaleString("ru-RU")} · {item.actorIdentity} · {item.actorRole}</small></div><Status tone={item.outcome === "success" ? "success" : item.outcome === "failure" ? "danger" : item.outcome === "pending" ? "violet" : "neutral"}>{item.outcome}</Status></div><div className="audit-links"><code>{item.correlationId}</code>{item.eventId && <span>Event: <b>{item.eventId}</b></span>}{item.schemaVersion && <span>Schema: <b>{item.schemaVersion}</b></span>}{item.approvalId && <span>Approval: <b>{item.approvalId}</b></span>}{item.runId && <span>Run: <b>{item.runId}</b></span>}{item.jobId && <span>Job: <b>{item.jobId}</b></span>}</div>{item.errorCode && <p className="audit-error">Ошибка: {item.errorCode}</p>}{Object.keys(item.metadata ?? {}).length > 0 && <details><summary>Безопасные технические данные</summary><pre>{JSON.stringify(item.metadata, null, 2)}</pre></details>}</article>)}{!items.length && <section className="panel catalog-empty"><strong>{loading ? "Загрузка журнала…" : "События не найдены"}</strong><span>Измените фильтры или выполните административную операцию.</span></section>}</section>
  </div>;
}
