#!/usr/bin/env python3
from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"Patch target not found: {label}")
    return text.replace(old, new, 1)

worker_path = Path("worker/index.ts")
worker = worker_path.read_text()

worker = replace_once(
    worker,
    'import { fieldConditionMatches, normalizeFieldCondition } from "../field-conditions";\n',
    'import { fieldConditionMatches, normalizeFieldCondition } from "../field-conditions";\nimport { listRunReplaySummaries, readRunReplay, saveRunReplay, type RunReplaySummary } from "../run-replays";\n',
    "worker replay import",
)
worker = replace_once(
    worker,
    'type RunStatus = "queued" | "running" | "success" | "failed" | "unknown";',
    'type RunStatus = "queued" | "running" | "success" | "failed" | "cancelled" | "unknown";',
    "worker cancelled status type",
)
worker = replace_once(
    worker,
    '  if (["failed", "failure", "error", "cancelled", "canceled", "timeout", "timed_out"].includes(normalized)) return "failed";\n',
    '  if (["cancelled", "canceled", "aborted", "abort"].includes(normalized)) return "cancelled";\n  if (["failed", "failure", "error", "timeout", "timed_out"].includes(normalized)) return "failed";\n',
    "worker cancelled status normalization",
)
worker = replace_once(
    worker,
    'function publicRun(run: OperationRun) {\n  return { ...run, error: run.error || null };\n}\n',
    '''function publicRun(run: OperationRun, replay: RunReplaySummary | undefined, canRun: boolean) {
  const active = ["queued", "running", "unknown"].includes(run.status);
  const terminal = ["success", "failed", "cancelled"].includes(run.status);
  return {
    ...run,
    error: run.error || null,
    actions: {
      cancel: canRun && run.mode === "live" && active && /^[a-z0-9_]+$/.test(run.jobId),
      rerun: canRun && terminal && Boolean(replay?.replayable) && !run.eventId.startsWith("freeipa:"),
      rerunLabel: run.status === "success" ? "Запустить снова" : "Повторить",
      reason: replay?.reason || "",
      parentRunId: replay?.parentRunId || "",
    },
  };
}
''',
    "worker public run actions",
)
worker = replace_once(
    worker,
    '    startedAt: now, updatedAt: now, completedAt: input.status === "success" || input.status === "failed" ? now : null,\n',
    '    startedAt: now, updatedAt: now, completedAt: ["success", "failed", "cancelled"].includes(input.status) ? now : null,\n',
    "worker completed cancelled run",
)

runs_marker = '''  if (request.method === "GET" && url.pathname === "/api/integrations/runs") {
    const limit = Number(url.searchParams.get("limit") ?? 100);
    let runs = await listOperationRuns(baseEnv, Number.isFinite(limit) ? limit : 100);
    if (url.searchParams.get("sync") !== "0") runs = await syncOperationRuns(env, xyopsUrl, runs);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayRuns = runs.filter((run) => run.startedAt >= today.getTime());
    return json({ persistenceAvailable: Boolean(baseEnv.DB), runs: runs.map(publicRun), stats: {
      today: todayRuns.length,
      queued: todayRuns.filter((run) => run.status === "queued" || run.status === "running").length,
      success: todayRuns.filter((run) => run.status === "success").length,
      failed: todayRuns.filter((run) => run.status === "failed").length,
    } });
  }
'''
actions_and_runs = '''  const runActionMatch = url.pathname.match(/^\\/api\\/integrations\\/runs\\/([A-Za-z0-9_-]{1,160})\\/(cancel|rerun)$/);
  if (request.method === "POST" && runActionMatch) {
    const denied = requirePortalPermission(request, baseEnv, "xyops.run");
    if (denied) return denied;
    const runId = runActionMatch[1];
    const action = runActionMatch[2];
    const run = (await listOperationRuns(baseEnv, 200)).find((item) => item.id === runId);
    if (!run) return json({ error: "Запуск не найден" }, 404);

    if (action === "cancel") {
      if (run.mode !== "live" || !["queued", "running", "unknown"].includes(run.status)) return json({ error: "Остановить можно только активное задание XYOps" }, 409);
      if (!xyopsUrl || !env.XYOPS_API_KEY) return json({ error: "XYOps is not configured" }, 503);
      if (!/^[a-z0-9_]+$/.test(run.jobId)) return json({ error: "Некорректный Job ID XYOps" }, 400);
      try {
        const response = await fetch(`${xyopsUrl}/api/app/abort_job/v1`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": env.XYOPS_API_KEY, accept: "application/json" },
          body: JSON.stringify({ id: run.jobId }),
          signal: AbortSignal.timeout(15000),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !xyopsPayloadSucceeded(payload)) return json({ error: "XYOps не подтвердил остановку задания" }, 502);
        const now = Date.now();
        run.status = "cancelled";
        run.error = `Остановлено пользователем: ${requestActor(request)}`.slice(0, 500);
        run.updatedAt = now;
        run.completedAt = now;
        await saveOperationRun(baseEnv, run);
        return json({ ok: true, action: "cancel", run: publicRun(run, undefined, true) });
      } catch {
        return json({ error: "Не удалось отправить команду остановки в XYOps" }, 502);
      }
    }

    if (["queued", "running", "unknown"].includes(run.status)) return json({ error: "Активное задание нельзя запускать повторно" }, 409);
    const replay = await readRunReplay(baseEnv, run.id);
    if (!replay?.summary.replayable || !replay.spec) return json({ error: replay?.summary.reason || "Параметры безопасного повтора недоступны" }, 409);
    try {
      const catalog = await loadCatalog(env, xyopsUrl);
      if (catalog.mode === "unconfigured") return json({ error: "XYOps is not configured" }, 503);
      const event = catalog.events.find((item) => item.id === replay.spec?.eventId && item.enabled);
      if (!event) return json({ error: "Исходный процесс отсутствует или отключён" }, 409);
      if (!event.schemaVersion || event.schemaVersion !== replay.summary.schemaVersion) return json({ error: "Схема процесса изменилась. Откройте актуальную форму и проверьте параметры заново.", schemaChanged: true }, 409);
      let actionBody: Record<string, unknown> = {};
      try { actionBody = await request.json() as Record<string, unknown>; } catch {}
      if (event.dangerous && actionBody.confirm !== true) return json({ error: "Для опасного процесса требуется повторное подтверждение", requiresConfirmation: true }, 409);
      const rerunUrl = new URL(request.url);
      rerunUrl.pathname = "/api/integrations/catalog/run";
      rerunUrl.search = "";
      const headers = new Headers(request.headers);
      headers.set("content-type", "application/json");
      return handleIntegrationApi(new Request(rerunUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({ eventId: replay.spec.eventId, values: replay.spec.values, targets: replay.spec.targets, replayOf: run.id }),
      }), baseEnv, rerunUrl);
    } catch {
      return json({ error: "Не удалось подготовить безопасный повтор запуска" }, 502);
    }
  }

  if (request.method === "GET" && url.pathname === "/api/integrations/runs") {
    const limit = Number(url.searchParams.get("limit") ?? 100);
    let runs = await listOperationRuns(baseEnv, Number.isFinite(limit) ? limit : 100);
    if (url.searchParams.get("sync") !== "0") runs = await syncOperationRuns(env, xyopsUrl, runs);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayRuns = runs.filter((run) => run.startedAt >= today.getTime());
    const access = portalAccess(request, baseEnv);
    const replay = await listRunReplaySummaries(baseEnv, runs.map((run) => run.id));
    return json({ persistenceAvailable: Boolean(baseEnv.DB), runs: runs.map((run) => publicRun(run, replay.get(run.id), access.permissions.includes("xyops.run"))), stats: {
      today: todayRuns.length,
      queued: todayRuns.filter((run) => run.status === "queued" || run.status === "running").length,
      success: todayRuns.filter((run) => run.status === "success").length,
      failed: todayRuns.filter((run) => run.status === "failed").length,
    } });
  }
'''
worker = replace_once(worker, runs_marker, actions_and_runs, "worker run endpoints")

parent_expr = 'typeof body.replayOf === "string" ? body.replayOf.slice(0, 160) : ""'
worker = replace_once(
    worker,
    '        await saveOperationRun(baseEnv, run);\n        return json({ mode: "demo", queued: true, runId: run.id, jobId: run.jobId, status: run.status, process: { id: event.id, title: event.title, kind: event.kind } }, 202);\n',
    f'        await saveOperationRun(baseEnv, run);\n        await saveRunReplay(baseEnv, run.id, event, values, requestedTargets, {parent_expr});\n        return json({{ mode: "demo", queued: true, runId: run.id, jobId: run.jobId, status: run.status, process: {{ id: event.id, title: event.title, kind: event.kind }} }}, 202);\n',
    "worker demo replay save",
)
worker = replace_once(
    worker,
    '        await saveOperationRun(baseEnv, run);\n        return json({ error: "XYOps run_event failed", runId: run.id }, 502);\n',
    f'        await saveOperationRun(baseEnv, run);\n        await saveRunReplay(baseEnv, run.id, event, values, requestedTargets, {parent_expr});\n        return json({{ error: "XYOps run_event failed", runId: run.id }}, 502);\n',
    "worker failed replay save",
)
worker = replace_once(
    worker,
    '      await saveOperationRun(baseEnv, run);\n      return json({ mode: "live", queued: true, runId: run.id, jobId: run.jobId, status: run.status, process: { id: event.id, title: event.title, kind: event.kind } }, 202);\n',
    f'      await saveOperationRun(baseEnv, run);\n      await saveRunReplay(baseEnv, run.id, event, values, requestedTargets, {parent_expr});\n      return json({{ mode: "live", queued: true, runId: run.id, jobId: run.jobId, status: run.status, process: {{ id: event.id, title: event.title, kind: event.kind }} }}, 202);\n',
    "worker live replay save",
)
worker_path.write_text(worker)

app_path = Path("app/page.tsx")
app = app_path.read_text()
app = replace_once(
    app,
    'type RunStatus = "queued" | "running" | "success" | "failed" | "unknown";\n',
    'type RunStatus = "queued" | "running" | "success" | "failed" | "cancelled" | "unknown";\n',
    "app cancelled status type",
)
app = replace_once(
    app,
    'type RunRecord = { id: string; jobId: string; eventId: string; title: string; kind: "event" | "workflow"; mode: "demo" | "live"; status: RunStatus; actor: string; subject: string; error: string | null; stages: RunStage[]; startedAt: number; updatedAt: number; completedAt: number | null };\n',
    'type RunRecord = { id: string; jobId: string; eventId: string; title: string; kind: "event" | "workflow"; mode: "demo" | "live"; status: RunStatus; actor: string; subject: string; error: string | null; stages: RunStage[]; startedAt: number; updatedAt: number; completedAt: number | null; actions: { cancel: boolean; rerun: boolean; rerunLabel: string; reason: string; parentRunId: string } };\n',
    "app run actions type",
)
run_process_block = '''  async function runProcess(event: CatalogEvent, values: Record<string, unknown>, targets: string[]) {
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
'''
run_process_plus_actions = run_process_block + '''
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
      await loadRuns(true);
      notify(action === "cancel" ? "Команда остановки отправлена в XYOps" : `Создан новый запуск: ${result.jobId ?? "ожидает Job ID"}`);
      return true;
    } catch (error) {
      notify(error instanceof Error ? error.message : "Не удалось выполнить действие с заданием");
      return false;
    }
  }
'''
app = replace_once(app, run_process_block, run_process_plus_actions, "app run action handler")
app = replace_once(
    app,
    '{page === "operations" && <Operations runs={recentRuns} stats={runStats} loading={runsLoading} refresh={() => void loadRuns(true)} />}',
    '{page === "operations" && <Operations runs={recentRuns} stats={runStats} loading={runsLoading} refresh={() => void loadRuns(true)} onAction={runJobAction} />}',
    "app operations action prop",
)
old_operations = '''function Operations({ runs, stats, loading, refresh }: { runs: RunRecord[]; stats: RunStats; loading: boolean; refresh: () => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = runs.find((run) => run.id === selectedId) ?? null;
  return <div className="content-stack"><section className="panel table-panel section-page"><div className="panel-title"><div><h2>Журнал операций</h2><p>Прямые изменения FreeIPA и запуски автоматизаций XYOps</p></div><button className="secondary" disabled={loading} onClick={refresh}>{loading ? "Обновление…" : "⟳ Обновить"}</button></div><div className="stats-strip"><span><b>{stats.today}</b> операций сегодня</span><span><i className="dot green" /><b>{stats.success}</b> успешно</span><span><i className="dot amber" /><b>{stats.queued}</b> выполняются</span><span><i className="dot red-dot" /><b>{stats.failed}</b> ошибки</span></div><OperationTable rows={runs} detailed onSelect={(run) => setSelectedId(run.id)} /></section>{selected && <RunDetails run={selected} close={() => setSelectedId(null)} />}</div>;
}

function RunDetails({ run, close }: { run: RunRecord; close: () => void }) {
  return <div className="modal-backdrop"><section className="modal run-details-modal"><button className="modal-x" onClick={close}>×</button><div className="run-detail-head"><div><span className="eyebrow">XYOPS {run.kind.toUpperCase()}</span><h2>{run.title}</h2><p>{run.subject} · {run.actor}</p></div><RunStatusBadge status={run.status} /></div><div className="run-facts"><span><small>Job ID</small><code>{run.jobId}</code></span><span><small>Запущено</small><strong>{formatDateTime(run.startedAt)}</strong></span><span><small>Обновлено</small><strong>{formatDateTime(run.updatedAt)}</strong></span></div>{run.stages?.length ? <div className="workflow-timeline">{run.stages.map((stage, index) => <article key={stage.id}><div className="timeline-marker"><i className={stage.status}>{stage.status === "success" ? "✓" : stage.status === "failed" ? "!" : index + 1}</i>{index < run.stages.length - 1 && <span />}</div><div><strong>{stage.title}</strong><small>{stage.startedAt ? formatDateTime(stage.startedAt) : "Ожидает данных времени"}{stage.completedAt ? ` → ${formatDateTime(stage.completedAt)}` : ""}</small>{stage.error && <p>{stage.error}</p>}</div><RunStatusBadge status={stage.status} /></article>)}</div> : <div className="catalog-empty"><strong>XYOps не вернул этапы Workflow</strong><span>Отображается общий статус задания. Этапы появятся, если `get_active_jobs` содержит `stages`, `steps`, `tasks` или `nodes`.</span></div>}{run.error && <div className="settings-error"><strong>Ошибка</strong><span>{run.error}</span></div>}<div className="modal-actions"><button className="secondary" onClick={close}>Закрыть</button></div></section></div>;
}
'''
new_operations = '''function Operations({ runs, stats, loading, refresh, onAction }: { runs: RunRecord[]; stats: RunStats; loading: boolean; refresh: () => void; onAction: (run: RunRecord, action: "cancel" | "rerun") => Promise<boolean> }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = runs.find((run) => run.id === selectedId) ?? null;
  return <div className="content-stack"><section className="panel table-panel section-page"><div className="panel-title"><div><h2>Журнал операций</h2><p>Прямые изменения FreeIPA и запуски автоматизаций XYOps</p></div><button className="secondary" disabled={loading} onClick={refresh}>{loading ? "Обновление…" : "⟳ Обновить"}</button></div><div className="stats-strip"><span><b>{stats.today}</b> операций сегодня</span><span><i className="dot green" /><b>{stats.success}</b> успешно</span><span><i className="dot amber" /><b>{stats.queued}</b> выполняются</span><span><i className="dot red-dot" /><b>{stats.failed}</b> ошибки</span></div><OperationTable rows={runs} detailed onSelect={(run) => setSelectedId(run.id)} /></section>{selected && <RunDetails run={selected} close={() => setSelectedId(null)} onAction={onAction} />}</div>;
}

function RunDetails({ run, close, onAction }: { run: RunRecord; close: () => void; onAction: (run: RunRecord, action: "cancel" | "rerun") => Promise<boolean> }) {
  const [busy, setBusy] = useState<"cancel" | "rerun" | null>(null);
  const act = async (action: "cancel" | "rerun") => { setBusy(action); if (await onAction(run, action)) close(); else setBusy(null); };
  return <div className="modal-backdrop"><section className="modal run-details-modal"><button className="modal-x" onClick={close}>×</button><div className="run-detail-head"><div><span className="eyebrow">XYOPS {run.kind.toUpperCase()}</span><h2>{run.title}</h2><p>{run.subject} · {run.actor}</p></div><RunStatusBadge status={run.status} /></div><div className="run-facts"><span><small>Job ID</small><code>{run.jobId}</code></span><span><small>Запущено</small><strong>{formatDateTime(run.startedAt)}</strong></span><span><small>Обновлено</small><strong>{formatDateTime(run.updatedAt)}</strong></span></div>{run.stages?.length ? <div className="workflow-timeline">{run.stages.map((stage, index) => <article key={stage.id}><div className="timeline-marker"><i className={stage.status}>{stage.status === "success" ? "✓" : stage.status === "failed" || stage.status === "cancelled" ? "!" : index + 1}</i>{index < run.stages.length - 1 && <span />}</div><div><strong>{stage.title}</strong><small>{stage.startedAt ? formatDateTime(stage.startedAt) : "Ожидает данных времени"}{stage.completedAt ? ` → ${formatDateTime(stage.completedAt)}` : ""}</small>{stage.error && <p>{stage.error}</p>}</div><RunStatusBadge status={stage.status} /></article>)}</div> : <div className="catalog-empty"><strong>XYOps не вернул этапы Workflow</strong><span>Отображается общий статус задания. Этапы появятся, если `get_active_jobs` содержит `stages`, `steps`, `tasks` или `nodes`.</span></div>}{run.error && <div className="settings-error"><strong>{run.status === "cancelled" ? "Остановка" : "Ошибка"}</strong><span>{run.error}</span></div>}{!run.actions.rerun && run.actions.reason && <div className="settings-error"><strong>Повтор недоступен</strong><span>{run.actions.reason}</span></div>}<div className="modal-actions"><button className="secondary" onClick={close}>Закрыть</button>{run.actions.rerun && <button className="primary" disabled={Boolean(busy)} onClick={() => void act("rerun")}>{busy === "rerun" ? "Запуск…" : run.actions.rerunLabel}</button>}{run.actions.cancel && <button className="danger-button" disabled={Boolean(busy)} onClick={() => void act("cancel")}>{busy === "cancel" ? "Остановка…" : "Остановить задание"}</button>}</div></section></div>;
}
'''
app = replace_once(app, old_operations, new_operations, "app operations and details")
app = replace_once(
    app,
    '  const labels: Record<RunStatus, string> = { queued: "В очереди", running: "Выполняется", success: "Успешно", failed: "Ошибка", unknown: "Неизвестно" };\n  const tones: Record<RunStatus, string> = { queued: "warning", running: "violet", success: "success", failed: "error", unknown: "neutral" };\n',
    '  const labels: Record<RunStatus, string> = { queued: "В очереди", running: "Выполняется", success: "Успешно", failed: "Ошибка", cancelled: "Остановлено", unknown: "Неизвестно" };\n  const tones: Record<RunStatus, string> = { queued: "warning", running: "violet", success: "success", failed: "error", cancelled: "neutral", unknown: "neutral" };\n',
    "app cancelled status badge",
)
app_path.write_text(app)
