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

async function createPortalUser(page, username, role, password) {
  const response = await page.request.post("/api/auth/users", {
    headers: { origin: baseURL },
    data: {
      username,
      displayName: `E2E ${role}`,
      password,
      role,
    },
  });
  expect(response.status()).toBe(201);
  const payload = await response.json();
  expect(payload.user?.id).toBeTruthy();
  return payload.user;
}

async function verifyDeniedAdminAccess(context, page) {
  const usersResponse = await context.request.get("/api/auth/users");
  expect(usersResponse.status()).toBe(403);

  const accessResponse = await page.goto("/access");
  expect(accessResponse?.status()).toBe(403);
  await expect(page.getByText("Недостаточно прав")).toBeVisible();
}

test("viewer, operator and admin receive different effective permissions", async ({ page, browser }, testInfo) => {
  const suffix = `${Date.now().toString(36)}-${testInfo.retry}`;
  const viewerUsername = `e2e-viewer-${suffix}`;
  const operatorUsername = `e2e-operator-${suffix}`;
  const viewerPassword = `Viewer-${Date.now()}-Aa1`;
  const operatorPassword = `Operator-${Date.now()}-Aa1`;
  const demoGroup = `e2e-role-${suffix}`;
  const createdUsers = [];

  await login(page, adminUsername, adminPassword);

  try {
    createdUsers.push(await createPortalUser(page, viewerUsername, "viewer", viewerPassword));
    createdUsers.push(await createPortalUser(page, operatorUsername, "operator", operatorPassword));

    const viewerContext = await browser.newContext({ baseURL });
    try {
      const viewerPage = await viewerContext.newPage();
      await login(viewerPage, viewerUsername, viewerPassword);
      await expect(viewerPage.locator(".local-auth-toolbar")).toContainText("Наблюдатель");
      await expect(viewerPage.locator(".local-auth-toolbar").getByRole("link", { name: "Доступ" })).toHaveCount(0);

      const mutation = await viewerContext.request.post("/api/integrations/freeipa/actions", {
        data: { operation: "group_add", group: demoGroup, description: "Viewer must be denied" },
      });
      expect(mutation.status()).toBe(403);
      await verifyDeniedAdminAccess(viewerContext, viewerPage);
    } finally {
      await viewerContext.close();
    }

    const operatorContext = await browser.newContext({ baseURL });
    try {
      const operatorPage = await operatorContext.newPage();
      await login(operatorPage, operatorUsername, operatorPassword);
      await expect(operatorPage.locator(".local-auth-toolbar")).toContainText("Оператор");
      await expect(operatorPage.locator(".local-auth-toolbar").getByRole("link", { name: "Доступ" })).toHaveCount(0);

      const mutation = await operatorContext.request.post("/api/integrations/freeipa/actions", {
        data: { operation: "group_add", group: demoGroup, description: "Operator mutation check" },
      });
      expect(mutation.ok()).toBeTruthy();
      await verifyDeniedAdminAccess(operatorContext, operatorPage);
    } finally {
      await operatorContext.close();
    }

    await expect(page.locator(".local-auth-toolbar")).toContainText("Администратор");
    await expect(page.locator(".local-auth-toolbar").getByRole("link", { name: "Доступ" })).toBeVisible();
    expect((await page.request.get("/api/auth/users")).status()).toBe(200);
    expect((await page.goto("/access"))?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Управление доступом" })).toBeVisible();
  } finally {
    await page.request.post("/api/integrations/freeipa/actions", {
      data: { operation: "group_del", group: demoGroup },
    }).catch(() => {});
    for (const user of createdUsers.reverse()) {
      await page.request.delete(`/api/auth/users/${encodeURIComponent(user.id)}`, {
        headers: { origin: baseURL },
      }).catch(() => {});
    }
  }
});
