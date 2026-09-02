import { assertSanitizedBackupPayload, type PortalBackupDomain } from "../../../backup-manifest.ts";
import { validateFullBackupDomainPayload, type FullBackupDomainPayload, type FullBackupTable } from "../../../backup-full-domains.ts";

type JsonRecord = Record<string, unknown>;

function table(payload: FullBackupDomainPayload, name: string): FullBackupTable {
  const selected = payload.tables.find((item) => item.name === name);
  if (!selected) throw new Error("Full backup projection is unavailable");
  return selected;
}

function records(selected: FullBackupTable): JsonRecord[] {
  return selected.rows.map((row) => Object.fromEntries(selected.columns.map((column, index) => [column, row[index]])));
}

function parseJson(value: unknown, fallback: unknown): unknown {
  if (typeof value !== "string") return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function cleanUndefined(value: JsonRecord): JsonRecord {
  return Object.fromEntries(Object.entries(value).filter(([, child]) => typeof child !== "undefined"));
}

export function projectFullBackupDomain(domain: PortalBackupDomain, value: unknown): { records: JsonRecord[] } {
  const payload = validateFullBackupDomainPayload(domain, value);
  let projected: JsonRecord[];

  switch (domain) {
    case "settings":
      projected = records(table(payload, "app_settings")).map((row) => ({
        id: row.id,
        config: parseJson(row.config_json, {}),
        updated_at: row.updated_at,
      }));
      break;
    case "local-auth":
      projected = records(table(payload, "portal_users")).map((row) => ({
        id: row.id,
        username: row.username,
        display_name: row.display_name,
        role: row.role,
        disabled: row.disabled,
        created_at: row.created_at,
        updated_at: row.updated_at,
        last_login_at: row.last_login_at,
      }));
      break;
    case "rbac":
      projected = records(table(payload, "portal_role_assignments")).map((row) => ({
        identity_id: row.id,
        username: row.username,
        role: row.role,
        disabled: row.disabled,
        updated_at: row.updated_at,
      }));
      break;
    case "policies":
      projected = [
        ...records(table(payload, "catalog_visibility_policies")).map((row) => ({ type: "catalog-visibility", id: row.id, document: parseJson(row.policy_json, {}), updated_at: row.updated_at })),
        ...records(table(payload, "approval_policy_sets")).map((row) => ({ type: "approval", id: row.id, document: parseJson(row.policy_json, {}), updated_at: row.updated_at })),
        ...records(table(payload, "process_presentation_sets")).map((row) => ({ type: "process-presentation", id: row.id, document: parseJson(row.metadata_json, {}), updated_at: row.updated_at })),
      ];
      break;
    case "catalog":
      projected = [
        ...records(table(payload, "xyops_catalog_snapshot")).map((row) => ({ type: "snapshot", id: row.id, catalog: parseJson(row.catalog_json, {}), synced_at: row.synced_at })),
        ...records(table(payload, "xyops_catalog_history")).map((row) => ({ type: "history", id: row.id, changes: parseJson(row.changes_json, {}), catalog: parseJson(row.catalog_json, {}), synced_at: row.synced_at })),
      ];
      break;
    case "operations":
      projected = [
        ...records(table(payload, "operation_runs")).map((row) => ({
          type: "run",
          id: row.id,
          job_id: row.job_id,
          event_id: row.event_id,
          title: row.title,
          kind: row.kind,
          mode: row.mode,
          status: row.status,
          actor: row.actor,
          subject: row.subject,
          stages: parseJson(row.stages_json, []),
          started_at: row.started_at,
          updated_at: row.updated_at,
          completed_at: row.completed_at,
        })),
        ...records(table(payload, "operation_run_results")).map((row) => ({
          type: "result",
          run_id: row.run_id,
          job_id: row.job_id,
          summary: row.summary,
          truncated: row.truncated,
          captured_at: row.captured_at,
        })),
      ];
      break;
    case "approvals":
      projected = [
        ...records(table(payload, "operation_approvals")).map((row) => cleanUndefined({
          type: "approval",
          id: row.id,
          event_id: row.event_id,
          title: row.title,
          category: row.category,
          schema_version: row.schema_version,
          requester_identity: row.requester_identity,
          requester_role: row.requester_role,
          requester_groups: parseJson(row.requester_groups_json, []),
          status: row.status,
          required_approvals: row.required_approvals,
          approver_roles: parseJson(row.approver_roles_json, []),
          approver_groups: parseJson(row.approver_groups_json, []),
          requester_cannot_approve: row.requester_cannot_approve,
          rule_id: row.rule_id,
          summary: parseJson(row.summary_json, {}),
          expires_at: row.expires_at,
          created_at: row.created_at,
          updated_at: row.updated_at,
          approved_at: row.approved_at,
          executed_at: row.executed_at,
          run_id: row.run_id,
          parent_run_id: row.parent_run_id,
        })),
        ...records(table(payload, "operation_approval_decisions")).map((row) => ({
          type: "decision",
          approval_id: row.approval_id,
          approver_identity: row.approver_identity,
          approver_role: row.approver_role,
          decision: row.decision,
          decided_at: row.decided_at,
        })),
      ];
      break;
    case "audit":
      projected = records(table(payload, "portal_audit_events")).map((row) => cleanUndefined({
        id: row.id,
        created_at: row.created_at,
        correlation_id: row.correlation_id,
        actor_identity: row.actor_identity,
        actor_role: row.actor_role,
        actor_groups: parseJson(row.actor_groups_json, []),
        action: row.action,
        resource_type: row.resource_type,
        resource_id: row.resource_id,
        event_id: row.event_id,
        schema_version: row.schema_version,
        approval_id: row.approval_id,
        run_id: row.run_id,
        job_id: row.job_id,
        outcome: row.outcome,
        error_code: row.error_code,
        metadata: parseJson(row.metadata_json, {}),
      }));
      break;
  }

  const result = { records: projected };
  assertSanitizedBackupPayload(result);
  return result;
}
