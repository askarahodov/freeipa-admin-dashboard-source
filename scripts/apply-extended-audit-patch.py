from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


worker_path = Path("worker/index.ts")
worker = worker_path.read_text()
worker = replace_once(
    worker,
    'import { approvalExecutionMatches, approvalRequirement, cancelApproval, claimApprovalExecution, createApprovalRequest, decideApproval, finishApprovalExecution, listApprovals, readApprovalPolicySet, readExecutingApproval, saveApprovalPolicySet } from "../approval-gates";\n',
    'import { approvalExecutionMatches, approvalRequirement, cancelApproval, claimApprovalExecution, createApprovalRequest, decideApproval, finishApprovalExecution, listApprovals, readApprovalPolicySet, readExecutingApproval, saveApprovalPolicySet } from "../approval-gates";\nimport { appendAuditEvent, auditCorrelationFor, auditErrorCode, createAuditContext, listAuditEvents, withAuditCorrelation, type AuditContext } from "../audit-log";\n',
    "audit import",
)
worker = replace_once(
    worker,
    '/^\\/(?:automation(?:\\/[^/]+)?|users|groups|operations|approvals|settings)\\/?$/.test(url.pathname)',
    '/^\\/(?:automation(?:\\/[^/]+)?|users|groups|operations|approvals|audit|settings)\\/?$/.test(url.pathname)',
    "audit application route",
)
worker = replace_once(
    worker,
    '        await saveOperationRun(env, run);\n      }\n      if (["success", "failed"].includes(run.status)) await saveRunResult(env, run.id, run.jobId, row);',
    '        await saveOperationRun(env, run);\n        if (statusChanged) {\n          const correlationId = await auditCorrelationFor(env, { runId: run.id }).catch(() => null);\n          const systemAudit = createAuditContext({ identity: "system@portal.local", role: "system", groups: [] }, correlationId ?? undefined);\n          await appendAuditEvent(env, systemAudit, { action: "xyops.run.status_changed", resourceType: "xyops_run", resourceId: run.id, eventId: run.eventId, runId: run.id, jobId: run.jobId, outcome: run.status === "success" ? "success" : run.status === "failed" || run.status === "cancelled" ? "failure" : "info", errorCode: run.status === "failed" ? "xyops_job_failed" : "", metadata: { status: run.status, stageCount: run.stages.length } }).catch(() => {});\n        }\n      }\n      if (["success", "failed"].includes(run.status)) await saveRunResult(env, run.id, run.jobId, row);',
    "run status audit",
)
worker = replace_once(
    worker,
    'async function handleSettingsApi(request: Request, env: Env, url: URL): Promise<Response> {',
    'async function handleSettingsApi(request: Request, env: Env, url: URL, audit: AuditContext): Promise<Response> {',
    "settings audit context",
)
worker = replace_once(
    worker,
    '      await saveStoredSettings(env, next);\n      return json(publicSettings(next, env, "database"));',
    '      await saveStoredSettings(env, next);\n      await appendAuditEvent(env, audit, { action: "settings.updated", resourceType: "portal_settings", resourceId: "main", outcome: "success", metadata: { demoMode: next.config.demoMode, freeipaUrlConfigured: Boolean(next.config.ipaUrl), freeipaUsernameConfigured: Boolean(next.config.ipaUsername), freeipaPasswordConfigured: Boolean(next.secrets.ipaPassword), xyopsUrlConfigured: Boolean(next.config.xyopsUrl), xyopsApiKeyConfigured: Boolean(next.secrets.xyopsApiKey) } }).catch(() => {});\n      return json(publicSettings(next, env, "database"));',
    "settings save audit",
)
worker = replace_once(
    worker,
    '      return json({ ok: true, service, latencyMs: Date.now() - started });\n    } catch (error) {\n      return json({ error: error instanceof Error ? error.message : "Connection test failed" }, 502);',
    '      const latencyMs = Date.now() - started;\n      await appendAuditEvent(env, audit, { action: "settings.connection_test", resourceType: "integration", resourceId: service, outcome: "success", metadata: { service, latencyMs } }).catch(() => {});\n      return json({ ok: true, service, latencyMs });\n    } catch (error) {\n      await appendAuditEvent(env, audit, { action: "settings.connection_test", resourceType: "integration", resourceId: String(body.service ?? "unknown"), outcome: "failure", errorCode: auditErrorCode(error, "connection_test_failed") }).catch(() => {});\n      return json({ error: error instanceof Error ? error.message : "Connection test failed" }, 502);',
    "settings test audit",
)
worker = replace_once(
    worker,
    'async function handleIntegrationApi(request: Request, baseEnv: Env, url: URL): Promise<Response> {\n  if (request.method === "GET" && url.pathname === "/api/integrations/health") return json({ ok: true });\n  if (url.pathname === "/api/integrations/settings" || url.pathname === "/api/integrations/settings/test") return handleSettingsApi(request, baseEnv, url);\n  const env = await effectiveEnv(baseEnv);',
    'async function handleIntegrationApi(request: Request, baseEnv: Env, url: URL, inheritedAudit?: AuditContext): Promise<Response> {\n  if (request.method === "GET" && url.pathname === "/api/integrations/health") return json({ ok: true });\n  const audit = inheritedAudit ?? createAuditContext(portalAccess(request, baseEnv));\n  if (url.pathname === "/api/integrations/settings" || url.pathname === "/api/integrations/settings/test") return handleSettingsApi(request, baseEnv, url, audit);\n  const env = await effectiveEnv(baseEnv);',
    "integration audit context",
)
worker = replace_once(
    worker,
    '  const xyopsUrl = cleanBaseUrl(env.XYOPS_URL);\n\n  if (request.method === "GET" && url.pathname === "/api/integrations/status") {',
    '  const xyopsUrl = cleanBaseUrl(env.XYOPS_URL);\n\n  if (url.pathname === "/api/integrations/audit") {\n    const denied = requirePortalPermission(request, baseEnv, "settings.manage");\n    if (denied) return denied;\n    if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);\n    const numberParam = (name: string) => { const value = Number(url.searchParams.get(name) ?? ""); return Number.isFinite(value) ? value : undefined; };\n    try {\n      return json(await listAuditEvents(baseEnv, {\n        limit: numberParam("limit"), actor: url.searchParams.get("actor") ?? undefined, action: url.searchParams.get("action") ?? undefined,\n        outcome: url.searchParams.get("outcome") ?? undefined, eventId: url.searchParams.get("eventId") ?? undefined,\n        approvalId: url.searchParams.get("approvalId") ?? undefined, runId: url.searchParams.get("runId") ?? undefined,\n        correlationId: url.searchParams.get("correlationId") ?? undefined, dateFrom: numberParam("dateFrom"), dateTo: numberParam("dateTo"),\n      }));\n    } catch (error) { return json({ error: error instanceof Error ? error.message : "Cannot load audit log" }, 503); }\n  }\n\n  if (request.method === "GET" && url.pathname === "/api/integrations/status") {',
    "audit api",
)
worker = replace_once(
    worker,
    '        const saved = await saveCatalogPolicySet(baseEnv, body.policy);\n        return json({ policy: saved.policy, source: "database", updatedAt: saved.updatedAt, persistenceAvailable: true });',
    '        const saved = await saveCatalogPolicySet(baseEnv, body.policy);\n        await appendAuditEvent(baseEnv, audit, { action: "catalog.policy.updated", resourceType: "policy", resourceId: "catalog_visibility", outcome: "success", metadata: { version: saved.policy.version, defaultEffect: saved.policy.defaultEffect, adminBypass: saved.policy.adminBypass, ruleCount: saved.policy.rules.length } }).catch(() => {});\n        return json({ policy: saved.policy, source: "database", updatedAt: saved.updatedAt, persistenceAvailable: true });',
    "catalog policy audit",
)
worker = replace_once(
    worker,
    '        const saved = await saveApprovalPolicySet(baseEnv, body.policy);\n        return json({ policy: saved.policy, source: "database", updatedAt: saved.updatedAt, persistenceAvailable: true });',
    '        const saved = await saveApprovalPolicySet(baseEnv, body.policy);\n        await appendAuditEvent(baseEnv, audit, { action: "approval.policy.updated", resourceType: "policy", resourceId: "xyops_approval", outcome: "success", metadata: { version: saved.policy.version, dangerousDefaultEnabled: Boolean(saved.policy.dangerousDefaults), ruleCount: saved.policy.rules.length } }).catch(() => {});\n        return json({ policy: saved.policy, source: "database", updatedAt: saved.updatedAt, persistenceAvailable: true });',
    "approval policy audit",
)
worker = replace_once(
    worker,
    '        const approval = await decideApproval(baseEnv, approvalId, access, action, String(body.comment ?? ""));\n        return json({ approval });',
    '        const approval = await decideApproval(baseEnv, approvalId, access, action, String(body.comment ?? ""));\n        const correlationId = await auditCorrelationFor(baseEnv, { approvalId }).catch(() => null);\n        const linkedAudit = withAuditCorrelation(audit, correlationId);\n        await appendAuditEvent(baseEnv, linkedAudit, { action: `approval.${action}`, resourceType: "approval", resourceId: approvalId, eventId: approval.eventId, schemaVersion: approval.schemaVersion, approvalId, runId: approval.runId, outcome: "success", metadata: { decision: action, commentProvided: Boolean(String(body.comment ?? "").trim()), approvals: approval.approvals, rejections: approval.rejections, requiredApprovals: approval.requiredApprovals, status: approval.status } }).catch(() => {});\n        return json({ approval });',
    "approval decision audit",
)
worker = replace_once(
    worker,
    '      if (action === "cancel") return json({ approval: await cancelApproval(baseEnv, approvalId, access) });\n\n      const claimed = await claimApprovalExecution(baseEnv, approvalId, access);',
    '      if (action === "cancel") {\n        const approval = await cancelApproval(baseEnv, approvalId, access);\n        const correlationId = await auditCorrelationFor(baseEnv, { approvalId }).catch(() => null);\n        await appendAuditEvent(baseEnv, withAuditCorrelation(audit, correlationId), { action: "approval.cancel", resourceType: "approval", resourceId: approvalId, eventId: approval.eventId, schemaVersion: approval.schemaVersion, approvalId, outcome: "success", metadata: { status: approval.status } }).catch(() => {});\n        return json({ approval });\n      }\n\n      const claimed = await claimApprovalExecution(baseEnv, approvalId, access);\n      const approvalCorrelation = await auditCorrelationFor(baseEnv, { approvalId }).catch(() => null);\n      const executionAudit = withAuditCorrelation(audit, approvalCorrelation);',
    "approval cancel and execute context",
)
worker = replace_once(
    worker,
    '      }), baseEnv, runUrl);',
    '      }), baseEnv, runUrl, executionAudit);',
    "approval recursive audit context",
)
worker = replace_once(
    worker,
    '        await finishApprovalExecution(baseEnv, approvalId, "executed", payload.runId);\n        return json({ ...payload, approvalId, approvalExecuted: true }, launchResponse.status);',
    '        await finishApprovalExecution(baseEnv, approvalId, "executed", payload.runId);\n        await appendAuditEvent(baseEnv, executionAudit, { action: "approval.execute", resourceType: "approval", resourceId: approvalId, eventId: claimed.spec.eventId, schemaVersion: claimed.spec.schemaVersion, approvalId, runId: payload.runId, jobId: String(payload.jobId ?? ""), outcome: "success", metadata: { status: "executed", secretFieldCount: claimed.spec.secretFields.length, parentRunId: claimed.spec.parentRunId } }).catch(() => {});\n        return json({ ...payload, approvalId, approvalExecuted: true }, launchResponse.status);',
    "approval execute success audit",
)
worker = replace_once(
    worker,
    '      await finishApprovalExecution(baseEnv, approvalId, launchResponse.status >= 500 ? "unknown" : "failed", String(payload.runId ?? ""), String(payload.error ?? "XYOps launch failed"));\n      return json({ ...payload, approvalId }, launchResponse.status);',
    '      const executionOutcome = launchResponse.status >= 500 ? "unknown" : "failure";\n      await finishApprovalExecution(baseEnv, approvalId, launchResponse.status >= 500 ? "unknown" : "failed", String(payload.runId ?? ""), String(payload.error ?? "XYOps launch failed"));\n      await appendAuditEvent(baseEnv, executionAudit, { action: "approval.execute", resourceType: "approval", resourceId: approvalId, eventId: claimed.spec.eventId, schemaVersion: claimed.spec.schemaVersion, approvalId, runId: String(payload.runId ?? ""), outcome: executionOutcome, errorCode: "xyops_launch_failed", metadata: { httpStatus: launchResponse.status } }).catch(() => {});\n      return json({ ...payload, approvalId }, launchResponse.status);',
    "approval execute failure audit",
)
worker = replace_once(
    worker,
    '    const run = (await listOperationRuns(baseEnv, 200)).find((item) => item.id === runId);\n    if (!run) return json({ error: "Запуск не найден" }, 404);',
    '    const run = (await listOperationRuns(baseEnv, 200)).find((item) => item.id === runId);\n    if (!run) return json({ error: "Запуск не найден" }, 404);\n    const runCorrelation = await auditCorrelationFor(baseEnv, { runId }).catch(() => null);\n    const runAudit = withAuditCorrelation(audit, runCorrelation);',
    "run action audit context",
)
worker = replace_once(
    worker,
    '        await saveOperationRun(baseEnv, run);\n        return json({ ok: true, action: "cancel", run: publicRun(run, undefined, undefined, true) });',
    '        await saveOperationRun(baseEnv, run);\n        await appendAuditEvent(baseEnv, runAudit, { action: "xyops.run.cancel", resourceType: "xyops_run", resourceId: run.id, eventId: run.eventId, runId: run.id, jobId: run.jobId, outcome: "success", metadata: { status: run.status } }).catch(() => {});\n        return json({ ok: true, action: "cancel", run: publicRun(run, undefined, undefined, true) });',
    "run cancel audit",
)
worker = replace_once(
    worker,
    '      return handleIntegrationApi(new Request(rerunUrl, {\n        method: "POST",\n        headers,\n        body: JSON.stringify({ eventId: replay.spec.eventId, values: replay.spec.values, targets: replay.spec.targets, replayOf: run.id }),\n      }), baseEnv, rerunUrl);',
    '      await appendAuditEvent(baseEnv, audit, { action: "xyops.run.rerun_requested", resourceType: "xyops_run", resourceId: run.id, eventId: replay.spec.eventId, schemaVersion: replay.summary.schemaVersion, runId: run.id, jobId: run.jobId, outcome: "pending", metadata: { previousStatus: run.status } }).catch(() => {});\n      return handleIntegrationApi(new Request(rerunUrl, {\n        method: "POST",\n        headers,\n        body: JSON.stringify({ eventId: replay.spec.eventId, values: replay.spec.values, targets: replay.spec.targets, replayOf: run.id }),\n      }), baseEnv, rerunUrl, audit);',
    "rerun audit context",
)
worker = replace_once(
    worker,
    '      await saveStoredSettings(baseEnv, next);\n      return json({ mode: routes.length ? "live" : "unconfigured", routes: routes.map(publicRoute) });',
    '      await saveStoredSettings(baseEnv, next);\n      await appendAuditEvent(baseEnv, audit, { action: "routes.updated", resourceType: "automation_routes", resourceId: "current", outcome: "success", metadata: { routeCount: routes.length, enabledCount: routes.filter((route) => route.enabled !== false).length, eventIds: routes.map((route) => route.eventId).slice(0, 100) } }).catch(() => {});\n      return json({ mode: routes.length ? "live" : "unconfigured", routes: routes.map(publicRoute) });',
    "routes audit",
)
worker = replace_once(
    worker,
    '          const approval = await createApprovalRequest(baseEnv, event, access, values, requestedTargets, requirement, typeof body.replayOf === "string" ? body.replayOf : "");\n          return json({ approvalRequired: true, approvalId: approval.id, status: approval.status, approval }, 202);',
    '          const approval = await createApprovalRequest(baseEnv, event, access, values, requestedTargets, requirement, typeof body.replayOf === "string" ? body.replayOf : "");\n          await appendAuditEvent(baseEnv, audit, { action: "approval.requested", resourceType: "approval", resourceId: approval.id, eventId: event.id, schemaVersion: event.schemaVersion, approvalId: approval.id, outcome: "pending", metadata: { category: event.category, kind: event.kind, targets: requestedTargets, fieldKeys: event.fields.filter((field) => fieldVisible(field, values)).map((field) => field.key), requiredApprovals: requirement.requiredApprovals, ruleId: requirement.ruleId, replayOf: typeof body.replayOf === "string" ? body.replayOf : "" } }).catch(() => {});\n          return json({ approvalRequired: true, approvalId: approval.id, status: approval.status, approval }, 202);',
    "approval request audit",
)
worker = replace_once(
    worker,
    '        await saveRunReplay(baseEnv, run.id, event, values, requestedTargets, typeof body.replayOf === "string" ? body.replayOf.slice(0, 160) : "");\n        return json({ mode: "demo", queued: true, runId: run.id, jobId: run.jobId, status: run.status, process: { id: event.id, title: event.title, kind: event.kind } }, 202);',
    '        await saveRunReplay(baseEnv, run.id, event, values, requestedTargets, typeof body.replayOf === "string" ? body.replayOf.slice(0, 160) : "");\n        await appendAuditEvent(baseEnv, audit, { action: "xyops.run", resourceType: "xyops_run", resourceId: run.id, eventId: event.id, schemaVersion: event.schemaVersion, approvalId: approvalExecutionId, runId: run.id, jobId: run.jobId, outcome: "success", metadata: { mode: "demo", kind: event.kind, targets: requestedTargets, replayOf: typeof body.replayOf === "string" ? body.replayOf : "" } }).catch(() => {});\n        return json({ mode: "demo", queued: true, runId: run.id, jobId: run.jobId, status: run.status, process: { id: event.id, title: event.title, kind: event.kind } }, 202);',
    "demo run audit",
)
worker = replace_once(
    worker,
    '        await saveRunReplay(baseEnv, run.id, event, values, requestedTargets, typeof body.replayOf === "string" ? body.replayOf.slice(0, 160) : "");\n        return json({ error: "XYOps run_event failed", runId: run.id }, 502);',
    '        await saveRunReplay(baseEnv, run.id, event, values, requestedTargets, typeof body.replayOf === "string" ? body.replayOf.slice(0, 160) : "");\n        await appendAuditEvent(baseEnv, audit, { action: "xyops.run", resourceType: "xyops_run", resourceId: run.id, eventId: event.id, schemaVersion: event.schemaVersion, approvalId: approvalExecutionId, runId: run.id, jobId, outcome: "failure", errorCode: "xyops_run_event_rejected", metadata: { httpStatus: response.status, kind: event.kind, targets: requestedTargets } }).catch(() => {});\n        return json({ error: "XYOps run_event failed", runId: run.id }, 502);',
    "rejected run audit",
)
worker = replace_once(
    worker,
    '      await saveRunReplay(baseEnv, run.id, event, values, requestedTargets, typeof body.replayOf === "string" ? body.replayOf.slice(0, 160) : "");\n      return json({ mode: "live", queued: true, runId: run.id, jobId: run.jobId, status: run.status, process: { id: event.id, title: event.title, kind: event.kind } }, 202);',
    '      await saveRunReplay(baseEnv, run.id, event, values, requestedTargets, typeof body.replayOf === "string" ? body.replayOf.slice(0, 160) : "");\n      await appendAuditEvent(baseEnv, audit, { action: "xyops.run", resourceType: "xyops_run", resourceId: run.id, eventId: event.id, schemaVersion: event.schemaVersion, approvalId: approvalExecutionId, runId: run.id, jobId: run.jobId, outcome: "success", metadata: { mode: "live", initialStatus: run.status, kind: event.kind, targets: requestedTargets, replayOf: typeof body.replayOf === "string" ? body.replayOf : "" } }).catch(() => {});\n      return json({ mode: "live", queued: true, runId: run.id, jobId: run.jobId, status: run.status, process: { id: event.id, title: event.title, kind: event.kind } }, 202);',
    "accepted run audit",
)
worker = replace_once(
    worker,
    '      await saveOperationRun(baseEnv, run);\n      return json({ error: message, runId: run.id }, 502);\n    }\n  }\n\n  if (request.method === "GET" && url.pathname === "/api/integrations/users") {',
    '      await saveOperationRun(baseEnv, run);\n      await appendAuditEvent(baseEnv, audit, { action: "xyops.run", resourceType: "xyops_run", resourceId: run.id, eventId: eventId || "unknown", runId: run.id, outcome: "unknown", errorCode: auditErrorCode(error, "xyops_request_failed"), metadata: { fieldKeys: Object.keys(values).filter((key) => !/pass|secret|token|key/i.test(key)) } }).catch(() => {});\n      return json({ error: message, runId: run.id }, 502);\n    }\n  }\n\n  if (request.method === "GET" && url.pathname === "/api/integrations/users") {',
    "run exception audit",
)
worker = replace_once(
    worker,
    '      await saveOperationRun(baseEnv, run);\n      return json({ mode: "demo", direct: true, ok: true, runId: run.id, status: run.status });',
    '      await saveOperationRun(baseEnv, run);\n      await appendAuditEvent(baseEnv, audit, { action: `freeipa.${body.operation}`, resourceType: String(body.operation).startsWith("group_") ? "freeipa_group" : "freeipa_user", resourceId: run.subject, eventId: run.eventId, runId: run.id, jobId: run.jobId, outcome: "success", metadata: { mode: "demo", operation: body.operation, fieldKeys: Object.keys(call.values).filter((key) => !/pass|secret|token|key/i.test(key)) } }).catch(() => {});\n      return json({ mode: "demo", direct: true, ok: true, runId: run.id, status: run.status });',
    "demo freeipa audit",
)
worker = replace_once(
    worker,
    '      await saveOperationRun(baseEnv, run);\n      return json({ mode: "live", direct: true, ok: true, runId: run.id, status: run.status });',
    '      await saveOperationRun(baseEnv, run);\n      await appendAuditEvent(baseEnv, audit, { action: `freeipa.${body.operation}`, resourceType: String(body.operation).startsWith("group_") ? "freeipa_group" : "freeipa_user", resourceId: run.subject, eventId: run.eventId, runId: run.id, jobId: run.jobId, outcome: "success", metadata: { mode: "live", operation: body.operation, fieldKeys: Object.keys(call.values).filter((key) => !/pass|secret|token|key/i.test(key)) } }).catch(() => {});\n      return json({ mode: "live", direct: true, ok: true, runId: run.id, status: run.status });',
    "live freeipa audit",
)
worker = replace_once(
    worker,
    '      await saveOperationRun(baseEnv, run);\n      return json({ error: message, runId: run.id }, 502);\n    }\n  }\n\n  if (request.method === "POST" && url.pathname === "/api/integrations/actions") {',
    '      await saveOperationRun(baseEnv, run);\n      await appendAuditEvent(baseEnv, audit, { action: `freeipa.${body.operation}`, resourceType: String(body.operation).startsWith("group_") ? "freeipa_group" : "freeipa_user", resourceId: run.subject, eventId: run.eventId, runId: run.id, outcome: "failure", errorCode: auditErrorCode(error, "freeipa_request_failed"), metadata: { operation: body.operation, fieldKeys: Object.keys(call.values).filter((key) => !/pass|secret|token|key/i.test(key)) } }).catch(() => {});\n      return json({ error: message, runId: run.id }, 502);\n    }\n  }\n\n  if (request.method === "POST" && url.pathname === "/api/integrations/actions") {',
    "freeipa failure audit",
)
worker = replace_once(
    worker,
    '    }), baseEnv, runUrl);\n  }\n\n  return json({ error: "Not found" }, 404);',
    '    }), baseEnv, runUrl, audit);\n  }\n\n  return json({ error: "Not found" }, 404);',
    "route recursive audit context",
)
worker_path.write_text(worker)

secure_path = Path("worker/secure-entry.ts")
secure = secure_path.read_text()
secure = replace_once(secure, 'import runtime from "./index";\n', 'import runtime from "./index";\nimport { appendAuditEvent, createAuditContext, type AuditContext } from "../audit-log";\n', "secure audit import")
secure = replace_once(
    secure,
    'async function runCatalogSynchronization(env: SecureEnv, trigger: string, ctx: RuntimeContext): Promise<CatalogSyncRun> {',
    'async function runCatalogSynchronization(env: SecureEnv, trigger: string, ctx: RuntimeContext, inheritedAudit?: AuditContext): Promise<CatalogSyncRun> {',
    "catalog sync audit context",
)
secure = replace_once(
    secure,
    '  const startedAt = Date.now();\n  const run: CatalogSyncRun = {',
    '  const startedAt = Date.now();\n  const audit = inheritedAudit ?? createAuditContext({ identity: "system@portal.local", role: "system", groups: [] });\n  const run: CatalogSyncRun = {',
    "catalog sync audit initialization",
)
secure = replace_once(
    secure,
    '    await saveCatalogSyncRun(env, run);\n  }\n  return run;',
    '    await saveCatalogSyncRun(env, run);\n    await appendAuditEvent(env, audit, { action: "catalog.sync", resourceType: "xyops_catalog", resourceId: run.id, outcome: run.status === "success" ? "success" : run.status === "failed" ? "failure" : "info", errorCode: run.status === "failed" ? "catalog_sync_failed" : "", metadata: { trigger: run.trigger, status: run.status, processCount: run.processCount, changeCount: run.changeCount } }).catch(() => {});\n  }\n  return run;',
    "catalog sync audit event",
)
secure = replace_once(
    secure,
    '    const run = await runCatalogSynchronization(env, `manual:${requestActor(request)}`, ctx);',
    '    const groups = String(request.headers.get("oai-authenticated-user-groups") ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean).slice(0, 100);\n    const audit = createAuditContext({ identity: requestActor(request), role: requestRole(request, env), groups });\n    const run = await runCatalogSynchronization(env, `manual:${requestActor(request)}`, ctx, audit);',
    "manual sync audit actor",
)
secure_path.write_text(secure)

app_path = Path("app/page.tsx")
app = app_path.read_text()
app = replace_once(app, 'type Page = "overview" | "automation" | "users" | "groups" | "operations" | "approvals" | "settings";', 'type Page = "overview" | "automation" | "users" | "groups" | "operations" | "approvals" | "audit" | "settings";', "audit page type")
app = replace_once(app, 'type ApprovalRecord = { id: string;', 'type AuditEvent = { id: string; createdAt: number; correlationId: string; actorIdentity: string; actorRole: string; actorGroups: string[]; action: string; resourceType: string; resourceId: string; eventId: string; schemaVersion: string; approvalId: string; runId: string; jobId: string; outcome: "success" | "failure" | "pending" | "denied" | "unknown" | "info"; errorCode: string; metadata: Record<string, unknown> };\ntype ApprovalRecord = { id: string;', "audit event type")
app = replace_once(app, '  { id: "approvals", label: "Согласования", icon: "✓" },\n  { id: "settings", label: "Настройки", icon: "⚙" },', '  { id: "approvals", label: "Согласования", icon: "✓" },\n  { id: "audit", label: "Аудит", icon: "≣" },\n  { id: "settings", label: "Настройки", icon: "⚙" },', "audit nav")
app = replace_once(app, 'const pagePaths: Record<Page, string> = { overview: "/", automation: "/automation", users: "/users", groups: "/groups", operations: "/operations", approvals: "/approvals", settings: "/settings" };', 'const pagePaths: Record<Page, string> = { overview: "/", automation: "/automation", users: "/users", groups: "/groups", operations: "/operations", approvals: "/approvals", audit: "/audit", settings: "/settings" };', "audit path")
app = replace_once(app, '  const visibleNav = nav.filter((item) => item.id !== "settings" || canManageSettings);', '  const visibleNav = nav.filter((item) => !["settings", "audit"].includes(item.id) || canManageSettings);', "audit nav permission")
app = replace_once(app, '        {page === "approvals" && <Approvals items={approvals} pendingForMe={approvalPendingForMe} loading={approvalsLoading} canApprove={canApproveXyops} refresh={() => void loadApprovals()} onAction={actOnApproval} />}\n', '        {page === "approvals" && <Approvals items={approvals} pendingForMe={approvalPendingForMe} loading={approvalsLoading} canApprove={canApproveXyops} refresh={() => void loadApprovals()} onAction={actOnApproval} />}\n        {page === "audit" && canManageSettings && <AuditLog />}\n', "audit page render")
audit_component = r'''
function AuditLog() {
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
    } catch { setItems([]); }
    finally { setLoading(false); }
  }, [actor, action, outcome, correlationId]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  return <div className="audit-page">
    <section className="panel audit-toolbar"><div><span className="eyebrow">APPEND-ONLY AUDIT</span><h2>Журнал административных действий</h2><p>Correlation ID связывает approval, запуск, XYOps Job, изменение статуса и результат. Секретные значения не сохраняются.</p></div><button className="secondary" disabled={loading} onClick={() => void load()}>{loading ? "Загрузка…" : "Обновить"}</button></section>
    <section className="panel audit-filters"><label>Пользователь<input value={actor} onChange={(event) => setActor(event.target.value)} placeholder="admin@example.test" /></label><label>Действие<input value={action} onChange={(event) => setAction(event.target.value)} placeholder="approval.approve" /></label><label>Результат<select value={outcome} onChange={(event) => setOutcome(event.target.value)}><option value="">Все</option><option value="success">success</option><option value="failure">failure</option><option value="pending">pending</option><option value="unknown">unknown</option><option value="info">info</option></select></label><label>Correlation ID<input value={correlationId} onChange={(event) => setCorrelationId(event.target.value)} placeholder="cor_…" /></label></section>
    <section className="audit-list">{items.map((item) => <article className="panel audit-entry" key={item.id}><div className="audit-entry-head"><div><strong>{item.action}</strong><small>{new Date(item.createdAt).toLocaleString("ru-RU")} · {item.actorIdentity} · {item.actorRole}</small></div><Status tone={item.outcome === "success" ? "success" : item.outcome === "failure" ? "danger" : item.outcome === "pending" ? "violet" : "neutral"}>{item.outcome}</Status></div><div className="audit-links"><code>{item.correlationId}</code>{item.eventId && <span>Event: <b>{item.eventId}</b></span>}{item.schemaVersion && <span>Schema: <b>{item.schemaVersion}</b></span>}{item.approvalId && <span>Approval: <b>{item.approvalId}</b></span>}{item.runId && <span>Run: <b>{item.runId}</b></span>}{item.jobId && <span>Job: <b>{item.jobId}</b></span>}</div>{item.errorCode && <p className="audit-error">Ошибка: {item.errorCode}</p>}{Object.keys(item.metadata ?? {}).length > 0 && <details><summary>Безопасные технические данные</summary><pre>{JSON.stringify(item.metadata, null, 2)}</pre></details>}</article>)}{!items.length && <section className="panel catalog-empty"><strong>{loading ? "Загрузка журнала…" : "События не найдены"}</strong><span>Измените фильтры или выполните административную операцию.</span></section>}</section>
  </div>;
}

'''
app = replace_once(app, '\n\nconst exampleCatalogPolicy: CatalogPolicySet = {', '\n\n' + audit_component + 'const exampleCatalogPolicy: CatalogPolicySet = {', "audit component")
app_path.write_text(app)

css_path = Path("app/globals.css")
css = css_path.read_text()
css += r'''

/* Extended append-only audit */
.audit-page { display: grid; gap: 16px; }
.audit-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 22px; }
.audit-toolbar h2 { margin: 4px 0; }
.audit-toolbar p { margin: 0; color: var(--muted); max-width: 820px; }
.audit-filters { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; padding: 18px; }
.audit-filters label { display: grid; gap: 6px; font-size: 12px; font-weight: 700; color: var(--muted); }
.audit-filters input, .audit-filters select { width: 100%; }
.audit-list { display: grid; gap: 12px; }
.audit-entry { padding: 18px; }
.audit-entry-head { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
.audit-entry-head strong { display: block; font-size: 16px; }
.audit-entry-head small { display: block; margin-top: 4px; color: var(--muted); }
.audit-links { display: flex; flex-wrap: wrap; gap: 8px 16px; margin-top: 14px; font-size: 12px; }
.audit-links code { padding: 4px 7px; border-radius: 7px; background: var(--surface-2); overflow-wrap: anywhere; }
.audit-links span { color: var(--muted); }
.audit-error { color: #b42318; font-weight: 700; }
.audit-entry details { margin-top: 14px; }
.audit-entry summary { cursor: pointer; font-weight: 700; }
.audit-entry pre { max-height: 320px; overflow: auto; padding: 12px; border-radius: 10px; background: var(--surface-2); font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
@media (max-width: 900px) { .audit-filters { grid-template-columns: 1fr 1fr; } }
@media (max-width: 600px) { .audit-toolbar { align-items: stretch; flex-direction: column; } .audit-filters { grid-template-columns: 1fr; } }
'''
css_path.write_text(css)

roadmap_path = Path("docs/ROADMAP.md")
roadmap = roadmap_path.read_text()
roadmap = replace_once(roadmap, '- [ ] Расширенный аудит: роль, approval, версия схемы и correlation ID.', '- [x] Расширенный аудит: append-only журнал, роль, approval, версия схемы и correlation ID.', "roadmap audit completion")
roadmap_path.write_text(roadmap)

security_path = Path("docs/PORTAL_SECURITY.md")
security = security_path.read_text()
security = replace_once(security, '- Back up the encrypted settings database together with `CONFIG_ENCRYPTION_KEY`.', '- Back up the encrypted settings database together with `CONFIG_ENCRYPTION_KEY`.\n- Ограничьте доступ к `/audit` администраторами и проверяйте correlation-цепочки для опасных операций.\n- Не добавляйте UPDATE/DELETE API для `portal_audit_events`; таблица защищена append-only триггерами.', "security audit checklist")
security_path.write_text(security)

approval_test_path = Path("tests/xyops-approvals.test.mjs")
approval_test = approval_test_path.read_text()
approval_test = replace_once(approval_test, '  replays = [];\n', '  replays = [];\n  audits = [];\n', "approval audit mock state")
approval_test = replace_once(
    approval_test,
    '        if (sql.startsWith("INSERT INTO operation_runs")) {',
    '        if (sql.startsWith("INSERT INTO portal_audit_events")) {\n          this.audits.push({ id: values[0], created_at: values[1], correlation_id: values[2], actor_identity: values[3], actor_role: values[4], actor_groups_json: values[5], action: values[6], resource_type: values[7], resource_id: values[8], event_id: values[9], schema_version: values[10], approval_id: values[11], run_id: values[12], job_id: values[13], outcome: values[14], error_code: values[15], metadata_json: values[16] });\n          return { success: true, meta: { changes: 1 } };\n        }\n        if (sql.startsWith("INSERT INTO operation_runs")) {',
    "approval audit insert mock",
)
approval_test = replace_once(
    approval_test,
    '        if (sql.includes("FROM operation_run_replays WHERE run_id =")) return this.replays.find((row) => row.run_id === values[0]) ?? null;',
    '        if (sql.includes("FROM operation_run_replays WHERE run_id =")) return this.replays.find((row) => row.run_id === values[0]) ?? null;\n        if (sql.includes("FROM portal_audit_events WHERE approval_id")) return this.audits.find((row) => row.approval_id === values[0]) ?? null;\n        if (sql.includes("FROM portal_audit_events WHERE run_id")) return this.audits.find((row) => row.run_id === values[0]) ?? null;',
    "approval audit correlation mock",
)
approval_test = replace_once(
    approval_test,
    '        if (sql.startsWith("SELECT id FROM operation_notifications")) return { results: [] };',
    '        if (sql.startsWith("SELECT id FROM operation_notifications")) return { results: [] };\n        if (sql.includes("FROM portal_audit_events")) return { results: [...this.audits].sort((a, b) => b.created_at - a.created_at).slice(0, Number(values.at(-1) ?? 200)) };',
    "approval audit list mock",
)
approval_test = replace_once(
    approval_test,
    '    assert.doesNotMatch(JSON.stringify(payload), /execution-secret|first-secret|route-secret|xyops-secret/);\n',
    '    assert.doesNotMatch(JSON.stringify(payload), /execution-secret|first-secret|route-secret|xyops-secret/);\n    const chain = db.audits.filter((item) => item.approval_id === secretApprovalId || item.run_id === firstRunId);\n    assert.ok(chain.some((item) => item.action === "approval.requested"));\n    assert.ok(chain.some((item) => item.action === "approval.approve"));\n    assert.ok(chain.some((item) => item.action === "approval.execute"));\n    assert.ok(chain.some((item) => item.action === "xyops.run"));\n    assert.equal(new Set(chain.map((item) => item.correlation_id)).size, 1, "approval and run must share the root correlation ID");\n    assert.doesNotMatch(JSON.stringify(db.audits), /execution-secret|first-secret|route-secret|xyops-secret/);\n',
    "approval audit assertions",
)
approval_test_path.write_text(approval_test)
