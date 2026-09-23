import assert from "node:assert/strict";
import test from "node:test";

import { executeSettingsPersistenceRollback } from "../../scripts/settings-acceptance-core.mjs";

function fakeLifecycle({ initialSource = "environment", failAfterApply = false, rollbackMismatch = false } = {}) {
  let revision = 10;
  let demoMode = false;
  let source = initialSource;
  let appliedCount = 0;
  let nextDraft = 1;
  const drafts = new Map();
  const calls = [];

  const effective = () => ({
    revision,
    settings: { demoMode },
    fields: { demoMode: { source } },
  });

  const request = async (pathname, options = {}) => {
    calls.push({ pathname, method: options.method ?? "GET", body: options.body });

    if (pathname === "/api/integrations/settings/effective") {
      if (failAfterApply && appliedCount === 1) {
        failAfterApply = false;
        throw new Error("transient read failure");
      }
      return { status: 200, json: effective() };
    }

    if (pathname === "/api/integrations/settings/drafts" && options.method === "POST") {
      const id = `draft-${nextDraft++}`;
      drafts.set(id, { baseRevision: options.body.baseRevision, changes: options.body.changes });
      return { status: 201, json: { draft: { id, status: "draft" } } };
    }

    const validate = pathname.match(/^\/api\/integrations\/settings\/drafts\/([^/]+)\/validate$/u);
    if (validate && options.method === "POST") {
      const draft = drafts.get(decodeURIComponent(validate[1]));
      if (!draft) return { status: 404, json: {} };
      return { status: 200, json: { draft: { status: "validated" } } };
    }

    const apply = pathname.match(/^\/api\/integrations\/settings\/drafts\/([^/]+)\/apply$/u);
    if (apply && options.method === "POST") {
      const draft = drafts.get(decodeURIComponent(apply[1]));
      if (!draft || draft.baseRevision !== revision) return { status: 409, json: {} };
      if (Object.hasOwn(draft.changes, "demoMode")) {
        demoMode = Boolean(draft.changes.demoMode);
        source = "database";
      } else if (Array.isArray(draft.changes.resetFields) && draft.changes.resetFields.includes("demoMode")) {
        demoMode = false;
        source = rollbackMismatch ? "database" : initialSource;
      }
      revision += 1;
      appliedCount += 1;
      return { status: 200, json: { ok: true, settings: { demoMode } } };
    }

    return { status: 404, json: {} };
  };

  return { request, calls, state: () => ({ revision, demoMode, source, appliedCount }) };
}

test("settings acceptance toggles demoMode, verifies persistence, and restores ENV/default source", async () => {
  const fake = fakeLifecycle({ initialSource: "environment" });
  const result = await executeSettingsPersistenceRollback({ request: fake.request });

  assert.deepEqual(result, {
    outcome: "passed",
    mutation: "demo_mode_toggle",
    persistence: "verified",
    rollback: "verified",
  });
  assert.deepEqual(fake.state(), {
    revision: 12,
    demoMode: false,
    source: "environment",
    appliedCount: 2,
  });

  const validations = fake.calls.filter((call) => call.pathname.endsWith("/validate"));
  assert.equal(validations.length, 2);
  assert.deepEqual(validations.map((call) => call.body), [{ services: [] }, { services: [] }]);
});

test("settings acceptance restores an existing database override instead of resetting its source", async () => {
  const fake = fakeLifecycle({ initialSource: "database" });
  await executeSettingsPersistenceRollback({ request: fake.request });

  assert.deepEqual(fake.state(), {
    revision: 12,
    demoMode: false,
    source: "database",
    appliedCount: 2,
  });

  const draftBodies = fake.calls
    .filter((call) => call.pathname === "/api/integrations/settings/drafts")
    .map((call) => call.body.changes);
  assert.deepEqual(draftBodies, [
    { demoMode: true },
    { demoMode: false },
  ]);
});

test("settings acceptance rolls back even when the persistence read fails after apply", async () => {
  const fake = fakeLifecycle({ initialSource: "environment", failAfterApply: true });

  await assert.rejects(
    () => executeSettingsPersistenceRollback({ request: fake.request }),
    /transient read failure/u,
  );

  assert.deepEqual(fake.state(), {
    revision: 12,
    demoMode: false,
    source: "environment",
    appliedCount: 2,
  });
});

test("rollback mismatch is release-blocking with a bounded error code", async () => {
  const fake = fakeLifecycle({ initialSource: "environment", rollbackMismatch: true });

  await assert.rejects(
    () => executeSettingsPersistenceRollback({ request: fake.request }),
    /acceptance_settings_rollback_failed/u,
  );
  assert.equal(fake.state().appliedCount, 2);
});

test("invalid effective settings fail before any mutation", async () => {
  let mutations = 0;
  const request = async (pathname, options = {}) => {
    if (options.method === "POST") mutations += 1;
    if (pathname === "/api/integrations/settings/effective") {
      return { status: 200, json: { revision: 1, settings: {}, fields: {} } };
    }
    return { status: 500, json: {} };
  };

  await assert.rejects(
    () => executeSettingsPersistenceRollback({ request }),
    /acceptance_settings_effective_invalid/u,
  );
  assert.equal(mutations, 0);
});
