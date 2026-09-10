import { expect, test } from "@playwright/test";

const username = String(process.env.E2E_ADMIN_USERNAME || "").trim();
const password = String(process.env.E2E_ADMIN_PASSWORD || "");

if (!username || !password) throw new Error("E2E admin credentials are required");

test("enforcing CSP stays violation-free across login and authenticated navigation", async ({ page }) => {
  const violations = [];
  page.on("console", (message) => {
    const text = message.text();
    if (/content security policy|refused to (?:load|execute|apply|connect|frame)/iu.test(text)) violations.push(text);
  });

  const loginResponse = await page.goto("/login?next=/");
  expect(loginResponse).not.toBeNull();
  const csp = loginResponse.headers()["content-security-policy"] ?? "";
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).not.toContain("unsafe-eval");

  await page.getByLabel("Логин").fill(username);
  await page.getByLabel("Пароль").fill(password);
  await page.getByRole("button", { name: "Войти" }).click();
  await page.waitForURL(/\/$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Обзор" })).toBeVisible();
  await page.waitForLoadState("networkidle");

  expect(violations, violations.join("\n")).toEqual([]);
});
