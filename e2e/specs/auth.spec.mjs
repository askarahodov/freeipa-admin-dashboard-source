import { expect, test } from "@playwright/test";

const adminUsername = String(process.env.E2E_ADMIN_USERNAME || "").trim();
const adminPassword = String(process.env.E2E_ADMIN_PASSWORD || "");

if (!adminUsername || !adminPassword) {
  throw new Error("E2E_ADMIN_USERNAME and E2E_ADMIN_PASSWORD are required");
}

async function fillLogin(page, password = adminPassword) {
  await page.getByLabel("Логин").fill(adminUsername);
  await page.getByLabel("Пароль").fill(password);
  await page.getByRole("button", { name: "Войти" }).click();
}

test.describe.serial("local portal authentication", () => {
  test("redirects an unauthenticated browser to login", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveURL(/\/login(?:\?|$)/);
    await expect(page.getByRole("heading", { name: "Вход в портал" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Войти" })).toBeEnabled();
  });

  test("shows an error for an invalid password", async ({ page }) => {
    await page.goto("/login");
    await fillLogin(page, `${adminPassword}-wrong`);

    await expect(page).toHaveURL(/\/login(?:\?|$)/);
    await expect(page.getByText("Неверный логин или пароль")).toBeVisible();
    await expect(page.getByRole("button", { name: "Войти" })).toBeEnabled();
  });

  test("logs in and logs out through the browser UI", async ({ page }) => {
    await page.goto("/login?next=/");
    await fillLogin(page);

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "Обзор инфраструктуры" })).toBeVisible();
    await expect(page.locator(".local-auth-toolbar")).toContainText("E2E Administrator");
    await expect(page.locator(".local-auth-toolbar")).toContainText("Администратор");

    await page.locator(".local-auth-toolbar").getByRole("button", { name: "Выйти" }).click();

    await expect(page).toHaveURL(/\/login(?:\?|$)/);
    await expect(page.getByRole("heading", { name: "Вход в портал" })).toBeVisible();

    await page.goto("/");
    await expect(page).toHaveURL(/\/login(?:\?|$)/);
  });
});
