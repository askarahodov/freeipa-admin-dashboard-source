export const BACKUP_RESTORE_ACCEPTANCE_DOMAINS = Object.freeze([
  "settings",
  "local-auth",
  "rbac",
  "policies",
  "catalog",
  "operations",
  "approvals",
  "audit",
]);

function boundedPayload(response, expectedStatus, code) {
  if (!response || Number(response.status) !== expectedStatus) throw new Error(code);
  if (!response.json || typeof response.json !== "object" || Array.isArray(response.json)) {
    throw new Error(code);
  }
  return response.json;
}

function sameArray(left, right) {
  return Array.isArray(left)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function sessionSnapshot(payload) {
  if (payload?.authenticated !== true || payload?.user?.role !== "admin") {
    throw new Error("acceptance_backup_session_invalid");
  }
  const id = String(payload.user.id ?? "");
  const username = String(payload.user.username ?? "");
  if (!id || !username) throw new Error("acceptance_backup_session_invalid");
  return Object.freeze({ id, username, role: "admin" });
}

function settingsSnapshot(payload) {
  const revision = Number(payload?.revision);
  const demoMode = payload?.settings?.demoMode;
  const source = payload?.fields?.demoMode?.source;
  if (!Number.isInteger(revision) || revision < 0 || typeof demoMode !== "boolean") {
    throw new Error("acceptance_backup_settings_invalid");
  }
  if (!["database", "environment", "default"].includes(source)) {
    throw new Error("acceptance_backup_settings_invalid");
  }
  return Object.freeze({ revision, demoMode, source });
}

async function readProductionSnapshot(request) {
  const [sessionResponse, settingsResponse] = await Promise.all([
    request("/api/auth/session", { method: "GET" }),
    request("/api/integrations/settings/effective", { method: "GET" }),
  ]);
  return Object.freeze({
    session: sessionSnapshot(
      boundedPayload(sessionResponse, 200, "acceptance_backup_session_read_failed"),
    ),
    settings: settingsSnapshot(
      boundedPayload(settingsResponse, 200, "acceptance_backup_settings_read_failed"),
    ),
  });
}

function validateEncryptedDocument(document) {
  if (
    document?.manifest?.format !== "freeipa-admin-dashboard-backup"
    || document?.manifest?.version !== 1
    || document?.manifest?.mode !== "encrypted"
    || !sameArray(document?.manifest?.domains, BACKUP_RESTORE_ACCEPTANCE_DOMAINS)
    || !Array.isArray(document?.manifest?.entries)
    || document.manifest.entries.length !== BACKUP_RESTORE_ACCEPTANCE_DOMAINS.length
    || document?.manifest?.encryption?.algorithm !== "AES-256-GCM"
    || document?.manifest?.encryption?.kdf !== "PBKDF2-SHA-256"
    || !Number.isInteger(document?.manifest?.encryption?.iterations)
    || document.manifest.encryption.iterations < 210_000
    || !Number.isInteger(document?.summary?.entries)
    || document.summary.entries !== BACKUP_RESTORE_ACCEPTANCE_DOMAINS.length
    || !Number.isInteger(document?.summary?.records)
    || document.summary.records < 0
    || !Number.isInteger(document?.summary?.bytes)
    || document.summary.bytes < 0
  ) {
    throw new Error("acceptance_backup_export_invalid");
  }
  for (const domain of BACKUP_RESTORE_ACCEPTANCE_DOMAINS) {
    const entry = document.manifest.entries.find((item) => item?.domain === domain);
    if (!entry || entry.path !== `domains/${domain}.json` || !Number.isInteger(entry.records) || entry.records < 0) {
      throw new Error("acceptance_backup_export_invalid");
    }
  }
}

function validatePreview(payload) {
  if (
    payload?.canRestore !== true
    || !sameArray(payload?.selectedDomains, BACKUP_RESTORE_ACCEPTANCE_DOMAINS)
    || !Array.isArray(payload?.requiredMigrations)
    || payload.requiredMigrations.length !== 0
    || Number(payload?.summary?.conflict ?? -1) !== 0
    || !sameArray(payload?.restorePlan?.selectedDomains, BACKUP_RESTORE_ACCEPTANCE_DOMAINS)
    || !/^[0-9a-f]{64}$/u.test(String(payload?.restorePlan?.approvalToken ?? ""))
  ) {
    throw new Error("acceptance_backup_preview_invalid");
  }
  return String(payload.restorePlan.approvalToken);
}

function verificationByDomain(payload) {
  if (!Array.isArray(payload?.domains)) throw new Error("acceptance_backup_test_restore_invalid");
  return new Map(payload.domains.map((item) => [item?.domain, item]));
}

function requireCheck(map, domain, check) {
  const item = map.get(domain);
  if (!item || !Array.isArray(item.checks) || !item.checks.includes(check)) {
    throw new Error("acceptance_backup_test_restore_invalid");
  }
}

function validateTestRestore(payload) {
  if (
    payload?.tested !== true
    || payload?.productionMutated !== false
    || payload?.canCommit !== true
    || !sameArray(payload?.selectedDomains, BACKUP_RESTORE_ACCEPTANCE_DOMAINS)
    || !Number.isInteger(payload?.sourceSchemaVersion)
    || payload.sourceSchemaVersion < 1
    || !Number.isInteger(payload?.currentSchemaVersion)
    || payload.currentSchemaVersion < payload.sourceSchemaVersion
    || !Number.isInteger(payload?.summary?.tables)
    || payload.summary.tables < BACKUP_RESTORE_ACCEPTANCE_DOMAINS.length
    || !Number.isInteger(payload?.summary?.checks)
    || payload.summary.checks < BACKUP_RESTORE_ACCEPTANCE_DOMAINS.length
    || Number(payload?.summary?.warnings ?? -1) !== 0
  ) {
    throw new Error("acceptance_backup_test_restore_invalid");
  }

  const domains = verificationByDomain(payload);
  if (domains.size !== BACKUP_RESTORE_ACCEPTANCE_DOMAINS.length) {
    throw new Error("acceptance_backup_test_restore_invalid");
  }
  requireCheck(domains, "settings", "settings-consistency");
  requireCheck(domains, "local-auth", "local-auth-integrity");
  requireCheck(domains, "rbac", "rbac-consistency");
  requireCheck(domains, "operations", "operation-references");
  requireCheck(domains, "approvals", "approval-references");
  requireCheck(domains, "audit", "json-fields");
}

function assertProductionUnchanged(before, after) {
  if (
    before.session.id !== after.session.id
    || before.session.username !== after.session.username
    || before.session.role !== after.session.role
    || before.settings.revision !== after.settings.revision
    || before.settings.demoMode !== after.settings.demoMode
    || before.settings.source !== after.settings.source
  ) {
    throw new Error("acceptance_backup_production_state_changed");
  }
}

export async function executeBackupRestoreAcceptance({ request, password } = {}) {
  if (typeof request !== "function") throw new Error("acceptance_backup_request_invalid");
  if (typeof password !== "string" || password.length < 16) {
    throw new Error("acceptance_backup_password_invalid");
  }

  const before = await readProductionSnapshot(request);

  const exportResponse = await request("/api/admin/backups/export/encrypted", {
    method: "POST",
    body: {
      domains: BACKUP_RESTORE_ACCEPTANCE_DOMAINS,
      password,
    },
  });
  const document = boundedPayload(
    exportResponse,
    200,
    "acceptance_backup_export_failed",
  );
  validateEncryptedDocument(document);

  const previewResponse = await request("/api/admin/backups/import/encrypted/preview", {
    method: "POST",
    body: {
      document,
      password,
      domains: BACKUP_RESTORE_ACCEPTANCE_DOMAINS,
    },
  });
  const preview = boundedPayload(
    previewResponse,
    200,
    "acceptance_backup_preview_failed",
  );
  const approvalToken = validatePreview(preview);

  const restoreResponse = await request("/api/admin/backups/import/encrypted/test-restore", {
    method: "POST",
    body: {
      document,
      password,
      domains: BACKUP_RESTORE_ACCEPTANCE_DOMAINS,
      approvalToken,
    },
  });
  const restored = boundedPayload(
    restoreResponse,
    200,
    "acceptance_backup_test_restore_failed",
  );
  validateTestRestore(restored);

  const after = await readProductionSnapshot(request);
  assertProductionUnchanged(before, after);

  return Object.freeze({
    outcome: "passed",
    backup: "encrypted_verified",
    preview: "verified",
    isolatedRestore: "verified",
    productionState: "unchanged",
  });
}
