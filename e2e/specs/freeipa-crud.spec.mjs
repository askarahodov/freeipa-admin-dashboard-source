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
  await expect(page).toHaveURL(new RegExp(`${next.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
}

async function submitFreeIpaModal(page, values, destructive = false) {
  const modal = page.locator(".dynamic-modal");
  await expect(modal).toBeVisible();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);

  for (const [name, value] of Object.entries(values)) {
    const field = modal.locator(`[name="${name}"]`);
    await expect(field).toHaveCount(1);
    const tagName = await field.evaluate((element) => element.tagName.toLowerCase());
    if (tagName === "select") await field.selectOption(String(value));
    else await field.fill(String(value));
  }

  if (destructive) {
    const checkbox = modal.locator(".danger-confirm input[type=checkbox]");
    await expect(checkbox).toBeVisible();
    await checkbox.check();
  }

  const submit = modal.getByRole("button", { name: "Применить в FreeIPA" });
  await expect(submit).toBeEnabled();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await submit.click();
  await expect(modal).toHaveCount(0);
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
}

async function cleanup(page, operation, payload) {
  await page.request.post("/api/integrations/freeipa/actions", {
    data: { operation, ...payload },
  }).catch(() => {});
}

test("FreeIPA user, group and membership CRUD works through the browser", async ({ page }) => {
  test.setTimeout(120_000);

  const suffix = Date.now().toString(36);
  const uid = `e2ecrud${suffix}`;
  const group = `e2egrp${suffix}`;
  const initialEmail = `${uid}@example.test`;
  const updatedEmail = `${uid}.updated@example.test`;

  await login(page, "/users");
  const userBrowser = page.getByRole("region", { name: "Пользователи FreeIPA" });
  const createUserButton = page.getByRole("button", { name: /Создать пользователя/ });
  await expect(userBrowser).toBeVisible();
  await expect(createUserButton).toBeEnabled();

  try {
    await createUserButton.click();
    await submitFreeIpaModal(page, {
      username: uid,
      firstName: "E2E",
      lastName: "CRUD",
      email: initialEmail,
      password: "FreeIPA-E2E-Password-2026",
    });

    const userRow = userBrowser.getByRole("row").filter({ hasText: uid });
    await expect(userRow).toBeVisible();
    await expect(userRow).toContainText("E2E CRUD");
    await expect(userRow).toContainText(initialEmail);
    await expect(userRow).toContainText("Активен");

    await userRow.getByRole("button", { name: "Редактировать" }).click();
    await submitFreeIpaModal(page, {
      firstName: "Updated",
      lastName: "User",
      email: updatedEmail,
    });
    await expect(userRow).toContainText("Updated User");
    await expect(userRow).toContainText(updatedEmail);

    await page.getByRole("button", { name: /Группы$/ }).click();
    await expect(page).toHaveURL(/\/groups$/);
    await page.getByRole("button", { name: /Создать группу/ }).click();
    await submitFreeIpaModal(page, { group, description: "Playwright stateful FreeIPA group" });

    const groupBrowser = page.getByRole("region", { name: "Группы доступа" });
    const groupRow = groupBrowser.getByRole("row").filter({ hasText: group });
    await expect(groupRow).toBeVisible();
    await expect(groupRow).toContainText("0");

    await groupRow.getByRole("button", { name: "Добавить участника" }).click();
    await submitFreeIpaModal(page, { username: uid });
    await expect(groupRow).toContainText("1");

    await groupRow.getByRole("button", { name: "Открыть группу" }).click();
    const groupModal = page.locator(".identity-modal").filter({ hasText: group });
    await expect(groupModal).toBeVisible();
    const memberBrowser = groupModal.locator("#freeipa-group-member-browser");
    await expect(memberBrowser).toBeVisible();
    await expect(memberBrowser.getByText(uid, { exact: true })).toBeVisible();
    await expect(memberBrowser.getByText("Updated User", { exact: true })).toBeVisible();
    await expect(memberBrowser.getByText(updatedEmail, { exact: true })).toBeVisible();

    await memberBrowser.getByRole("button", { name: "Удалить", exact: true }).click();
    await submitFreeIpaModal(page, {}, true);
    await expect(memberBrowser.getByText(uid, { exact: true })).toHaveCount(0);
    await groupModal.getByRole("button", { name: "Закрыть" }).click();

    await page.getByRole("button", { name: /Пользователи$/ }).click();
    await expect(page).toHaveURL(/\/users$/);
    await expect(userRow).toBeVisible();
    await userRow.getByRole("button", { name: "Карточка" }).click();

    let userModal = page.locator(".identity-modal").filter({ hasText: uid });
    await expect(userModal).toBeVisible();
    await userModal.getByRole("button", { name: "Отключить" }).click();
    await submitFreeIpaModal(page, {}, true);
    await expect(userRow).toContainText("Отключён");

    userModal = page.locator(".identity-modal").filter({ hasText: uid });
    await expect(userModal).toBeVisible();
    await userModal.getByRole("button", { name: "Включить" }).click();
    await submitFreeIpaModal(page, {});
    await expect(userRow).toContainText("Активен");

    userModal = page.locator(".identity-modal").filter({ hasText: uid });
    await expect(userModal).toBeVisible();
    await userModal.getByRole("button", { name: "Удалить", exact: true }).click();
    await submitFreeIpaModal(page, {}, true);
    await expect(userRow).toHaveCount(0);

    await page.getByRole("button", { name: /Группы$/ }).click();
    await expect(groupRow).toBeVisible();
    await groupRow.getByRole("button", { name: "Открыть группу" }).click();
    const deleteGroupModal = page.locator(".identity-modal").filter({ hasText: group });
    await expect(deleteGroupModal).toBeVisible();
    await deleteGroupModal.getByRole("button", { name: "Удалить группу" }).click();
    await submitFreeIpaModal(page, {}, true);
    await expect(groupRow).toHaveCount(0);
  } finally {
    await cleanup(page, "user_del", { username: uid });
    await cleanup(page, "group_del", { group });
  }
});
