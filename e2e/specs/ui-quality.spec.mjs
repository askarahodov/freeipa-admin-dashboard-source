import { expect, test } from "@playwright/test";

const adminUsername = String(process.env.E2E_ADMIN_USERNAME || "").trim();
const adminPassword = String(process.env.E2E_ADMIN_PASSWORD || "");

if (!adminUsername || !adminPassword) throw new Error("E2E_ADMIN_USERNAME and E2E_ADMIN_PASSWORD are required");

async function login(page) {
  await page.goto("/login?next=/");
  await page.getByLabel("Логин").fill(adminUsername);
  await page.getByLabel("Пароль").fill(adminPassword);
  await page.getByRole("button", { name: "Войти" }).click();
  await page.waitForURL(/\/$/, { timeout: 30_000 });
}

async function tabUntilFocused(page, locator, limit = 40) {
  for (let index = 0; index < limit; index += 1) {
    if (await locator.evaluate((element) => element === document.activeElement).catch(() => false)) return true;
    await page.keyboard.press("Tab");
  }
  return await locator.evaluate((element) => element === document.activeElement).catch(() => false);
}

test.describe.serial("UI accessibility and responsive baseline", () => {
  test("login controls follow a predictable keyboard order", async ({ page }) => {
    await page.goto("/login");
    const username = page.getByLabel("Логин");
    const password = page.getByLabel("Пароль");
    const submit = page.getByRole("button", { name: "Войти" });

    await expect(username).toBeVisible();
    await username.focus();
    await expect(username).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(password).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(submit).toBeFocused();
  });

  test("shared authenticated controls are keyboard reachable and visibly focused", async ({ page }) => {
    await login(page);
    const logout = page.locator(".local-auth-toolbar").getByRole("button", { name: "Выйти" });
    const reached = await tabUntilFocused(page, logout);
    expect(reached).toBe(true);

    const focusStyle = await logout.evaluate((element) => {
      const style = getComputedStyle(element);
      return { width: style.outlineWidth, style: style.outlineStyle };
    });
    expect(focusStyle.style).not.toBe("none");
    expect(Number.parseFloat(focusStyle.width)).toBeGreaterThanOrEqual(2);

    await expect(page.getByRole("button", { name: "Уведомления операций" })).toBeVisible();
  });

  test("authenticated overview remains usable across the viewport matrix", async ({ page }) => {
    await login(page);
    const viewports = [
      { name: "desktop", width: 1440, height: 900 },
      { name: "tablet", width: 1024, height: 768 },
      { name: "narrow", width: 390, height: 844 },
    ];

    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/");
      const heading = page.getByRole("heading", { name: "Обзор инфраструктуры" });
      await expect(heading).toBeVisible();
      await expect(page.locator(".local-auth-toolbar")).toBeVisible();
      const viewportMeta = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
      expect(viewportMeta.width, viewport.name).toBe(viewport.width);
      expect(viewportMeta.height, viewport.name).toBe(viewport.height);
      const headingBox = await heading.boundingBox();
      expect(headingBox, `${viewport.name}: heading box`).not.toBeNull();
      expect(headingBox.x, `${viewport.name}: heading starts inside viewport`).toBeGreaterThanOrEqual(0);
      expect(headingBox.x, `${viewport.name}: heading remains reachable`).toBeLessThan(viewport.width);
    }
  });

  test("visible UI artifacts contain no credentials or known internal host fixtures", async ({ page }) => {
    await login(page);
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toContain(adminPassword);
    expect(bodyText).not.toMatch(/(?:ldap|pg\d+)\.softrust\.ru/iu);

    const statuses = await page.locator(".status").allTextContents();
    for (const label of statuses) expect(label.trim().length).toBeGreaterThan(0);
  });
});
