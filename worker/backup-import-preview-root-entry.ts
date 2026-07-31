import { createAuditContext } from "../audit-log.ts";
import baseRuntime from "./freeipa-group-member-entry.ts";
import { handleBackupImportPreviewRequest } from "./backup-import-preview-entry.ts";

type RuntimeEnv = NonNullable<Parameters<typeof baseRuntime.fetch>[1]> & {
  PORTAL_DEFAULT_ROLE?: string;
  PORTAL_RBAC_JSON?: string;
};
type RuntimeContext = Parameters<typeof baseRuntime.fetch>[2];
type ScheduledController = Parameters<NonNullable<typeof baseRuntime.scheduled>>[0];

type PortalRole = "viewer" | "operator" | "admin";

export type BackupPreviewAccess = {
  identity: string;
  role: PortalRole;
  groups: string[];
  permissions: Array<"backup.restore.preview">;
};

type PreviewRuntime = {
  fetch(request: Request, env: RuntimeEnv | undefined, ctx: RuntimeContext): Promise<Response>;
  scheduled?: (controller: ScheduledController, env: RuntimeEnv | undefined, ctx: RuntimeContext) => Promise<void>;
};

function portalRole(value: unknown): PortalRole | null {
  return value === "viewer" || value === "operator" || value === "admin" ? value : null;
}

export function backupPreviewAccess(request: Request, env: RuntimeEnv): BackupPreviewAccess {
  const identity = (request.headers.get("oai-authenticated-user-email") || "portal-user")
    .trim()
    .toLowerCase()
    .slice(0, 160);
  const groups = Array.from(new Set(
    String(request.headers.get("oai-authenticated-user-groups") ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value && value.length <= 120 && !/[\r\n]/.test(value)),
  )).slice(0, 100);

  let role = portalRole(String(env.PORTAL_DEFAULT_ROLE || "").trim().toLowerCase()) ?? "admin";
  if (env.PORTAL_RBAC_JSON) {
    try {
      const assignments = JSON.parse(env.PORTAL_RBAC_JSON) as unknown;
      if (assignments && typeof assignments === "object" && !Array.isArray(assignments)) {
        const normalized = Object.fromEntries(
          Object.entries(assignments as Record<string, unknown>)
            .map(([key, value]) => [key.trim().toLowerCase(), value]),
        );
        role = portalRole(normalized[identity]) ?? portalRole(normalized["*"]) ?? role;
      }
    } catch {
      // Invalid RBAC JSON never grants a role beyond the explicit default.
    }
  }

  return {
    identity,
    role,
    groups,
    permissions: role === "admin" ? ["backup.restore.preview"] : [],
  };
}

export function createBackupImportPreviewRuntime(
  runtime: PreviewRuntime,
  previewHandler: typeof handleBackupImportPreviewRequest = handleBackupImportPreviewRequest,
) {
  return {
    async fetch(request: Request, env: RuntimeEnv | undefined, ctx: RuntimeContext): Promise<Response> {
      const sourceEnv = env ?? (process.env as unknown as RuntimeEnv);
      const url = new URL(request.url);
      if (url.pathname === "/api/admin/backups/import/preview") {
        const access = backupPreviewAccess(request, sourceEnv);
        if (!access.permissions.includes("backup.restore.preview")) {
          return new Response(JSON.stringify({
            error: "Insufficient permission for this operation",
            requiredPermission: "backup.restore.preview",
            role: access.role,
          }), {
            status: 403,
            headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
          });
        }
        return previewHandler(request, sourceEnv, createAuditContext(access));
      }
      return runtime.fetch(request, sourceEnv, ctx);
    },

    async scheduled(controller: ScheduledController, env: RuntimeEnv | undefined, ctx: RuntimeContext): Promise<void> {
      return runtime.scheduled?.(controller, env, ctx);
    },
  };
}

export default createBackupImportPreviewRuntime(baseRuntime);
