import { expect, test } from "@playwright/test";

const adminUsername = String(process.env.E2E_ADMIN_USERNAME || "").trim();
const adminPassword = String(process.env.E2E_ADMIN_PASSWORD || "");

if (!adminUsername || !adminPassword) {
  throw new Error("E2E_ADMIN_USERNAME and E2E_ADMIN_PASSWORD are required");
}

async function login(page) {
  await page.goto("/login?next=/settings");
  await page.getByLabel("Логин").fill(adminUsername);
  await page.getByLabel("Пароль").fill(adminPassword);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe("/settings");
}

async function api(page, path, init = {}) {
  return page.evaluate(async ({ target, requestInit }) => {
    const response = await fetch(target, requestInit);
    return {
      status: response.status,
      data: await response.json().catch(() => ({})),
    };
  }, { target: path, requestInit: init });
}

async function createDraft(page, baseRevision, demoMode) {
  const response = await api(page, "/api/integrations/settings/drafts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ baseRevision, changes: { demoMode } }),
  });
  expect(response.status, JSON.stringify(response.data)).toBe(201);
  expect(response.data.draft.status).toBe("draft");
  expect(response.data.draft.baseRevision).toBe(baseRevision);
  expect(response.data.draft.diff).toEqual(expect.arrayContaining([
    expect.objectContaining({ field: "demoMode", after: demoMode, secret: false }),
  ]));
  return response.data.draft.id;
}

async function validateDraft(page, id) {
  return api(page, `/api/integrations/settings/drafts/${encodeURIComponent(id)}/validate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ services: [] }),
  });
}

async function applyDraft(page, id) {
  return api(page, `/api/integrations/settings/drafts/${encodeURIComponent(id)}/apply`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
}

test("admin validates and applies a revisioned settings draft without ADMIN_TOKEN", async ({ page }) => {
  await login(page);
  await expect(page.getByTestId("settings-lifecycle-wizard")).toBeVisible();
  await expect(page.getByTestId("settings-lifecycle-wizard")).toContainText("Черновик → проверка → применение");

  const initialHistory = await api(page, "/api/integrations/settings/revisions?limit=8");
  expect(initialHistory.status, JSON.stringify(initialHistory.data)).toBe(200);
  expect(Array.isArray(initialHistory.data.revisions)).toBe(true);

  const initial = await api(page, "/api/integrations/settings/effective");
  expect(initial.status, JSON.stringify(initial.data)).toBe(200);
  expect(initial.data.fields.demoMode).toEqual(expect.objectContaining({ envName: "DEMO_MODE" }));
  expect(initial.data.fields.ipaPassword).toEqual(expect.objectContaining({ configured: true, envName: "IPA_PASSWORD" }));
  expect(initial.data.fields.xyopsApiKey).toEqual(expect.objectContaining({ configured: true, envName: "XYOPS_API_KEY" }));

  const originalMode = Boolean(initial.data.settings.demoMode);
  const baseRevision = Number(initial.data.revision || 0);
  const changedMode = !originalMode;

  const draftId = await createDraft(page, baseRevision, changedMode);
  const staleDraftId = await createDraft(page, baseRevision, changedMode);

  const validation = await validateDraft(page, draftId);
  expect(validation.status, JSON.stringify(validation.data)).toBe(200);
  expect(validation.data.draft.status).toBe("validated");
  expect(validation.data.draft.validation).toEqual(expect.objectContaining({ ok: true, revision: baseRevision, services: [] }));

  const applied = await applyDraft(page, draftId);
  expect(applied.status, JSON.stringify(applied.data)).toBe(200);
  expect(applied.data.ok).toBe(true);
  expect(applied.data.settings.demoMode).toBe(changedMode);
  expect(applied.data.health).toEqual([]);

  const changed = await api(page, "/api/integrations/settings/effective");
  expect(changed.status, JSON.stringify(changed.data)).toBe(200);
  expect(changed.data.settings.demoMode).toBe(changedMode);
  expect(changed.data.revision).toBeGreaterThan(baseRevision);
  expect(changed.data.fields.demoMode).toEqual(expect.objectContaining({ source: "database", overridden: true }));

  const historyAfterApply = await api(page, "/api/integrations/settings/revisions?limit=8");
  expect(historyAfterApply.status, JSON.stringify(historyAfterApply.data)).toBe(200);
  expect(historyAfterApply.data.revisions).toEqual(expect.arrayContaining([
    expect.objectContaining({ revision: Number(changed.data.revision), reason: "apply", status: "active" }),
  ]));

  const conflict = await validateDraft(page, staleDraftId);
  expect(conflict.status, JSON.stringify(conflict.data)).toBe(409);
  expect(conflict.data.code).toBe("settings_revision_conflict");

  const restoreId = await createDraft(page, Number(changed.data.revision), originalMode);
  const restoreValidation = await validateDraft(page, restoreId);
  expect(restoreValidation.status, JSON.stringify(restoreValidation.data)).toBe(200);
  const restored = await applyDraft(page, restoreId);
  expect(restored.status, JSON.stringify(restored.data)).toBe(200);
  expect(restored.data.settings.demoMode).toBe(originalMode);

  const finalHistory = await api(page, "/api/integrations/settings/revisions?limit=8");
  expect(finalHistory.status, JSON.stringify(finalHistory.data)).toBe(200);
  expect(finalHistory.data.revisions.filter((revision) => revision.reason === "apply").length).toBeGreaterThanOrEqual(2);
});
