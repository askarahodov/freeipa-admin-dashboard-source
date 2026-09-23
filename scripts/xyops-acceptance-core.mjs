function boundedPayload(response, expectedStatus, code) {
  if (!response || Number(response.status) !== expectedStatus) throw new Error(code);
  return response.json && typeof response.json === "object" && !Array.isArray(response.json)
    ? response.json
    : {};
}

function normalizedEventId(value) {
  const eventId = String(value ?? "").trim();
  if (!/^[A-Za-z0-9_.:-]{1,160}$/u.test(eventId)) {
    throw new Error("acceptance_xyops_event_id_invalid");
  }
  return eventId;
}

function catalogEvents(payload) {
  if (payload?.source !== "xyops" || !Array.isArray(payload?.events)) {
    throw new Error("acceptance_xyops_catalog_invalid");
  }
  return payload.events;
}

async function readStatus(request) {
  const payload = boundedPayload(
    await request("/api/integrations/status", { method: "GET" }),
    200,
    "acceptance_xyops_status_failed",
  );
  if (payload.mode !== "live" || payload.xyops?.configured !== true) {
    throw new Error("acceptance_xyops_not_configured");
  }
  if (payload.xyops?.reachable !== true) {
    throw new Error("acceptance_xyops_unreachable");
  }
}

async function readCatalog(request) {
  const payload = boundedPayload(
    await request("/api/integrations/catalog", { method: "GET" }),
    200,
    "acceptance_xyops_catalog_read_failed",
  );
  return { payload, events: catalogEvents(payload) };
}

function dedicatedLifecycleEvent(events, eventId) {
  const event = events.find((item) => item?.id === eventId);
  if (!event || event.enabled !== true) throw new Error("acceptance_xyops_event_unavailable");
  if (event.dangerous !== true) throw new Error("acceptance_xyops_event_not_dangerous");
  if (!Array.isArray(event.fields) || event.fields.length !== 0) {
    throw new Error("acceptance_xyops_event_inputs_forbidden");
  }
  if (!Array.isArray(event.targets) || event.targets.length !== 0) {
    throw new Error("acceptance_xyops_event_targets_forbidden");
  }
  return event;
}

async function requestApproval(request, eventId, activeRuns, pendingApprovals) {
  const payload = boundedPayload(
    await request("/api/integrations/catalog/run", {
      method: "POST",
      body: { eventId, values: {}, targets: [] },
    }),
    202,
    "acceptance_xyops_run_request_failed",
  );
  if (typeof payload.runId === "string" && payload.runId) activeRuns.add(payload.runId);
  if (payload.approvalRequired !== true || typeof payload.approvalId !== "string" || !payload.approvalId) {
    throw new Error("acceptance_xyops_approval_required");
  }
  pendingApprovals.add(payload.approvalId);
  return payload.approvalId;
}

async function approve(approverRequest, approvalId) {
  const payload = boundedPayload(
    await approverRequest(`/api/integrations/approvals/${encodeURIComponent(approvalId)}/approve`, {
      method: "POST",
      body: { comment: "Production acceptance" },
    }),
    200,
    "acceptance_xyops_approval_failed",
  );
  if (payload.approval?.status !== "approved") {
    throw new Error("acceptance_xyops_approval_not_satisfied");
  }
}

async function executeApproved(requesterRequest, approvalId, activeRuns, pendingApprovals) {
  const payload = boundedPayload(
    await requesterRequest(`/api/integrations/approvals/${encodeURIComponent(approvalId)}/execute`, {
      method: "POST",
      body: { secretValues: {} },
    }),
    202,
    "acceptance_xyops_execute_failed",
  );
  const runId = typeof payload.runId === "string" ? payload.runId : "";
  if (!runId || payload.approvalExecuted !== true) throw new Error("acceptance_xyops_execute_failed");
  pendingApprovals.delete(approvalId);
  activeRuns.add(runId);
  return runId;
}

async function cancelRun(request, runId) {
  const payload = boundedPayload(
    await request(`/api/integrations/runs/${encodeURIComponent(runId)}/cancel`, {
      method: "POST",
      body: {},
    }),
    200,
    "acceptance_xyops_cancel_failed",
  );
  if (payload.ok !== true || payload.run?.status !== "cancelled") {
    throw new Error("acceptance_xyops_cancel_failed");
  }
}

function terminalRun(payload, runId) {
  if (!Array.isArray(payload?.runs)) throw new Error("acceptance_xyops_runs_read_failed");
  return payload.runs.find((item) => item?.id === runId) ?? null;
}

async function waitForSuccessfulResult({
  request,
  runId,
  now,
  sleep,
  timeoutMs,
  pollIntervalMs,
}) {
  const deadline = now() + timeoutMs;
  for (;;) {
    const payload = boundedPayload(
      await request("/api/integrations/runs?sync=1&limit=100", { method: "GET" }),
      200,
      "acceptance_xyops_runs_read_failed",
    );
    const run = terminalRun(payload, runId);
    if (run) {
      if (run.status === "success") {
        if (run.result?.available !== true) throw new Error("acceptance_xyops_result_missing");
        return run;
      }
      if (["failed", "cancelled"].includes(run.status)) {
        throw new Error("acceptance_xyops_run_failed");
      }
    }
    if (now() >= deadline) throw new Error("acceptance_xyops_run_timeout");
    await sleep(pollIntervalMs);
  }
}

async function acceptanceLifecycleBaseline(request) {
  const [approvalPayload, runPayload] = await Promise.all([
    request("/api/integrations/approvals?limit=100", { method: "GET" }),
    request("/api/integrations/runs?sync=1&limit=100", { method: "GET" }),
  ]);
  const approvals = boundedPayload(approvalPayload, 200, "acceptance_xyops_approvals_read_failed");
  const runs = boundedPayload(runPayload, 200, "acceptance_xyops_runs_read_failed");
  if (!Array.isArray(approvals.approvals) || !Array.isArray(runs.runs)) {
    throw new Error("acceptance_xyops_baseline_invalid");
  }
  return Object.freeze({
    approvalIds: new Set(approvals.approvals.map((item) => String(item?.id ?? "")).filter(Boolean)),
    runIds: new Set(runs.runs.map((item) => String(item?.id ?? "")).filter(Boolean)),
  });
}

async function discoverAcceptanceResidue({
  requesterRequest,
  eventId,
  baseline,
  activeRuns,
  pendingApprovals,
}) {
  const approvalsPayload = boundedPayload(
    await requesterRequest("/api/integrations/approvals?limit=100", { method: "GET" }),
    200,
    "acceptance_xyops_cleanup_failed",
  );
  if (!Array.isArray(approvalsPayload.approvals)) throw new Error("acceptance_xyops_cleanup_failed");

  for (const approval of approvalsPayload.approvals) {
    const id = String(approval?.id ?? "");
    if (!id || baseline.approvalIds.has(id) || approval?.eventId !== eventId) continue;
    const status = String(approval?.status ?? "");
    if (status === "executed" && typeof approval?.runId === "string" && approval.runId) {
      activeRuns.add(approval.runId);
      continue;
    }
    if (["pending", "approved"].includes(status)) pendingApprovals.add(id);
  }

  const runsPayload = boundedPayload(
    await requesterRequest("/api/integrations/runs?sync=1&limit=100", { method: "GET" }),
    200,
    "acceptance_xyops_cleanup_failed",
  );
  if (!Array.isArray(runsPayload.runs)) throw new Error("acceptance_xyops_cleanup_failed");
  for (const run of runsPayload.runs) {
    const id = String(run?.id ?? "");
    if (!id || baseline.runIds.has(id) || run?.eventId !== eventId) continue;
    if (!["success", "failed", "cancelled"].includes(String(run?.status ?? ""))) activeRuns.add(id);
  }
}

async function reconcileCleanup({
  requesterRequest,
  eventId,
  baseline,
  activeRuns,
  pendingApprovals,
}) {
  let cleanupFailed = false;

  try {
    await discoverAcceptanceResidue({
      requesterRequest,
      eventId,
      baseline,
      activeRuns,
      pendingApprovals,
    });
  } catch {
    cleanupFailed = true;
  }

  for (const approvalId of [...pendingApprovals]) {
    try {
      const listed = boundedPayload(
        await requesterRequest("/api/integrations/approvals?limit=100", { method: "GET" }),
        200,
        "acceptance_xyops_cleanup_failed",
      );
      const approval = Array.isArray(listed.approvals)
        ? listed.approvals.find((item) => item?.id === approvalId)
        : null;

      if (approval?.status === "executed" && typeof approval.runId === "string" && approval.runId) {
        activeRuns.add(approval.runId);
        pendingApprovals.delete(approvalId);
        continue;
      }
      if (["cancelled", "rejected", "failed", "expired"].includes(String(approval?.status ?? ""))) {
        pendingApprovals.delete(approvalId);
        continue;
      }

      const response = await requesterRequest(
        `/api/integrations/approvals/${encodeURIComponent(approvalId)}/cancel`,
        { method: "POST", body: {} },
      );
      if (Number(response?.status) !== 200) cleanupFailed = true;
      else pendingApprovals.delete(approvalId);
    } catch {
      cleanupFailed = true;
    }
  }

  for (const runId of [...activeRuns]) {
    try {
      const listed = boundedPayload(
        await requesterRequest("/api/integrations/runs?sync=1&limit=100", { method: "GET" }),
        200,
        "acceptance_xyops_cleanup_failed",
      );
      const run = terminalRun(listed, runId);
      if (run && ["success", "failed", "cancelled"].includes(run.status)) {
        activeRuns.delete(runId);
        continue;
      }
      const response = await requesterRequest(
        `/api/integrations/runs/${encodeURIComponent(runId)}/cancel`,
        { method: "POST", body: {} },
      );
      if (Number(response?.status) !== 200) cleanupFailed = true;
      else activeRuns.delete(runId);
    } catch {
      cleanupFailed = true;
    }
  }

  if (cleanupFailed || activeRuns.size || pendingApprovals.size) {
    throw new Error("acceptance_xyops_cleanup_failed");
  }
}

export async function executeXyOpsReadAcceptance({ request } = {}) {
  if (typeof request !== "function") throw new Error("acceptance_xyops_request_invalid");
  await readStatus(request);
  const { events } = await readCatalog(request);
  return Object.freeze({ outcome: "passed", events: events.length });
}

export async function executeXyOpsLifecycleAcceptance({
  requesterRequest,
  approverRequest,
  eventId,
  confirmedEventId,
  now = Date.now,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  timeoutMs = 120_000,
  pollIntervalMs = 2_000,
} = {}) {
  if (typeof requesterRequest !== "function" || typeof approverRequest !== "function") {
    throw new Error("acceptance_xyops_request_invalid");
  }
  const normalized = normalizedEventId(eventId);
  if (String(confirmedEventId ?? "").trim() !== normalized) {
    throw new Error("acceptance_xyops_event_confirmation_required");
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isFinite(pollIntervalMs) || pollIntervalMs < 0) {
    throw new Error("acceptance_xyops_polling_invalid");
  }

  await readStatus(approverRequest);
  const { events } = await readCatalog(requesterRequest);
  dedicatedLifecycleEvent(events, normalized);
  const baseline = await acceptanceLifecycleBaseline(requesterRequest);

  const activeRuns = new Set();
  const pendingApprovals = new Set();
  let primaryError = null;
  let cleanupError = null;

  try {
    const cancelApprovalId = await requestApproval(requesterRequest, normalized, activeRuns, pendingApprovals);
    await approve(approverRequest, cancelApprovalId);
    const cancelRunId = await executeApproved(requesterRequest, cancelApprovalId, activeRuns, pendingApprovals);
    await cancelRun(requesterRequest, cancelRunId);
    activeRuns.delete(cancelRunId);

    const resultApprovalId = await requestApproval(requesterRequest, normalized, activeRuns, pendingApprovals);
    await approve(approverRequest, resultApprovalId);
    const resultRunId = await executeApproved(requesterRequest, resultApprovalId, activeRuns, pendingApprovals);
    await waitForSuccessfulResult({
      request: requesterRequest,
      runId: resultRunId,
      now,
      sleep,
      timeoutMs,
      pollIntervalMs,
    });
    activeRuns.delete(resultRunId);
  } catch (error) {
    primaryError = error;
  } finally {
    try {
      await reconcileCleanup({
        requesterRequest,
        eventId: normalized,
        baseline,
        activeRuns,
        pendingApprovals,
      });
    } catch {
      cleanupError = new Error("acceptance_xyops_cleanup_failed");
    }
  }

  if (cleanupError) throw cleanupError;
  if (primaryError) throw primaryError;

  return Object.freeze({
    outcome: "passed",
    approval: "verified",
    cancel: "verified",
    result: "verified",
    cleanup: "verified",
  });
}
