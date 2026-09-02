import { PORTAL_BACKUP_DOMAINS, type PortalBackupDomain } from "./backup-manifest.ts";
import { BackupExportError, type BackupExportEnv, type PortalBackupDomainExporter } from "./src/backup/export/backup-export.ts";

type JsonRecord = Record<string, unknown>;

function requireDb(env: BackupExportEnv): NonNullable<BackupExportEnv["DB"]> {
  if (!env.DB) throw new BackupExportError("backup_database_unavailable", 503, "Backup database is unavailable");
  return env.DB;
}

function parseJson(value: unknown, fallback: unknown): unknown {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

async function selectRows(env: BackupExportEnv, sql: string): Promise<JsonRecord[]> {
  try {
    const result = await requireDb(env).prepare(sql).all<JsonRecord>();
    return Array.isArray(result.results) ? result.results : [];
  } catch (error) {
    if (error instanceof BackupExportError) throw error;
    throw new BackupExportError("backup_schema_incompatible", 409, "Backup schema is incompatible");
  }
}

function exporter(
  domain: PortalBackupDomain,
  load: (env: BackupExportEnv) => Promise<JsonRecord[]>,
): PortalBackupDomainExporter {
  return {
    domain,
    path: `domains/${domain}.json`,
    async export(env) {
      const records = await load(env);
      return { payload: { records }, records: records.length };
    },
  };
}

const settingsExporter = exporter("settings", async (env) => {
  const rows = await selectRows(env, "SELECT id, config_json, updated_at FROM app_settings ORDER BY id");
  return rows.map((row) => ({ id: row.id, config: parseJson(row.config_json, {}), updated_at: row.updated_at }));
});

const localAuthExporter = exporter("local-auth", async (env) => {
  return selectRows(env, "SELECT id, username, display_name, role, disabled, created_at, updated_at, last_login_at FROM portal_users ORDER BY username, id");
});

const rbacExporter = exporter("rbac", async (env) => {
  const rows = await selectRows(env, "SELECT id, username, role, disabled, updated_at FROM portal_users ORDER BY role, username, id");
  return rows.map((row) => ({ identity_id: row.id, username: row.username, role: row.role, disabled: row.disabled, updated_at: row.updated_at }));
});

const policiesExporter = exporter("policies", async (env) => {
  const visibility = await selectRows(env, "SELECT id, policy_json, updated_at FROM catalog_visibility_policies ORDER BY id");
  const approvals = await selectRows(env, "SELECT id, policy_json, updated_at FROM approval_policy_sets ORDER BY id");
  const presentation = await selectRows(env, "SELECT id, metadata_json, updated_at FROM process_presentation_sets ORDER BY id");
  return [
    ...visibility.map((row) => ({ type: "catalog-visibility", id: row.id, document: parseJson(row.policy_json, {}), updated_at: row.updated_at })),
    ...approvals.map((row) => ({ type: "approval", id: row.id, document: parseJson(row.policy_json, {}), updated_at: row.updated_at })),
    ...presentation.map((row) => ({ type: "process-presentation", id: row.id, document: parseJson(row.metadata_json, {}), updated_at: row.updated_at })),
  ];
});

const catalogExporter = exporter("catalog", async (env) => {
  const snapshots = await selectRows(env, "SELECT id, catalog_json, synced_at FROM xyops_catalog_snapshot ORDER BY synced_at, id");
  const history = await selectRows(env, "SELECT id, synced_at, changes_json, catalog_json FROM xyops_catalog_history ORDER BY synced_at, id");
  return [
    ...snapshots.map((row) => ({ type: "snapshot", id: row.id, catalog: parseJson(row.catalog_json, {}), synced_at: row.synced_at })),
    ...history.map((row) => ({ type: "history", id: row.id, changes: parseJson(row.changes_json, {}), catalog: parseJson(row.catalog_json, {}), synced_at: row.synced_at })),
  ];
});

const operationsExporter = exporter("operations", async (env) => {
  const runs = await selectRows(env, "SELECT id, job_id, event_id, title, kind, mode, status, actor, subject, stages_json, started_at, updated_at, completed_at FROM operation_runs ORDER BY started_at, id");
  const results = await selectRows(env, "SELECT run_id, job_id, summary, truncated, captured_at FROM operation_run_results ORDER BY captured_at, run_id");
  return [
    ...runs.map((row) => ({ type: "run", ...row, stages: parseJson(row.stages_json, []) , stages_json: undefined })).map(({ stages_json: _ignored, ...row }) => row),
    ...results.map((row) => ({ type: "result", ...row })),
  ];
});

const approvalsExporter = exporter("approvals", async (env) => {
  const approvals = await selectRows(env, "SELECT id, event_id, title, category, schema_version, requester_identity, requester_role, requester_groups_json, status, required_approvals, approver_roles_json, approver_groups_json, requester_cannot_approve, rule_id, summary_json, expires_at, created_at, updated_at, approved_at, executed_at, run_id, parent_run_id FROM operation_approvals ORDER BY created_at, id");
  const decisions = await selectRows(env, "SELECT approval_id, approver_identity, approver_role, decision, decided_at FROM operation_approval_decisions ORDER BY decided_at, approval_id, approver_identity");
  return [
    ...approvals.map((row) => ({
      type: "approval",
      ...row,
      requester_groups: parseJson(row.requester_groups_json, []),
      approver_roles: parseJson(row.approver_roles_json, []),
      approver_groups: parseJson(row.approver_groups_json, []),
      summary: parseJson(row.summary_json, {}),
      requester_groups_json: undefined,
      approver_roles_json: undefined,
      approver_groups_json: undefined,
      summary_json: undefined,
    })).map(({ requester_groups_json: _a, approver_roles_json: _b, approver_groups_json: _c, summary_json: _d, ...row }) => row),
    ...decisions.map((row) => ({ type: "decision", ...row })),
  ];
});

const auditExporter = exporter("audit", async (env) => {
  const rows = await selectRows(env, "SELECT id, created_at, correlation_id, actor_identity, actor_role, actor_groups_json, action, resource_type, resource_id, event_id, schema_version, approval_id, run_id, job_id, outcome, error_code, metadata_json FROM portal_audit_events ORDER BY created_at, id");
  return rows.map((row) => ({
    ...row,
    actor_groups: parseJson(row.actor_groups_json, []),
    metadata: parseJson(row.metadata_json, {}),
    actor_groups_json: undefined,
    metadata_json: undefined,
  })).map(({ actor_groups_json: _groups, metadata_json: _metadata, ...row }) => row);
});

const exporters = [
  settingsExporter,
  localAuthExporter,
  rbacExporter,
  policiesExporter,
  catalogExporter,
  operationsExporter,
  approvalsExporter,
  auditExporter,
] as const;

if (exporters.length !== PORTAL_BACKUP_DOMAINS.length || exporters.some((item, index) => item.domain !== PORTAL_BACKUP_DOMAINS[index])) {
  throw new Error("Sanitized backup exporter registry is not exhaustive or canonical");
}

export const SANITIZED_BACKUP_EXPORTERS: ReadonlyMap<PortalBackupDomain, PortalBackupDomainExporter> = new Map(
  exporters.map((item) => [item.domain, item]),
);
