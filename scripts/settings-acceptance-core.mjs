function responseCode(status, expected, code) {
  if (status !== expected) throw new Error(code);
}

function effectiveSnapshot(payload) {
  const revision = Number(payload?.revision ?? 0);
  const demoMode = payload?.settings?.demoMode;
  const source = payload?.fields?.demoMode?.source;
  if (!Number.isFinite(revision) || revision < 0 || typeof demoMode !== "boolean") {
    throw new Error("acceptance_settings_effective_invalid");
  }
  if (!["database", "environment", "default"].includes(source)) {
    throw new Error("acceptance_settings_effective_invalid");
  }
  return Object.freeze({ revision, demoMode, source });
}

async function createValidatedDraft(request, baseRevision, changes) {
  const created = await request("/api/integrations/settings/drafts", {
    method: "POST",
    body: { baseRevision, changes },
  });
  responseCode(created.status, 201, "acceptance_settings_draft_create_failed");
  const draftId = String(created.json?.draft?.id ?? "");
  if (!draftId) throw new Error("acceptance_settings_draft_create_failed");

  const validated = await request(
    `/api/integrations/settings/drafts/${encodeURIComponent(draftId)}/validate`,
    { method: "POST", body: { services: [] } },
  );
  responseCode(validated.status, 200, "acceptance_settings_draft_validate_failed");
  if (validated.json?.draft?.status !== "validated") {
    throw new Error("acceptance_settings_draft_validate_failed");
  }
  return draftId;
}

async function applyDraft(request, draftId) {
  const applied = await request(
    `/api/integrations/settings/drafts/${encodeURIComponent(draftId)}/apply`,
    { method: "POST", body: {} },
  );
  responseCode(applied.status, 200, "acceptance_settings_apply_failed");
  if (applied.json?.ok !== true) throw new Error("acceptance_settings_apply_failed");
}

async function readEffective(request) {
  const effective = await request("/api/integrations/settings/effective", { method: "GET" });
  responseCode(effective.status, 200, "acceptance_settings_effective_failed");
  return effectiveSnapshot(effective.json);
}

export async function executeSettingsPersistenceRollback({ request } = {}) {
  if (typeof request !== "function") throw new Error("acceptance_settings_request_invalid");

  const initial = await readEffective(request);
  const changedMode = !initial.demoMode;
  let mutationApplied = false;
  let rollbackComplete = false;
  let primaryError = null;

  try {
    const draftId = await createValidatedDraft(request, initial.revision, { demoMode: changedMode });
    await applyDraft(request, draftId);
    mutationApplied = true;

    const persisted = await readEffective(request);
    if (
      persisted.demoMode !== changedMode
      || persisted.source !== "database"
      || persisted.revision <= initial.revision
    ) {
      throw new Error("acceptance_settings_persistence_failed");
    }
  } catch (error) {
    primaryError = error;
  } finally {
    if (mutationApplied) {
      try {
        const current = await readEffective(request);
        const rollbackChanges = initial.source === "database"
          ? { demoMode: initial.demoMode }
          : { resetFields: ["demoMode"] };
        const rollbackDraftId = await createValidatedDraft(request, current.revision, rollbackChanges);
        await applyDraft(request, rollbackDraftId);
        const restored = await readEffective(request);
        if (restored.demoMode !== initial.demoMode || restored.source !== initial.source) {
          throw new Error("acceptance_settings_rollback_failed");
        }
        rollbackComplete = true;
      } catch {
        throw new Error("acceptance_settings_rollback_failed");
      }
    }
  }

  if (primaryError) throw primaryError;
  if (mutationApplied && !rollbackComplete) throw new Error("acceptance_settings_rollback_failed");

  return Object.freeze({
    outcome: "passed",
    mutation: "demo_mode_toggle",
    persistence: "verified",
    rollback: "verified",
  });
}
