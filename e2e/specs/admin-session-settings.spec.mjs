import { expect, test } from "@playwright/test";

const adminUsername = String(process.env.E2E_ADMIN_USERNAME || "").trim();
const adminPassword = String(process.env.E2E_ADMIN_PASSWORD || "");

if (!adminUsername || !adminPassword) {
  throw new Error("E2E_ADMIN_USERNAME and E2E_ADMIN_PASSWORD are required");
}

async function login(page, next = "/") {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Логин").fill(adminUsername);
  await page.getByLabel("Пароль").fill(adminPassword);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe(next);
}

test("local admin manages settings after in-app navigation without a browser ADMIN_TOKEN", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: /Настройки/ }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe("/settings");

  await expect(page.getByTestId("local-admin-session-settings")).toBeVisible();
  await expect(page.getByTestId("local-admin-session-settings")).toContainText("settings.manage");
  await expect(page.getByTestId("settings-lifecycle-wizard")).toBeVisible();
  await expect(page.getByTestId("settings-lifecycle-wizard")).toContainText("Черновик → проверка → применение");
  await expect(page.locator(".settings-access")).toBeHidden();
  await expect(page.locator(".policy-toolbar > label").first()).toBeHidden();
  await expect(page.locator(".route-editor > label:last-of-type")).toBeHidden();

  const result = await page.evaluate(async () => {
    const settingsResponse = await fetch("/api/integrations/settings", { cache: "no-store" });
    const settings = await settingsResponse.json().catch(() => ({}));

    const policyResponse = await fetch("/api/integrations/catalog/policies", { cache: "no-store" });
    const policyPayload = await policyResponse.json().catch(() => ({}));

    const saveResponse = await fetch("/api/integrations/catalog/policies", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ policy: policyPayload.policy }),
    });
    const saved = await saveResponse.json().catch(() => ({}));

    return {
      settingsStatus: settingsResponse.status,
      settingsSource: settings.source,
      policyStatus: policyResponse.status,
      saveStatus: saveResponse.status,
      savedSource: saved.source,
      browserMarker: window.sessionStorage.getItem("xyops-admin-token"),
    };
  });

  expect(result.settingsStatus).toBe(200);
  expect(["database", "environment"]).toContain(result.settingsSource);
  expect(result.policyStatus).toBe(200);
  expect(result.saveStatus).toBe(200);
  expect(result.savedSource).toBe("database");
  expect(result.browserMarker).toBe("__local_admin_session__");
});
