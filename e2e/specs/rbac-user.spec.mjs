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

test("administrator creates a local user and assigns the operator role", async ({ page, browser }, testInfo) => {
  const username = `e2e-role-${Date.now().toString(36)}-${testInfo.retry}`;
  const displayName = "E2E Role User";
  const password = `Role-E2E-${Date.now()}-Aa1`;

  await login(page, adminUsername, adminPassword, "/access");
  await expect(page.getByRole("heading", { name: "Управление доступом" })).toBeVisible();

  const createForm = page.locator(".access-create-form");
  await createForm.getByLabel("Логин").fill(username);
  await createForm.getByLabel("Отображаемое имя").fill(displayName);
  await createForm.locator('input[type="password"]').nth(0).fill(password);
  await createForm.locator('input[type="password"]').nth(1).fill(password);
  await createForm.locator("select").selectOption("viewer");
  await createForm.getByRole("button", { name: "Создать" }).click();

  await expect(page.getByText("Локальный пользователь создан")).toBeVisible();

  const search = page.getByLabel("Поиск локальных пользователей");
  await search.fill(username);
  const userCard = page.locator(".access-user-card").filter({ hasText: username });
  const roleSelect = userCard.locator("select");
  await expect(userCard).toBeVisible();
  await expect(roleSelect).toHaveValue("viewer");

  await roleSelect.selectOption("operator");
  await expect(page.getByText("Роль пользователя обновлена")).toBeVisible();
  await expect(roleSelect).toHaveValue("operator");

  const operatorContext = await browser.newContext({ baseURL });
  const operatorPage = await operatorContext.newPage();
  try {
    await login(operatorPage, username, password, "/");
    await expect(operatorPage.getByRole("heading", { name: "Обзор инфраструктуры" })).toBeVisible();
    await expect(operatorPage.locator(".local-auth-toolbar")).toContainText(displayName);
    await expect(operatorPage.locator(".local-auth-toolbar")).toContainText("Оператор");
  } finally {
    await operatorContext.close();
  }

  await userCard.getByRole("button", { name: "Удалить" }).click();
  const confirmation = page.getByRole("alertdialog", { name: "Безвозвратно удалить объект?" });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("textbox", { name: /Контрольная фраза/ }).fill("УДАЛИТЬ");
  await confirmation.getByRole("button", { name: "Удалить безвозвратно" }).click();

  await expect(page.getByText("Пользователь удалён")).toBeVisible();
  await expect(userCard).toHaveCount(0);
});
