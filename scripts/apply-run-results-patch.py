from pathlib import Path
import re


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if text.count(old) != 1:
        raise RuntimeError(f"{label}: expected one match, found {text.count(old)}")
    return text.replace(old, new, 1)


worker_path = Path("worker/index.ts")
worker = worker_path.read_text()
worker = replace_once(
    worker,
    'import { listRunReplaySummaries, readRunReplay, saveRunReplay, type RunReplaySummary } from "../run-replays";\n',
    'import { listRunReplaySummaries, readRunReplay, saveRunReplay, type RunReplaySummary } from "../run-replays";\nimport { listRunResults, readRunResultFile, saveRunResult, type PublicRunResult } from "../run-results";\n',
    "worker result import",
)
worker = replace_once(
    worker,
    '  XYOPS_ROUTES_JSON?: string;\n',
    '  XYOPS_ROUTES_JSON?: string;\n  XYOPS_RESULT_FILE_MAX_BYTES?: string;\n',
    "worker result file limit env",
)
worker = replace_once(
    worker,
    'function publicRun(run: OperationRun, replay: RunReplaySummary | undefined, canRun: boolean) {',
    'function publicRun(run: OperationRun, replay: RunReplaySummary | undefined, result: PublicRunResult | undefined, canRun: boolean) {',
    "publicRun signature",
)
worker = replace_once(
    worker,
    '    error: run.error || null,\n    actions: {',
    '    error: run.error || null,\n    result: result ?? null,\n    actions: {',
    "publicRun result",
)

old_sync = '''async function syncOperationRuns(env: Env, xyopsUrl: string | null, runs: OperationRun[]): Promise<OperationRun[]> {
  if (!env.DB || !xyopsUrl || !env.XYOPS_API_KEY || !runs.some((run) => run.mode === "live" && ["queued", "running", "unknown"].includes(run.status))) return runs;
  try {
    const response = await fetch(`${xyopsUrl}/api/app/get_active_jobs/v1`, { headers: { "x-api-key": env.XYOPS_API_KEY, accept: "application/json" }, signal: AbortSignal.timeout(12000) });
    if (!response.ok) return runs;
    const rows = extractJobRows(await response.json().catch(() => null));
    const byId = new Map(rows.map((row) => [String(row.job_id ?? row.jobId ?? row.id ?? ""), row]));
    const unresolved = runs.filter((run) => run.mode === "live" && ["queued", "running", "unknown"].includes(run.status) && run.jobId && !byId.has(run.jobId));
    if (unresolved.length) {
      const ids = unresolved.slice(0, 100).map((run) => run.jobId);
      try {
        const detailsResponse = await fetch(`${xyopsUrl}/api/app/get_jobs/v1`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": env.XYOPS_API_KEY, accept: "application/json" },
          body: JSON.stringify({ ids, verbose: false }),
          signal: AbortSignal.timeout(12000),
        });
        const detailsPayload = await detailsResponse.json().catch(() => null) as Record<string, unknown> | null;
        if (detailsResponse.ok && detailsPayload && xyopsPayloadSucceeded(detailsPayload) && Array.isArray(detailsPayload.jobs)) {
          for (const row of detailsPayload.jobs) {
            if (!row || typeof row !== "object" || Array.isArray(row) || "err" in row) continue;
            const record = row as Record<string, unknown>;
            const id = String(record.job_id ?? record.jobId ?? record.id ?? "");
            if (id) byId.set(id, record);
          }
        }
      } catch {}
    }
    const now = Date.now();
    for (const run of runs) {
      const row = byId.get(run.jobId);
      if (!row) continue;
      const nextStatus = jobLifecycleStatus(row, rows.includes(row));
      const nextStages = extractJobStages(row);
      const stagesChanged = nextStages.length > 0 && JSON.stringify(nextStages) !== JSON.stringify(run.stages);
      if ((nextStatus === "unknown" || nextStatus === run.status) && !stagesChanged) continue;
      if (nextStatus !== "unknown") run.status = nextStatus;
      if (nextStages.length) run.stages = nextStages;
      run.updatedAt = now;
      if (nextStatus === "success" || nextStatus === "failed") run.completedAt = jobTimestamp(row.completed ?? row.completed_at ?? row.finished_at) ?? now;
      if (nextStatus === "failed") run.error = String(row.description ?? row.error ?? row.message ?? "XYOps job failed").slice(0, 500);
      await saveOperationRun(env, run);
    }
  } catch {}
  return runs;
}
'''
new_sync = '''async function syncOperationRuns(env: Env, xyopsUrl: string | null, runs: OperationRun[]): Promise<OperationRun[]> {
  if (!env.DB || !xyopsUrl || !env.XYOPS_API_KEY) return runs;
  const existingResults = await listRunResults(env, runs.map((run) => run.id));
  const activeRuns = runs.filter((run) => run.mode === "live" && ["queued", "running", "unknown"].includes(run.status) && run.jobId);
  const resultPending = runs.filter((run) => run.mode === "live" && ["success", "failed"].includes(run.status) && run.jobId && !existingResults.has(run.id));
  if (!activeRuns.length && !resultPending.length) return runs;
  try {
    let rows: Array<Record<string, unknown>> = [];
    if (activeRuns.length) {
      try {
        const response = await fetch(`${xyopsUrl}/api/app/get_active_jobs/v1`, { headers: { "x-api-key": env.XYOPS_API_KEY, accept: "application/json" }, signal: AbortSignal.timeout(12000) });
        if (response.ok) rows = extractJobRows(await response.json().catch(() => null));
      } catch {}
    }
    const byId = new Map(rows.map((row) => [String(row.job_id ?? row.jobId ?? row.id ?? ""), row]));
    const detailRuns = [...activeRuns.filter((run) => !byId.has(run.jobId)), ...resultPending];
    const ids = Array.from(new Set(detailRuns.map((run) => run.jobId).filter(Boolean))).slice(0, 100);
    if (ids.length) {
      try {
        const detailsResponse = await fetch(`${xyopsUrl}/api/app/get_jobs/v1`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": env.XYOPS_API_KEY, accept: "application/json" },
          body: JSON.stringify({ ids, verbose: true }),
          signal: AbortSignal.timeout(12000),
        });
        const detailsPayload = await detailsResponse.json().catch(() => null) as Record<string, unknown> | null;
        if (detailsResponse.ok && detailsPayload && xyopsPayloadSucceeded(detailsPayload) && Array.isArray(detailsPayload.jobs)) {
          for (const row of detailsPayload.jobs) {
            if (!row || typeof row !== "object" || Array.isArray(row) || "err" in row) continue;
            const record = row as Record<string, unknown>;
            const id = String(record.job_id ?? record.jobId ?? record.id ?? "");
            if (id) byId.set(id, record);
          }
        }
      } catch {}
    }
    const now = Date.now();
    for (const run of runs) {
      const row = byId.get(run.jobId);
      if (!row) continue;
      const nextStatus = jobLifecycleStatus(row, rows.includes(row));
      const nextStages = extractJobStages(row);
      const stagesChanged = nextStages.length > 0 && JSON.stringify(nextStages) !== JSON.stringify(run.stages);
      const statusChanged = nextStatus !== "unknown" && nextStatus !== run.status;
      if (statusChanged) run.status = nextStatus;
      if (nextStages.length) run.stages = nextStages;
      if (statusChanged || stagesChanged) {
        run.updatedAt = now;
        if (["success", "failed", "cancelled"].includes(run.status)) run.completedAt = jobTimestamp(row.completed ?? row.completed_at ?? row.finished_at) ?? now;
        if (run.status === "failed") run.error = String(row.description ?? row.error ?? row.message ?? "XYOps job failed").slice(0, 500);
        await saveOperationRun(env, run);
      }
      if (["success", "failed"].includes(run.status)) await saveRunResult(env, run.id, run.jobId, row);
    }
  } catch {}
  return runs;
}
'''
worker = replace_once(worker, old_sync, new_sync, "syncOperationRuns")

file_endpoint = '''  const runFileMatch = url.pathname.match(/^\/api\/integrations\/runs\/([A-Za-z0-9_-]{1,160})\/files\/([A-Za-z0-9_-]{1,160})$/);
  if (request.method === "GET" && runFileMatch) {
    const denied = requirePortalPermission(request, baseEnv, "directory.read");
    if (denied) return denied;
    if (!xyopsUrl || !env.XYOPS_API_KEY) return json({ error: "XYOps is not configured" }, 503);
    const runId = runFileMatch[1];
    const run = (await listOperationRuns(baseEnv, 200)).find((item) => item.id === runId);
    if (!run || run.mode !== "live" || !/^[a-z0-9_]+$/.test(run.jobId)) return json({ error: "Файл запуска не найден" }, 404);
    const file = await readRunResultFile(baseEnv, runId, runFileMatch[2]);
    if (!file) return json({ error: "Файл результата не найден" }, 404);
    try {
      const response = await fetch(new URL(file.path, `${xyopsUrl}/`), {
        method: "GET",
        headers: { "x-api-key": env.XYOPS_API_KEY, accept: "application/octet-stream" },
        redirect: "manual",
        signal: AbortSignal.timeout(30000),
      });
      if (response.status >= 300 && response.status < 400) return json({ error: "XYOps перенаправил запрос файла; скачивание заблокировано" }, 502);
      if (!response.ok || !response.body) return json({ error: "XYOps не вернул файл результата" }, response.status === 404 ? 404 : 502);
      const configuredLimit = Number(env.XYOPS_RESULT_FILE_MAX_BYTES ?? 52_428_800);
      const maxBytes = Number.isFinite(configuredLimit) && configuredLimit > 0 ? Math.min(configuredLimit, 536_870_912) : 52_428_800;
      const contentLength = Number(response.headers.get("content-length") ?? 0);
      if (Number.isFinite(contentLength) && contentLength > maxBytes) return json({ error: "Файл результата превышает разрешённый размер", maxBytes }, 413);
      const fallbackName = file.filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_") || "result.bin";
      const headers = new Headers({
        "content-type": "application/octet-stream",
        "content-disposition": `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      });
      if (contentLength > 0) headers.set("content-length", String(contentLength));
      return new Response(response.body, { status: 200, headers });
    } catch {
      return json({ error: "Не удалось скачать файл результата из XYOps" }, 502);
    }
  }

'''
worker = replace_once(worker, '  const runActionMatch = url.pathname.match(/^\\/api\\/integrations\\/runs\\/([A-Za-z0-9_-]{1,160})\\/(cancel|rerun)$/);\n', file_endpoint + '  const runActionMatch = url.pathname.match(/^\\/api\\/integrations\\/runs\\/([A-Za-z0-9_-]{1,160})\\/(cancel|rerun)$/);\n', "run file endpoint")
worker = replace_once(worker, 'return json({ ok: true, action: "cancel", run: publicRun(run, undefined, true) });', 'return json({ ok: true, action: "cancel", run: publicRun(run, undefined, undefined, true) });', "cancel publicRun")
old_runs = '''    const access = portalAccess(request, baseEnv);
    const replay = await listRunReplaySummaries(baseEnv, runs.map((run) => run.id));
    return json({ persistenceAvailable: Boolean(baseEnv.DB), runs: runs.map((run) => publicRun(run, replay.get(run.id), access.permissions.includes("xyops.run"))), stats: {'''
new_runs = '''    const access = portalAccess(request, baseEnv);
    const [replay, results] = await Promise.all([
      listRunReplaySummaries(baseEnv, runs.map((run) => run.id)),
      listRunResults(baseEnv, runs.map((run) => run.id)),
    ]);
    return json({ persistenceAvailable: Boolean(baseEnv.DB), runs: runs.map((run) => publicRun(run, replay.get(run.id), results.get(run.id), access.permissions.includes("xyops.run"))), stats: {'''
worker = replace_once(worker, old_runs, new_runs, "runs result mapping")
worker_path.write_text(worker)


page_path = Path("app/page.tsx")
page = page_path.read_text()
old_types = '''type RunStage = { id: string; title: string; status: RunStatus; startedAt: number | null; completedAt: number | null; error: string };
type RunRecord = { id: string; jobId: string; eventId: string; title: string; kind: "event" | "workflow"; mode: "demo" | "live"; status: RunStatus; actor: string; subject: string; error: string | null; stages: RunStage[]; startedAt: number; updatedAt: number; completedAt: number | null; actions: { cancel: boolean; rerun: boolean; rerunLabel: string; reason: string; parentRunId: string } };'''
new_types = '''type RunStage = { id: string; title: string; status: RunStatus; startedAt: number | null; completedAt: number | null; error: string };
type RunResultValue = { key: string; label: string; value: string; kind: "text" | "number" | "boolean" | "json" };
type RunResultLink = { id: string; title: string; url: string; host: string };
type RunResultFile = { id: string; filename: string; size: number; mimeType: string; downloadUrl: string };
type RunResult = { available: boolean; summary: string; values: RunResultValue[]; links: RunResultLink[]; files: RunResultFile[]; table: { columns: string[]; rows: string[][] } | null; capturedAt: number; truncated: boolean };
type RunRecord = { id: string; jobId: string; eventId: string; title: string; kind: "event" | "workflow"; mode: "demo" | "live"; status: RunStatus; actor: string; subject: string; error: string | null; stages: RunStage[]; startedAt: number; updatedAt: number; completedAt: number | null; result: RunResult | null; actions: { cancel: boolean; rerun: boolean; rerunLabel: string; reason: string; parentRunId: string } };'''
page = replace_once(page, old_types, new_types, "page result types")

pattern = re.compile(r'function RunDetails\(\{ run, close, onAction \}:.*?\n\}\n\nfunction formatDateTime', re.S)
replacement = '''function RunDetails({ run, close, onAction }: { run: RunRecord; close: () => void; onAction: (run: RunRecord, action: "cancel" | "rerun") => Promise<boolean> }) {
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

function formatDateTime'''
page, count = pattern.subn(replacement, page, count=1)
if count != 1:
    raise RuntimeError(f"RunDetails block: expected one match, found {count}")
page_path.write_text(page)


css_path = Path("app/globals.css")
css = css_path.read_text()
marker = "/* XYOPS_RUN_RESULTS */"
if marker not in css:
    css += '''

/* XYOPS_RUN_RESULTS */
.run-results { margin-top: 18px; padding-top: 18px; border-top: 1px solid var(--border); display: grid; gap: 14px; }
.run-results-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.run-results-head h3 { margin: 3px 0 0; }
.run-results-head > small { color: var(--muted); white-space: nowrap; }
.run-result-summary { border: 1px solid var(--border); border-radius: 14px; padding: 14px 16px; background: color-mix(in srgb, var(--panel) 92%, var(--accent)); }
.run-result-summary p { margin: 6px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.run-result-values { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; }
.run-result-values article { min-width: 0; padding: 12px 14px; border: 1px solid var(--border); border-radius: 12px; background: var(--panel); }
.run-result-values small { display: block; color: var(--muted); margin-bottom: 5px; }
.run-result-values strong { display: block; overflow-wrap: anywhere; white-space: pre-wrap; }
.run-result-table-wrap { overflow: auto; border: 1px solid var(--border); border-radius: 12px; max-height: 320px; }
.run-result-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.run-result-table th, .run-result-table td { padding: 9px 11px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; white-space: pre-wrap; overflow-wrap: anywhere; }
.run-result-table th { position: sticky; top: 0; z-index: 1; background: var(--panel); }
.run-result-links, .run-result-files { display: grid; gap: 8px; }
.run-result-links > strong, .run-result-files > strong { margin-bottom: 2px; }
.run-result-links a, .run-result-files a { display: flex; align-items: center; gap: 11px; padding: 11px 13px; border: 1px solid var(--border); border-radius: 12px; text-decoration: none; color: inherit; background: var(--panel); }
.run-result-links a:hover, .run-result-files a:hover { border-color: var(--accent); }
.run-result-links a > span, .run-result-files a > span { width: 30px; height: 30px; border-radius: 9px; display: grid; place-items: center; background: color-mix(in srgb, var(--accent) 15%, transparent); }
.run-result-links a div, .run-result-files a div { min-width: 0; display: grid; gap: 2px; }
.run-result-links a b, .run-result-files a b { overflow-wrap: anywhere; }
.run-result-links a small, .run-result-files a small { color: var(--muted); }
.run-result-note { margin: 0; color: var(--muted); font-size: 12px; }
@media (max-width: 720px) { .run-results-head { display: grid; } .run-results-head > small { white-space: normal; } }
'''
css_path.write_text(css)
