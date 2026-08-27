import { expect, test } from "@playwright/test";

const baseURL = String(process.env.E2E_BASE_URL || "http://127.0.0.1:3001").replace(/\/+$/, "");
const adminUsername = String(process.env.E2E_ADMIN_USERNAME || "").trim();
const adminPassword = String(process.env.E2E_ADMIN_PASSWORD || "");
const xyopsMockBaseURL = (() => {
  const raw = String(process.env.XYOPS_URL || "").trim();
  if (!raw) throw new Error("XYOPS_URL is required for the XYOps lifecycle E2E scenario");
  const url = new URL(raw);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password) {
    throw new Error("XYOPS_URL must point to the isolated HTTP mock on 127.0.0.1");
  }
  return url.href.replace(/\/+$/, "");
})();

if (!adminUsername || !adminPassword) {
  throw new Error("E2E_ADMIN_USERNAME and E2E_ADMIN_PASSWORD are required");
}

function mockUrl(path) {
  return `${xyopsMockBaseURL}${path.startsWith("/") ? path : `/${path}`}`;
}

async function responseFailure(response, label) {
  const body = await response.text().catch(() => "");
  return new Error(`${label}: HTTP ${response.status()}${body ? ` · ${body.slice(0, 500)}` : ""}`);
}

async function login(page, username, password, next = "/") {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Логин").fill(username);
  await page.getByLabel("Пароль").fill(password);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL(new RegExp(`${next.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
}

async function loginContext(context, page, username, password, next = "/") {
  const response = await context.request.post("/api/auth/login", {
    data: { username, password },
  });
  if (!response.ok()) throw await responseFailure(response, "Operator login failed");
  const payload = await response.json();
  expect(payload.authenticated).toBe(true);
  expect(payload.user?.username).toBe(username);
  expect(payload.user?.role).toBe("operator");
  await page.goto(next);
  await expect(page).toHaveURL(new RegExp(`${next.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
}

async function confirmPortalAction(page, dialogTitle, buttonName) {
  const dialog = page.getByRole("alertdialog", { name: dialogTitle });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: buttonName, exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

async function createPortalUser(page, username, password) {
  const response = await page.request.post("/api/auth/users", {
    data: {
      username,
      displayName: "E2E XYOps Operator",
      password,
      role: "operator",
    },
  });
  if (!response.ok()) throw await responseFailure(response, "Operator creation failed");
  const payload = await response.json();
  expect(response.status()).toBe(201);
  expect(payload.user?.id).toBeTruthy();
  expect(payload.user?.username).toBe(username);
  return payload.user;
}

async function loadRuns(context) {
  const response = await context.request.get("/api/integrations/runs?limit=100&sync=1");
  if (!response.ok()) throw await responseFailure(response, "Runs API failed");
  const payload = await response.json();
  if (!Array.isArray(payload.runs)) throw new Error("Runs API response does not contain a runs array");
  return payload.runs;
}

async function loadMockJobs(context) {
  const response = await context.request.get(mockUrl("/__mock/state"));
  if (!response.ok()) throw await responseFailure(response, "XYOps mock state request failed");
  const payload = await response.json();
  if (!Array.isArray(payload.jobs)) throw new Error("XYOps mock state does not contain a jobs array");
  return payload.jobs;
}

async function resetMock(requestOwner) {
  const response = await requestOwner.request.post(mockUrl("/__mock/reset"));
  if (!response.ok()) throw await responseFailure(response, "XYOps mock reset failed");
}

async function launchDangerousWorkflow(page, title, scenario) {
  await page.goto("/automation");
  const card = page.locator(".process-card").filter({ hasText: title });
  await expect(card).toBeVisible();
  await expect(card).toContainText("Подтверждение");
  await card.getByRole("button", { name: /Сформировать и запустить/ }).click();

  const modal = page.locator(".process-modal");
  await expect(modal).toBeVisible();
  await modal.locator('[name="scenario"]').fill(scenario);
  await modal.locator('[name="__targets"]').selectOption("e2e-runner");
  await modal.locator(".danger-confirm input[type=checkbox]").check();
  await modal.getByRole("button", { name: "Запустить Workflow" }).click();

  await expect(page).toHaveURL(/\/approvals$/);
  const approval = page.locator(".approval-card").filter({ hasText: title }).filter({ hasText: scenario });
  await expect(approval).toBeVisible();
  await expect(approval).toContainText("Ожидает");
  return approval;
}

async function approveAsAdmin(adminPage, title, scenario) {
  await adminPage.goto("/approvals");
  const approval = adminPage.locator(".approval-card").filter({ hasText: title }).filter({ hasText: scenario });
  await expect(approval).toBeVisible();
  await approval.getByRole("button", { name: "Одобрить", exact: true }).click();
  await confirmPortalAction(adminPage, "Одобрить опасную операцию?", "Одобрить");
  await expect(approval).toContainText("Согласовано");
}

async function executeAsRequester(operatorPage, title, scenario) {
  await operatorPage.goto("/approvals");
  const approval = operatorPage.locator(".approval-card").filter({ hasText: title }).filter({ hasText: scenario });
  await expect(approval).toBeVisible();
  await expect(approval).toContainText("Согласовано");
  await approval.getByRole("button", { name: "Выполнить в XYOps", exact: true }).click();
  await confirmPortalAction(operatorPage, "Выполнить согласованную операцию?", "Выполнить в XYOps");
  await expect(operatorPage).toHaveURL(/\/operations$/);
}

async function currentJobId(context, eventId, scenario) {
  let jobId = "";
  await expect.poll(async () => {
    const job = (await loadMockJobs(context)).find((item) => item.eventId === eventId && item.scenario === scenario);
    jobId = String(job?.id || "");
    return Boolean(jobId);
  }, { timeout: 20_000, intervals: [250, 500, 1000] }).toBe(true);
  return jobId;
}

async function waitForCancellableRun(context, jobId) {
  await expect.poll(async () => {
    const run = (await loadRuns(context)).find((item) => item.jobId === jobId);
    return {
      status: run?.status ?? "missing",
      cancel: run?.actions?.cancel === true,
    };
  }, { timeout: 20_000, intervals: [250, 500, 1000] }).toEqual({ status: "running", cancel: true });
}

async function visibleOperationsPanel(page) {
  const heading = page.getByRole("heading", { name: "Журнал операций", exact: true });
  await expect(heading).toBeVisible();
  const panel = heading.locator("xpath=ancestor::section[contains(@class,'section-page')][1]");
  await expect(panel).toBeVisible();
  return panel;
}

async function operationRow(page, title, jobId) {
  const panel = await visibleOperationsPanel(page);
  return panel.locator(".selectable-run")
    .filter({ hasText: title })
    .filter({ hasText: jobId });
}

test("XYOps dangerous workflows support approval, cancellation and result rendering", async ({ page, browser }, testInfo) => {
  test.setTimeout(180_000);

  const suffix = `${Date.now().toString(36)}-${testInfo.retry}`;
  const operatorUsername = `e2e-xyops-${suffix}`;
  const operatorPassword = `XYOps-${Date.now()}-Operator-Aa1`;
  const cancelTitle = "E2E lifecycle cancellation";
  const resultTitle = "E2E lifecycle result";
  const cancelScenario = `cancel-${suffix}`;
  const resultScenario = `result-${suffix}`;
  let operatorUser = null;

  await login(page, adminUsername, adminPassword);
  await resetMock(page);

  try {
    operatorUser = await createPortalUser(page, operatorUsername, operatorPassword);
    const operatorContext = await browser.newContext({ baseURL });

    try {
      const operatorPage = await operatorContext.newPage();
      await loginContext(operatorContext, operatorPage, operatorUsername, operatorPassword, "/automation");
      await expect(operatorPage.locator(".local-auth-toolbar")).toContainText("Оператор");

      await launchDangerousWorkflow(operatorPage, cancelTitle, cancelScenario);
      await approveAsAdmin(page, cancelTitle, cancelScenario);
      await executeAsRequester(operatorPage, cancelTitle, cancelScenario);

      const cancelJobId = await currentJobId(operatorContext, "e2e-lifecycle-cancel", cancelScenario);
      await waitForCancellableRun(operatorContext, cancelJobId);

      await operatorPage.goto("/operations");
      const cancelRow = await operationRow(operatorPage, cancelTitle, cancelJobId);
      await expect(cancelRow).toBeVisible();
      await cancelRow.click();
      const cancelModal = operatorPage.locator(".run-details-modal");
      await expect(cancelModal).toBeVisible();
      await cancelModal.getByRole("button", { name: "Остановить задание", exact: true }).click();
      await confirmPortalAction(operatorPage, "Остановить активное задание?", "Остановить задание");
      await expect(cancelModal).toHaveCount(0);
      await expect(cancelRow).toContainText("Остановлено");

      await launchDangerousWorkflow(operatorPage, resultTitle, resultScenario);
      await approveAsAdmin(page, resultTitle, resultScenario);
      await executeAsRequester(operatorPage, resultTitle, resultScenario);

      const resultJobId = await currentJobId(operatorContext, "e2e-lifecycle-result", resultScenario);
      await expect.poll(async () => {
        const run = (await loadRuns(operatorContext)).find((item) => item.jobId === resultJobId);
        return { status: run?.status ?? "missing", result: run?.result?.available === true };
      }, { timeout: 30_000, intervals: [250, 500, 1000] }).toEqual({ status: "success", result: true });

      await operatorPage.goto("/operations");
      const resultRow = await operationRow(operatorPage, resultTitle, resultJobId);
      await expect(resultRow).toBeVisible();
      await expect(resultRow).toContainText("Успешно");
      await resultRow.click();

      const resultModal = operatorPage.locator(".run-details-modal");
      await expect(resultModal).toBeVisible();
      await expect(resultModal.getByRole("heading", { name: "Выходные данные задания" })).toBeVisible();
      await expect(resultModal.getByText("Lifecycle completed through XYOps mock", { exact: true })).toBeVisible();
      await expect(resultModal.getByText("completed", { exact: true })).toBeVisible();
      await expect(resultModal.getByRole("cell", { name: "Launch" })).toBeVisible();
      await expect(resultModal.getByRole("cell", { name: "captured" })).toBeVisible();
    } finally {
      await operatorContext.close();
    }
  } finally {
    if (operatorUser?.id) {
      await page.request.delete(`/api/auth/users/${encodeURIComponent(operatorUser.id)}`).catch(() => {});
    }
    await resetMock(page).catch(() => {});
  }
});
