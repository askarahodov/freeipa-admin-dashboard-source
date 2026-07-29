import { expect, test } from "@playwright/test";

const adminUsername = String(process.env.E2E_ADMIN_USERNAME || "").trim();
const adminPassword = String(process.env.E2E_ADMIN_PASSWORD || "");
const xyopsMockBaseURL = (() => {
  const raw = String(process.env.XYOPS_URL || "").trim();
  if (!raw) throw new Error("XYOPS_URL is required for the settings rollback E2E scenario");
  const url = new URL(raw);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password) {
    throw new Error("XYOPS_URL must point to the isolated HTTP mock on 127.0.0.1");
  }
  return url.href.replace(/\/+$/, "");
})();

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

async function createDraft(page, baseRevision, changes) {
  const response = await api(page, "/api/integrations/settings/drafts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ baseRevision, changes }),
  });
  expect(response.status, JSON.stringify(response.data)).toBe(201);
  expect(response.data.draft.status).toBe("draft");
  expect(response.data.draft.baseRevision).toBe(baseRevision);
  return response.data.draft;
}

async function validateDraft(page, id, services) {
  return api(page, `/api/integrations/settings/drafts/${encodeURIComponent(id)}/validate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(services === undefined ? {} : { services }),
  });
}

async function applyDraft(page, id) {
  return api(page, `/api/integrations/settings/drafts/${encodeURIComponent(id)}/apply`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
}

async function setCatalogFailure(page, enabled) {
  const response = await page.request.post(`${xyopsMockBaseURL}/__mock/catalog-failure`, { data: { enabled } });
  const payload = await response.json().catch(() => ({}));
  expect(response.status(), JSON.stringify(payload)).toBe(200);
  expect(payload.catalogFailure).toBe(enabled);
}

test("admin applies, resets D1 overrides to ENV and automatically rolls back revisioned settings", async ({ page }) => {
  await login(page);
  await expect(page.getByTestId("settings-lifecycle-wizard")).toBeVisible();
  await expect(page.getByTestId("settings-lifecycle-wizard")).toContainText("Черновик → проверка → применение");
  await expect(page.getByTestId("settings-source-filter")).toContainText("D1 overrides");

  const initialHistory = await api(page, "/api/integrations/settings/revisions?limit=12");
  expect(initialHistory.status, JSON.stringify(initialHistory.data)).toBe(200);
  expect(Array.isArray(initialHistory.data.revisions)).toBe(true);

  const initial = await api(page, "/api/integrations/settings/effective");
  expect(initial.status, JSON.stringify(initial.data)).toBe(200);
  expect(initial.data.fields.demoMode).toEqual(expect.objectContaining({ envName: "DEMO_MODE", source: "environment", resettable: false }));
  expect(initial.data.fields.ipaPassword).toEqual(expect.objectContaining({ configured: true, envName: "IPA_PASSWORD", source: "environment" }));
  expect(initial.data.fields.xyopsApiKey).toEqual(expect.objectContaining({ configured: true, envName: "XYOPS_API_KEY", source: "environment" }));
  expect(initial.data.overrideCount).toBe(0);

  const originalMode = Boolean(initial.data.settings.demoMode);
  const baseRevision = Number(initial.data.revision || 0);
  const changedMode = !originalMode;

  const draft = await createDraft(page, baseRevision, { demoMode: changedMode });
  const staleDraft = await createDraft(page, baseRevision, { demoMode: changedMode });

  const validation = await validateDraft(page, draft.id, []);
  expect(validation.status, JSON.stringify(validation.data)).toBe(200);
  expect(validation.data.draft.status).toBe("validated");
  expect(validation.data.draft.validation).toEqual(expect.objectContaining({ ok: true, revision: baseRevision, services: [] }));

  const applied = await applyDraft(page, draft.id);
  expect(applied.status, JSON.stringify(applied.data)).toBe(200);
  expect(applied.data.ok).toBe(true);
  expect(applied.data.settings.demoMode).toBe(changedMode);
  expect(applied.data.health).toEqual([]);

  const changed = await api(page, "/api/integrations/settings/effective");
  expect(changed.status, JSON.stringify(changed.data)).toBe(200);
  expect(changed.data.settings.demoMode).toBe(changedMode);
  expect(changed.data.revision).toBeGreaterThan(baseRevision);
  expect(changed.data.overrideCount).toBe(1);
  expect(changed.data.conflictCount).toBe(1);
  expect(changed.data.fields.demoMode).toEqual(expect.objectContaining({
    source: "database",
    overridden: true,
    resettable: true,
    fallbackSource: "environment",
  }));

  const historyAfterApply = await api(page, "/api/integrations/settings/revisions?limit=12");
  expect(historyAfterApply.status, JSON.stringify(historyAfterApply.data)).toBe(200);
  expect(historyAfterApply.data.revisions).toEqual(expect.arrayContaining([
    expect.objectContaining({ revision: Number(changed.data.revision), reason: "apply", status: "active" }),
  ]));

  const conflict = await validateDraft(page, staleDraft.id, []);
  expect(conflict.status, JSON.stringify(conflict.data)).toBe(409);
  expect(conflict.data.code).toBe("settings_revision_conflict");

  const resetDraft = await createDraft(page, Number(changed.data.revision), { resetFields: ["demoMode"] });
  expect(resetDraft.diff).toEqual([
    expect.objectContaining({ field: "demoMode", reset: true, source: "environment", after: originalMode }),
  ]);

  const resetValidation = await validateDraft(page, resetDraft.id);
  expect(resetValidation.status, JSON.stringify(resetValidation.data)).toBe(200);
  expect(resetValidation.data.draft.validation.services).toEqual(expect.arrayContaining([
    expect.objectContaining({ service: "freeipa", ok: true }),
    expect.objectContaining({ service: "xyops", ok: true }),
  ]));

  const resetApplied = await applyDraft(page, resetDraft.id);
  expect(resetApplied.status, JSON.stringify(resetApplied.data)).toBe(200);
  expect(resetApplied.data.settings.demoMode).toBe(originalMode);

  const inherited = await api(page, "/api/integrations/settings/effective");
  expect(inherited.status, JSON.stringify(inherited.data)).toBe(200);
  expect(inherited.data.settings.demoMode).toBe(originalMode);
  expect(inherited.data.overrideCount).toBe(0);
  expect(inherited.data.fields.demoMode).toEqual(expect.objectContaining({
    source: "environment",
    overridden: false,
    resettable: false,
  }));

  const repeatReset = await api(page, "/api/integrations/settings/drafts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ baseRevision: inherited.data.revision, changes: { resetFields: ["demoMode"] } }),
  });
  expect(repeatReset.status, JSON.stringify(repeatReset.data)).toBe(409);
  expect(repeatReset.data.code).toBe("settings_field_not_overridden");

  const stableRevision = Number(inherited.data.revision);
  const stableXyopsUrl = String(inherited.data.settings.xyops.url);
  expect(stableXyopsUrl).toBe(xyopsMockBaseURL);

  const rollbackDraft = await createDraft(page, stableRevision, { xyopsUrl: stableXyopsUrl });
  const rollbackValidation = await validateDraft(page, rollbackDraft.id);
  expect(rollbackValidation.status, JSON.stringify(rollbackValidation.data)).toBe(200);
  expect(rollbackValidation.data.draft.validation.services).toEqual([
    expect.objectContaining({ service: "xyops", ok: true }),
  ]);

  await setCatalogFailure(page, true);
  try {
    const rolledBack = await applyDraft(page, rollbackDraft.id);
    expect(rolledBack.status, JSON.stringify(rolledBack.data)).toBe(502);
    expect(rolledBack.data).toEqual(expect.objectContaining({
      rolledBack: true,
      code: "settings_post_apply_health_failed",
      restoredSource: "database",
    }));
    expect(rolledBack.data.health).toEqual([
      expect.objectContaining({ service: "xyops", ok: false }),
    ]);
  } finally {
    await setCatalogFailure(page, false);
  }

  const afterRollback = await api(page, "/api/integrations/settings/effective");
  expect(afterRollback.status, JSON.stringify(afterRollback.data)).toBe(200);
  expect(afterRollback.data.settings.xyops.url).toBe(stableXyopsUrl);
  expect(afterRollback.data.fields.xyopsUrl.source).toBe("environment");
  expect(Number(afterRollback.data.revision)).toBeGreaterThan(stableRevision);

  const finalHistory = await api(page, "/api/integrations/settings/revisions?limit=12");
  expect(finalHistory.status, JSON.stringify(finalHistory.data)).toBe(200);
  expect(finalHistory.data.revisions).toEqual(expect.arrayContaining([
    expect.objectContaining({ reason: "apply_health_failed", status: "failed" }),
    expect.objectContaining({ reason: "automatic_rollback", status: "active" }),
  ]));
  expect(finalHistory.data.revisions.filter((revision) => revision.reason === "apply").length).toBeGreaterThanOrEqual(2);
});
