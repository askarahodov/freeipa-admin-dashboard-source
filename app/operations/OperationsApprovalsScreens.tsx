"use client";

import { useState } from "react";
import { Button, DataListPage, DataListState, DataTable } from "../ui";

export type RunStatus = "queued" | "running" | "success" | "failed" | "cancelled" | "unknown";
export type RunStage = { id: string; title: string; status: RunStatus; startedAt: number | null; completedAt: number | null; error: string };
export type RunResultValue = { key: string; label: string; value: string; kind: "text" | "number" | "boolean" | "json" };
export type RunResultLink = { id: string; title: string; url: string; host: string };
export type RunResultFile = { id: string; filename: string; size: number; mimeType: string; downloadUrl: string };
export type RunResult = { available: boolean; summary: string; values: RunResultValue[]; links: RunResultLink[]; files: RunResultFile[]; table: { columns: string[]; rows: string[][] } | null; capturedAt: number; truncated: boolean };
export type RunRecord = { id: string; jobId: string; eventId: string; title: string; kind: "event" | "workflow"; mode: "demo" | "live"; status: RunStatus; actor: string; subject: string; error: string | null; stages: RunStage[]; startedAt: number; updatedAt: number; completedAt: number | null; result: RunResult | null; actions: { cancel: boolean; rerun: boolean; rerunLabel: string; reason: string; parentRunId: string } };
export type RunStats = { today: number; queued: number; success: number; failed: number };
export type ApprovalStatus = "pending" | "approved" | "rejected" | "cancelled" | "expired" | "executing" | "executed" | "failed" | "unknown";
export type ApprovalRecord = { id: string; eventId: string; title: string; category: string; schemaVersion: string; requesterIdentity: string; requesterRole: "viewer" | "operator" | "admin"; status: ApprovalStatus; requiredApprovals: number; approvals: number; rejections: number; approverRoles: Array<"viewer" | "operator" | "admin">; approverGroups: string[]; requesterCannotApprove: boolean; summary: { subject: string; targets: string[]; values: Array<{ key: string; label: string; value: string }>; hiddenSecrets: number; secretFields: Array<{ key: string; label: string }> }; expiresAt: number; createdAt: number; updatedAt: number; approvedAt: number | null; executedAt: number | null; runId: string; parentRunId: string; error: string; myDecision: "approve" | "reject" | null; actions: { approve: boolean; reject: boolean; cancel: boolean; execute: boolean } };

function Status({ children, tone = "success" }: { children: React.ReactNode; tone?: string }) {
  return <span className={`status ${tone}`}>{children}</span>;
}

export function Approvals({ items, pendingForMe, loading, canApprove, refresh, onAction }: { items: ApprovalRecord[]; pendingForMe: number; loading: boolean; canApprove: boolean; refresh: () => void; onAction: (item: ApprovalRecord, action: "approve" | "reject" | "cancel" | "execute") => Promise<boolean> }) {
  const labels: Record<ApprovalStatus, string> = { pending: "Ожидает", approved: "Согласовано", rejected: "Отклонено", cancelled: "Отменено", expired: "Истекло", executing: "Запускается", executed: "Выполнено", failed: "Ошибка", unknown: "Неизвестно" };
  const tone: Record<ApprovalStatus, string> = { pending: "warning", approved: "success", rejected: "error", cancelled: "neutral", expired: "neutral", executing: "violet", executed: "success", failed: "error", unknown: "warning" };
  return <div className="approvals-page"><section className="panel approval-summary"><div><span className="eyebrow">FOUR-EYES CONTROL</span><h2>Согласования опасных процессов</h2><p>XYOps получает команду только после независимого решения и отдельного нажатия «Выполнить» инициатором.</p></div><Status tone={pendingForMe ? "warning" : "success"}>{pendingForMe ? `${pendingForMe} ждут решения` : "Очередь чиста"}</Status><button className="secondary" disabled={loading} onClick={refresh}>{loading ? "Обновление…" : "Обновить"}</button></section><div className="approval-list">{items.map((item) => <article className={`panel approval-card ${item.status}`} key={item.id}><div className="approval-card-head"><div><span className="eyebrow">{item.category} · {item.eventId}</span><h3>{item.title}</h3><p>Инициатор: <b>{item.requesterIdentity}</b> · истекает {formatDateTime(item.expiresAt)}</p></div><Status tone={tone[item.status]}>{labels[item.status]}</Status></div><div className="approval-progress"><span><b>{item.approvals}</b> / {item.requiredApprovals} согласований</span><progress max={item.requiredApprovals} value={Math.min(item.approvals, item.requiredApprovals)} /></div><div className="approval-details"><div><strong>Targets</strong><span>{item.summary.targets.length ? item.summary.targets.join(", ") : "из процесса"}</span></div><div><strong>Согласующие</strong><span>{[...item.approverRoles, ...item.approverGroups].join(", ") || "не настроены"}</span></div>{item.summary.values.map((value) => <div key={value.key}><strong>{value.label}</strong><span>{value.value}</span></div>)}{item.summary.hiddenSecrets > 0 && <div><strong>Секретные поля</strong><span>{item.summary.hiddenSecrets} · будут введены заново перед выполнением</span></div>}</div>{item.error && <div className="approval-error">{item.error}</div>}<div className="approval-actions">{item.actions.approve && canApprove && <button className="primary" onClick={() => void onAction(item, "approve")}>Одобрить</button>}{item.actions.reject && canApprove && <button className="danger-button" onClick={() => void onAction(item, "reject")}>Отклонить</button>}{item.actions.cancel && <button className="secondary" onClick={() => void onAction(item, "cancel")}>Отменить заявку</button>}{item.actions.execute && <button className="primary" onClick={() => void onAction(item, "execute")}>Выполнить в XYOps</button>}{item.myDecision && <Status tone="neutral">Моё решение: {item.myDecision === "approve" ? "одобрено" : "отклонено"}</Status>}</div></article>)}{!items.length && <div className="panel catalog-empty"><strong>Заявок пока нет</strong><span>Опасные Events и Workflows появятся здесь до фактического запуска.</span></div>}</div></div>;
}

export function Operations({ runs, stats, loading, refresh, onAction }: { runs: RunRecord[]; stats: RunStats; loading: boolean; refresh: () => void; onAction: (run: RunRecord, action: "cancel" | "rerun") => Promise<boolean> }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = runs.find((run) => run.id === selectedId) ?? null;
  return <>
    <DataListPage
      className="section-page"
      title="Журнал операций"
      description="Прямые изменения FreeIPA и запуски автоматизаций XYOps"
      actions={<Button variant="secondary" disabled={loading} onClick={refresh}>{loading ? "Обновление…" : "Обновить"}</Button>}
      toolbar={<div className="stats-strip"><span><b>{stats.today}</b> операций сегодня</span><span><i className="dot green" /><b>{stats.success}</b> успешно</span><span><i className="dot amber" /><b>{stats.queued}</b> выполняются</span><span><i className="dot red-dot" /><b>{stats.failed}</b> ошибки</span></div>}
    >
      <OperationTable rows={runs} detailed onSelect={(run) => setSelectedId(run.id)} />
    </DataListPage>
    {selected && <RunDetails run={selected} close={() => setSelectedId(null)} onAction={onAction} />}
  </>;
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

export function formatDateTime(value: number) { return value ? new Date(value).toLocaleString("ru-RU") : "—"; }

export function RunStatusBadge({ status }: { status: RunStatus }) {
  const labels: Record<RunStatus, string> = { queued: "В очереди", running: "Выполняется", success: "Успешно", failed: "Ошибка", cancelled: "Остановлено", unknown: "Неизвестно" };
  const tones: Record<RunStatus, string> = { queued: "warning", running: "violet", success: "success", failed: "error", cancelled: "neutral", unknown: "neutral" };
  return <Status tone={tones[status]}>{labels[status]}</Status>;
}

export function OperationTable({ rows, detailed = false, onSelect }: { rows: RunRecord[]; detailed?: boolean; onSelect?: (run: RunRecord) => void }) {
  if (!rows.length) return <DataListState kind="empty" title="Операций пока нет" description="Запуски Events и Workflows появятся здесь автоматически." />;
  return <DataTable label="Журнал операций" className="data-table"><thead><tr className={`tr th ${detailed ? "ops-detailed" : "ops-row"}`}><th>Операция</th><th>Объект</th><th>Статус</th><th>Инициатор</th><th>Время</th>{detailed && <th>Job</th>}</tr></thead><tbody>{rows.map((run) => {
    const activate = () => onSelect?.(run);
    return <tr className={`tr ${detailed ? "ops-detailed" : "ops-row"}${onSelect ? " selectable-run" : ""}`} key={run.id} title={run.error ?? ""} onClick={activate} onKeyDown={onSelect ? (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); activate(); } } : undefined} tabIndex={onSelect ? 0 : undefined}><td><span className="operation"><i className={run.status}>↗</i>{run.title}</span></td><td>{run.subject}</td><td><RunStatusBadge status={run.status} /></td><td>{run.actor}</td><td><strong>{new Date(run.startedAt).toLocaleTimeString("ru-RU")}</strong><small>{new Date(run.startedAt).toLocaleDateString("ru-RU")}</small></td>{detailed && <td className="mono">{run.jobId}</td>}</tr>;
  })}</tbody></DataTable>;
}
