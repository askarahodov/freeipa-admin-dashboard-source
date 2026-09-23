import assert from "node:assert/strict";
import test from "node:test";

import {
  executeXyOpsLifecycleAcceptance,
  executeXyOpsReadAcceptance,
} from "../../scripts/xyops-acceptance-core.mjs";

function fakeXyOps({
  dangerous = true,
  fields = [],
  targets = [],
  reachable = true,
  failResult = false,
  failCleanup = false,
} = {}) {
  const approvals = new Map();
  const runs = new Map();
  const calls = [];
  let approvalSequence = 0;
  let runSequence = 0;

  function response(status, json) {
    return { status, json };
  }

  async function requestAs(actor, pathname, options = {}) {
    const method = options.method ?? "GET";
    const body = options.body ?? {};
    calls.push({ actor, pathname, method, body });

    if (pathname === "/api/integrations/status") {
      if (actor !== "approver") return response(403, {});
      return response(200, {
        mode: "live",
        xyops: { configured: true, reachable },
      });
    }

    if (pathname === "/api/integrations/catalog") {
      return response(200, {
        source: "xyops",
        events: [{
          id: "portal-acceptance-event",
          enabled: true,
          dangerous,
          fields,
          targets,
        }],
      });
    }

    if (pathname === "/api/integrations/catalog/run" && method === "POST") {
      approvalSequence += 1;
      const approvalId = `approval_${approvalSequence}`;
      approvals.set(approvalId, { status: "pending" });
      return response(202, {
        approvalRequired: true,
        approvalId,
        status: "pending",
      });
    }

    const approvalMatch = pathname.match(/^\/api\/integrations\/approvals\/([^/]+)\/(approve|execute|cancel)$/u);
    if (approvalMatch && method === "POST") {
      const [, approvalId, action] = approvalMatch;
      const approval = approvals.get(approvalId);
      if (!approval) return response(404, {});
      if (action === "approve") {
        if (actor !== "approver") return response(403, {});
        approval.status = "approved";
        return response(200, { approval: { id: approvalId, status: "approved" } });
      }
      if (action === "cancel") {
        if (failCleanup) return response(409, {});
        approval.status = "cancelled";
        return response(200, { approval: { id: approvalId, status: "cancelled" } });
      }
      if (action === "execute") {
        if (actor !== "requester" || approval.status !== "approved") return response(409, {});
        approval.status = "executed";
        runSequence += 1;
        const runId = `run_${runSequence}`;
        approval.runId = runId;
        runs.set(runId, {
          id: runId,
          status: "queued",
          result: { available: false },
        });
        return response(202, {
          approvalId,
          approvalExecuted: true,
          runId,
          jobId: `job_${runSequence}`,
          status: "queued",
        });
      }
    }

    if (pathname === "/api/integrations/approvals?limit=100" && method === "GET") {
      return response(200, {
        approvals: Array.from(approvals.entries()).map(([id, approval]) => ({
          id,
          status: approval.status,
          runId: approval.runId ?? "",
        })),
      });
    }

    const cancelMatch = pathname.match(/^\/api\/integrations\/runs\/([^/]+)\/cancel$/u);
    if (cancelMatch && method === "POST") {
      if (failCleanup) return response(502, {});
      const run = runs.get(cancelMatch[1]);
      if (!run) return response(404, {});
      run.status = "cancelled";
      run.result = { available: false };
      return response(200, { ok: true, run: { ...run } });
    }

    if (pathname.startsWith("/api/integrations/runs?") && method === "GET") {
      const second = runs.get("run_2");
      if (second && second.status === "queued") {
        second.status = failResult ? "failed" : "success";
        second.result = { available: !failResult };
      }
      return response(200, { runs: Array.from(runs.values()).map((run) => ({ ...run })) });
    }

    return response(404, {});
  }

  return {
    requesterRequest: (pathname, options) => requestAs("requester", pathname, options),
    approverRequest: (pathname, options) => requestAs("approver", pathname, options),
    calls,
    approvals,
    runs,
  };
}

test("XYOps read acceptance requires live reachable status and canonical catalog", async () => {
  const fake = fakeXyOps();
  assert.deepEqual(await executeXyOpsReadAcceptance({ request: fake.approverRequest }), {
    outcome: "passed",
    events: 1,
  });

  const unreachable = fakeXyOps({ reachable: false });
  await assert.rejects(
    () => executeXyOpsReadAcceptance({ request: unreachable.approverRequest }),
    /acceptance_xyops_unreachable/u,
  );
});

test("XYOps lifecycle proves independent approval, cancellation, result and cleanup", async () => {
  const fake = fakeXyOps();
  const result = await executeXyOpsLifecycleAcceptance({
    requesterRequest: fake.requesterRequest,
    approverRequest: fake.approverRequest,
    eventId: "portal-acceptance-event",
    confirmedEventId: "portal-acceptance-event",
    now: () => 1_000,
    sleep: async () => {},
    timeoutMs: 10_000,
    pollIntervalMs: 0,
  });

  assert.deepEqual(result, {
    outcome: "passed",
    approval: "verified",
    cancel: "verified",
    result: "verified",
    cleanup: "verified",
  });
  assert.equal(fake.runs.get("run_1").status, "cancelled");
  assert.equal(fake.runs.get("run_2").status, "success");

  const approvals = fake.calls.filter((call) => call.pathname.endsWith("/approve"));
  assert.equal(approvals.length, 2);
  assert.equal(approvals.every((call) => call.actor === "approver"), true);
  const executions = fake.calls.filter((call) => call.pathname.endsWith("/execute"));
  assert.equal(executions.every((call) => call.actor === "requester"), true);
});

test("XYOps lifecycle requires explicit event confirmation and a no-input dangerous test event", async () => {
  const fake = fakeXyOps();
  await assert.rejects(
    () => executeXyOpsLifecycleAcceptance({
      requesterRequest: fake.requesterRequest,
      approverRequest: fake.approverRequest,
      eventId: "portal-acceptance-event",
      confirmedEventId: "wrong-event",
    }),
    /acceptance_xyops_event_confirmation_required/u,
  );

  const ordinary = fakeXyOps({ dangerous: false });
  await assert.rejects(
    () => executeXyOpsLifecycleAcceptance({
      requesterRequest: ordinary.requesterRequest,
      approverRequest: ordinary.approverRequest,
      eventId: "portal-acceptance-event",
      confirmedEventId: "portal-acceptance-event",
    }),
    /acceptance_xyops_event_not_dangerous/u,
  );

  const withInput = fakeXyOps({ fields: [{ key: "message", required: false }] });
  await assert.rejects(
    () => executeXyOpsLifecycleAcceptance({
      requesterRequest: withInput.requesterRequest,
      approverRequest: withInput.approverRequest,
      eventId: "portal-acceptance-event",
      confirmedEventId: "portal-acceptance-event",
    }),
    /acceptance_xyops_event_inputs_forbidden/u,
  );
});

test("XYOps lifecycle reconciles an active second run after a terminal failure", async () => {
  const fake = fakeXyOps({ failResult: true });

  await assert.rejects(
    () => executeXyOpsLifecycleAcceptance({
      requesterRequest: fake.requesterRequest,
      approverRequest: fake.approverRequest,
      eventId: "portal-acceptance-event",
      confirmedEventId: "portal-acceptance-event",
      now: () => 1_000,
      sleep: async () => {},
      timeoutMs: 10_000,
      pollIntervalMs: 0,
    }),
    /acceptance_xyops_run_failed/u,
  );

  assert.equal(fake.runs.get("run_1").status, "cancelled");
  assert.equal(fake.runs.get("run_2").status, "failed");
});

test("XYOps lifecycle recovers an executed run after the execute response is lost", async () => {
  const fake = fakeXyOps();
  let lost = false;
  const requester = async (pathname, options) => {
    if (!lost && pathname.endsWith("/execute")) {
      await fake.requesterRequest(pathname, options);
      lost = true;
      throw new Error("lost execute response");
    }
    return fake.requesterRequest(pathname, options);
  };

  await assert.rejects(
    () => executeXyOpsLifecycleAcceptance({
      requesterRequest: requester,
      approverRequest: fake.approverRequest,
      eventId: "portal-acceptance-event",
      confirmedEventId: "portal-acceptance-event",
      now: () => 1_000,
      sleep: async () => {},
      timeoutMs: 10_000,
      pollIntervalMs: 0,
    }),
    /lost execute response/u,
  );

  assert.equal(fake.approvals.get("approval_1").status, "executed");
  assert.equal(fake.runs.get("run_1").status, "cancelled");
  assert.equal(
    fake.calls.some((call) => call.pathname === "/api/integrations/approvals?limit=100"),
    true,
  );
});

test("XYOps cleanup failure overrides the primary lifecycle failure", async () => {
  const fake = fakeXyOps({ failResult: true, failCleanup: true });
  fake.runs.set("run_legacy", {
    id: "run_legacy",
    status: "queued",
    result: { available: false },
  });

  // Force the first lifecycle approval to fail after it is created, leaving an approval for cleanup.
  const requester = async (pathname, options) => {
    if (pathname.endsWith("/execute")) throw new Error("lost response");
    return fake.requesterRequest(pathname, options);
  };

  await assert.rejects(
    () => executeXyOpsLifecycleAcceptance({
      requesterRequest: requester,
      approverRequest: fake.approverRequest,
      eventId: "portal-acceptance-event",
      confirmedEventId: "portal-acceptance-event",
    }),
    /acceptance_xyops_cleanup_failed/u,
  );
});
