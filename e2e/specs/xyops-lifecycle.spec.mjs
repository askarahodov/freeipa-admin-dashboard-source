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
  expect(response.status()).toBe(201);
  const payload = await response.json();
  expect(payload.user?.id).toBeTruthy();
  return payload.user;
}

async function loadRuns(context) {
  const response = await context.request.get("/api/integrations/runs?limit=100&sync=1");
  if (!response.ok()) return [];
  const payload = await response.json();
  return Array.isArray(payload.runs) ? payload.runs : [];
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

function operationRow(page, title, jobId) {
  return page.locator(".tr.ops-detailed").filter({ hasText: title }).filter({ hasText: jobId });
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
  await page.request.post("http://127.0.0.1:3902/__mock/reset").catch(() => {});

  try {
    operatorUser = await createPortalUser(page, operatorUsername, operatorPassword);
    const operatorContext = await browser.newContext({ baseURL });

    try {
      const operatorPage = await operatorContext.newPage();
      await login(operatorPage, operatorUsername, operatorPassword, "/automation");
      await expect(operatorPage.locator(".local-auth-toolbar")).toContainText("Оператор");

      await launchDangerousWorkflow(operatorPage, cancelTitle, cancelScenario);
      await approveAsAdmin(page, cancelTitle, cancelScenario);
      await executeAsRequester(operatorPage, cancelTitle, cancelScenario);

      let cancelJobId = "";
      await expect.poll(async () => {
        const run = (await loadRuns(operatorContext)).find((item) => item.eventId === "e2e-lifecycle-cancel");
        cancelJobId = String(run?.jobId || "");
        return Boolean(cancelJobId && ["queued", "running"].includes(run?.status));
      }, { timeout: 20_000, intervals: [250, 500, 1000] }).toBe(true);

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

      let resultJobId = "";
      await expect.poll(async () => {
        const run = (await loadRuns(operatorContext)).find((item) => item.eventId === "e2e-lifecycle-result");
        resultJobId = String(run?.jobId || "");
        return { status: run?.status ?? "missing", result: run?.result?.available === true };
      }, { timeout: 30_000, intervals: [250, 500, 1000] }).toEqual({ status: "success", result: true });

      await operatorPage.goto("/operations");
      const resultRow = operationRow(operatorPage, resultTitle, resultJobId);
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
    await page.request.post("http://127.0.0.1:3902/__mock/reset").catch(() => {});
  }
});
