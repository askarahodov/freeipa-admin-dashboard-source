import { expect, test } from "@playwright/test";

const baseURL = String(process.env.E2E_BASE_URL || "http://127.0.0.1:3001").replace(/\/+$/, "");
const adminUsername = String(process.env.E2E_ADMIN_USERNAME || "").trim();
const adminPassword = String(process.env.E2E_ADMIN_PASSWORD || "");

if (!adminUsername || !adminPassword) {
  throw new Error("E2E_ADMIN_USERNAME and E2E_ADMIN_PASSWORD are required");
}

async function login(page, username, password, next = "/") {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Логин").fill(username);
  await page.getByLabel("Пароль").fill(password);
  await page.getByRole("button", { name: "Войти" }).click();
  await page.waitForURL(new RegExp(`${next.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), { timeout: 30_000 });
}

async function loginContext(context, page, username, password, next = "/") {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Логин").fill(username);
  await page.getByLabel("Пароль").fill(password);
  await page.getByRole("button", { name: "Войти" }).click();
  await page.waitForURL(new RegExp(`${next.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), { timeout: 30_000 });
  await expect.poll(async () => (await context.request.get("/api/auth/session")).status(), { timeout: 15_000 }).toBe(200);
}

async function createPortalUser(page, username, password) {
  const response = await page.request.post("/api/auth/users", {
    headers: { origin: baseURL },
    data: {
      username,
      displayName: "E2E XYOps Operator",
      password,
      role: "operator",
    },
  });
  expect(response.status()).toBe(201);
  const payload = await response.json();
  expect(payload.user?.id).toBeTruthy();
  return payload.user;
}

async function resetMock(page) {
  const response = await page.request.post("/api/e2e/xyops/reset");
  expect(response.ok()).toBeTruthy();
}

async function loadMockJobs(context) {
  const response = await context.request.get("/api/e2e/xyops/jobs");
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  return Array.isArray(payload.jobs) ? payload.jobs : [];
}

async function loadRuns(context) {
  const response = await context.request.get("/api/operations/runs?limit=100");
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  return Array.isArray(payload.runs) ? payload.runs : [];
}

async function confirmPortalAction(page, heading, buttonName) {
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  await dialog.getByLabel("Контрольная фраза").fill("ПОДТВЕРЖДАЮ");
  await dialog.getByRole("button", { name: buttonName, exact: true }).click();
}

async function launchDangerousWorkflow(page, title, scenario) {
  await page.goto("/automation");
  await page.getByText("E2E lifecycle workflow", { exact: true }).click();
  const processModal = page.locator(".process-modal");
  await expect(processModal).toBeVisible();
  await processModal.getByLabel("Название запуска").fill(title);
  await processModal.getByLabel("Сценарий").selectOption(scenario.startsWith("cancel-") ? "cancel" : "result");
  await processModal.getByLabel("E2E сценарий").fill(scenario);
  await processModal.getByRole("button", { name: "Запустить", exact: true }).click();
  await confirmPortalAction(page, "Запустить опасную операцию?", "Запустить");
}

async function approveAsAdmin(page, title, scenario) {
  await page.goto("/approvals");
  const approval = page.locator(".approval-card").filter({ hasText: title }).filter({ hasText: scenario });
  await expect(approval).toBeVisible();
  await approval.getByRole("button", { name: "Согласовать", exact: true }).click();
  await confirmPortalAction(page, "Согласовать операцию?", "Согласовать");
}

async function executeAsRequester(operatorPage, title, scenario) {
  await operatorPage.goto("/approvals");
  const approval = operatorPage.locator(".approval-card").filter({ hasText: title }).filter({ hasText: scenario });
  await expect(approval).toBeVisible();
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

function operationRow(page, title, jobId) {
  return page.locator("button.operation-explorer-row")
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
      const cancelRow = operationRow(operatorPage, cancelTitle, cancelJobId);
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
      await operatorPage.goto("/operations");
      const resultRow = operationRow(operatorPage, resultTitle, resultJobId);
      await expect(resultRow).toBeVisible();
      await expect.poll(async () => {
        const run = (await loadRuns(operatorContext)).find((item) => item.jobId === resultJobId);
        return run?.status ?? "missing";
      }, { timeout: 20_000, intervals: [250, 500, 1000] }).toBe("succeeded");
      await resultRow.click();
      const resultModal = operatorPage.locator(".run-details-modal");
      await expect(resultModal).toBeVisible();
      await expect(resultModal).toContainText("E2E lifecycle output");
    } finally {
      await operatorContext.close();
    }
  } finally {
    if (operatorUser?.id) {
      await page.request.delete(`/api/auth/users/${encodeURIComponent(operatorUser.id)}`, {
        headers: { origin: baseURL },
      }).catch(() => {});
    }
  }
});
