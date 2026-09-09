import http from "node:http";

const port = Number(process.env.XYOPS_MOCK_PORT || 3902);
const apiKey = String(process.env.XYOPS_MOCK_API_KEY || "").trim();
const maxBodyBytes = 64 * 1024;

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("XYOPS_MOCK_PORT must be an integer between 1 and 65535");
}
if (!apiKey) {
  throw new Error("XYOPS_MOCK_API_KEY is required");
}

const jobs = new Map();
let sequence = 0;
let catalogFailure = false;

const events = [
  {
    id: "e2e-lifecycle-cancel",
    title: "E2E lifecycle cancellation",
    description: "Long-running workflow used to verify approval and cancellation.",
    type: "workflow",
    category: "E2E Lifecycle",
    enabled: true,
    dangerous: true,
    targets: ["e2e-runner"],
    fields: [
      {
        key: "scenario",
        label: "Сценарий",
        type: "string",
        required: true,
        target: "workflowData",
        placeholder: "cancel-run",
      },
    ],
  },
  {
    id: "e2e-lifecycle-result",
    title: "E2E lifecycle result",
    description: "Workflow used to verify approval, execution and result rendering.",
    type: "workflow",
    category: "E2E Lifecycle",
    enabled: true,
    dangerous: true,
    targets: ["e2e-runner"],
    fields: [
      {
        key: "scenario",
        label: "Сценарий",
        type: "string",
        required: true,
        target: "workflowData",
        placeholder: "result-run",
      },
    ],
  },
];

function json(response, status, body) {
  const payload = Buffer.from(JSON.stringify(body));
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(payload.length),
    "cache-control": "no-store",
  });
  response.end(payload);
}

function requestError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function readJson(request) {
  const declaredLength = Number(request.headers["content-length"] || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
    throw requestError(413, "Request body is too large");
  }

  const chunks = [];
  let received = 0;
  for await (const chunk of request) {
    received += chunk.length;
    if (received > maxBodyBytes) throw requestError(413, "Request body is too large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw requestError(400, "Request body must contain valid JSON");
  }
}

function authorized(request) {
  return request.headers["x-api-key"] === apiKey;
}

function stage(id, title, status, startedAt, completedAt = null) {
  return { id, title, status, started_at: startedAt, completed_at: completedAt };
}

function activeRow(job) {
  return {
    job_id: job.id,
    status: "running",
    state: "running",
    stages: [
      stage("approval", "Approval accepted", "success", job.createdAt, job.createdAt),
      stage("execution", "Workflow execution", "running", job.createdAt),
      stage("result", "Result collection", "queued", null),
    ],
  };
}

function completedRow(job) {
  const completedAt = job.completedAt || Date.now();
  return {
    job_id: job.id,
    status: "success",
    state: "success",
    code: 0,
    completed: completedAt,
    completed_at: completedAt,
    description: "Lifecycle completed through XYOps mock",
    message: "Lifecycle completed through XYOps mock",
    stages: [
      stage("approval", "Approval accepted", "success", job.createdAt, job.createdAt),
      stage("execution", "Workflow execution", "success", job.createdAt, completedAt),
      stage("result", "Result collection", "success", completedAt, completedAt),
    ],
    data: {
      outcome: "completed",
      approval: "approved",
      scenario: job.scenario,
      target: job.target,
      dashboard_url: "https://example.test/xyops/e2e-lifecycle",
    },
    table: {
      columns: ["Phase", "Status"],
      rows: [
        ["Launch", "success"],
        ["Result", "captured"],
      ],
    },
    files: [],
  };
}

function cancelledRow(job) {
  return {
    job_id: job.id,
    status: "cancelled",
    state: "cancelled",
    completed: job.completedAt || Date.now(),
    description: "Lifecycle cancelled through XYOps mock",
    stages: [
      stage("approval", "Approval accepted", "success", job.createdAt, job.createdAt),
      stage("execution", "Workflow execution", "cancelled", job.createdAt, job.completedAt || Date.now()),
    ],
  };
}

function jobRow(job) {
  if (job.status === "success") return completedRow(job);
  if (job.status === "cancelled") return cancelledRow(job);
  return activeRow(job);
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://127.0.0.1:${port}`);

  if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
    return json(response, 200, { ok: true, service: "xyops-mock", jobs: jobs.size, catalogFailure });
  }

  if (url.pathname.startsWith("/api/app/") && !authorized(request)) {
    return json(response, 401, { code: 401, error: "Invalid XYOps API key" });
  }

  try {
    if (request.method === "GET" && url.pathname === "/api/app/get_events/v1") {
      if (catalogFailure) return json(response, 503, { code: 503, error: "Injected XYOps catalog failure" });
      return json(response, 200, { code: 0, events });
    }

    if (request.method === "POST" && url.pathname === "/api/app/run_event/v1") {
      const body = await readJson(request);
      const eventId = String(body.id || "");
      const event = events.find((item) => item.id === eventId);
      if (!event) return json(response, 404, { code: 404, error: "Event not found" });

      sequence += 1;
      const now = Date.now();
      const kind = eventId.endsWith("cancel") ? "cancel" : "result";
      const id = `job_${kind}_${now.toString(36)}_${sequence}`;
      const job = {
        id,
        eventId,
        status: "running",
        createdAt: now,
        completedAt: null,
        activePolls: 0,
        scenario: String(body.workflowData?.scenario || body.params?.scenario || "e2e"),
        target: Array.isArray(body.targets) ? String(body.targets[0] || "e2e-runner") : "e2e-runner",
      };
      jobs.set(id, job);
      return json(response, 202, { code: 0, job_id: id, status: "running" });
    }

    if (request.method === "GET" && url.pathname === "/api/app/get_active_jobs/v1") {
      const active = [];
      for (const job of jobs.values()) {
        if (job.status !== "running") continue;
        if (job.eventId === "e2e-lifecycle-result") {
          job.activePolls += 1;
          if (job.activePolls >= 2) {
            job.status = "success";
            job.completedAt = Date.now();
            continue;
          }
        }
        active.push(activeRow(job));
      }
      return json(response, 200, { code: 0, jobs: active });
    }

    if (request.method === "POST" && url.pathname === "/api/app/get_jobs/v1") {
      const body = await readJson(request);
      const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
      const rows = ids.map((id) => jobs.get(id)).filter(Boolean).map(jobRow);
      return json(response, 200, { code: 0, jobs: rows });
    }

    if (request.method === "POST" && url.pathname === "/api/app/abort_job/v1") {
      const body = await readJson(request);
      const id = String(body.id || "");
      const job = jobs.get(id);
      if (!job) return json(response, 404, { code: 404, error: "Job not found" });
      job.status = "cancelled";
      job.completedAt = Date.now();
      return json(response, 200, { code: 0, ok: true, job_id: id, status: "cancelled" });
    }

    if (request.method === "POST" && url.pathname === "/__mock/catalog-failure") {
      const body = await readJson(request);
      catalogFailure = body.enabled === true;
      return json(response, 200, { ok: true, catalogFailure });
    }

    if (request.method === "POST" && url.pathname === "/__mock/reset") {
      jobs.clear();
      sequence = 0;
      catalogFailure = false;
      return json(response, 200, { ok: true });
    }

    if (request.method === "GET" && url.pathname === "/__mock/state") {
      return json(response, 200, { jobs: Array.from(jobs.values()), catalogFailure });
    }

    return json(response, 404, { code: 404, error: "Not found" });
  } catch (error) {
    const statusCode = Number(error?.statusCode) || 500;
    return json(response, statusCode, {
      code: statusCode,
      error: error instanceof Error ? error.message : "XYOps mock failure",
    });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Stateful XYOps mock listening on http://127.0.0.1:${port}`);
});

const shutdown = () => server.close(() => process.exit(0));
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
