import { appendAuditEvent, createAuditContext } from "../audit-log";
import { serviceAdminTokenAuthorized } from "../src/auth/admin-session-authorization.ts";
import { readApprovalPolicySet, saveApprovalPolicySet } from "../src/operations/approvals/approval-gates";
import { readCatalogPolicySet, saveCatalogPolicySet } from "../src/operations/catalog/catalog-policies";
import {
  availableProcessPresentationLocales,
  readProcessPresentationSet,
  saveProcessPresentationSet,
} from "../src/operations/presentation/process-presentation";
import { portalAccess, requirePortalPermission, type PortalAccessEnv } from "./portal-access-runtime.ts";
import {
  automationRoutes,
  boolValue,
  effectiveEnv,
  envSettings,
  publicRoute,
  readStoredSettings,
  sanitizeRoutes,
  saveStoredSettings,
  type XyOpsAdminRuntimeEnv,
} from "./xyops-admin-runtime.ts";

export type XyOpsAdminHttpEnv = XyOpsAdminRuntimeEnv & PortalAccessEnv & {
  ADMIN_TOKEN?: string;
};

const jsonHeaders = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const ownedPaths = new Set([
  "/api/integrations/routes",
  "/api/integrations/catalog/presentation",
  "/api/integrations/catalog/policies",
  "/api/integrations/approval/policies",
]);

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}

async function administratorAuthorized(request: Request, env: XyOpsAdminHttpEnv): Promise<boolean> {
  return Boolean(env.ADMIN_TOKEN) && serviceAdminTokenAuthorized(request, env.ADMIN_TOKEN);
}

export async function handleXyOpsAdminRequest(
  request: Request,
  baseEnv: XyOpsAdminHttpEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!ownedPaths.has(url.pathname)) return null;

  const audit = createAuditContext(portalAccess(request, baseEnv));
  const env = await effectiveEnv(baseEnv);

  if (url.pathname === "/api/integrations/catalog/presentation") {
    const denied = requirePortalPermission(request, baseEnv, "settings.manage");
    if (denied) return denied;
    if (!await administratorAuthorized(request, baseEnv)) return json({ error: "Administrator authorization required" }, 401);
    if (request.method === "GET") {
      try {
        const state = await readProcessPresentationSet(baseEnv);
        return json({ ...state, availableLocales: availableProcessPresentationLocales(state.metadata), persistenceAvailable: Boolean(baseEnv.DB) });
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "Cannot load process presentation metadata" }, 503);
      }
    }
    if (request.method === "PUT") {
      if (!baseEnv.DB) return json({ error: "Persistent database is unavailable" }, 503);
      try {
        const body = await request.json() as Record<string, unknown>;
        const saved = await saveProcessPresentationSet(baseEnv, body.metadata);
        const processIds = Object.keys(saved.metadata.processes);
        const availableLocales = availableProcessPresentationLocales(saved.metadata);
        await appendAuditEvent(baseEnv, audit, { action: "catalog.presentation.updated", resourceType: "process_presentation", resourceId: "current", outcome: "success", metadata: { version: saved.metadata.version, processCount: processIds.length, processIds: processIds.slice(0, 100), defaultLocale: saved.metadata.defaultLocale ?? "", localeCount: availableLocales.length } }).catch(() => {});
        return json({ ...saved, availableLocales, persistenceAvailable: true });
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "Cannot save process presentation metadata" }, 400);
      }
    }
    return json({ error: "Method not allowed" }, 405);
  }

  if (url.pathname === "/api/integrations/catalog/policies") {
    const denied = requirePortalPermission(request, baseEnv, "settings.manage");
    if (denied) return denied;
    if (!await administratorAuthorized(request, baseEnv)) return json({ error: "Administrator authorization required" }, 401);
    if (request.method === "GET") {
      try {
        const state = await readCatalogPolicySet(baseEnv);
        return json({ ...state, persistenceAvailable: Boolean(baseEnv.DB) });
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "Cannot load catalog policies" }, 503);
      }
    }
    if (request.method === "PUT") {
      if (!baseEnv.DB) return json({ error: "Persistent database is unavailable" }, 503);
      try {
        const body = await request.json() as Record<string, unknown>;
        const saved = await saveCatalogPolicySet(baseEnv, body.policy);
        await appendAuditEvent(baseEnv, audit, { action: "catalog.policy.updated", resourceType: "policy", resourceId: "catalog_visibility", outcome: "success", metadata: { version: saved.policy.version, defaultEffect: saved.policy.defaultEffect, adminBypass: saved.policy.adminBypass, ruleCount: saved.policy.rules.length } }).catch(() => {});
        return json({ policy: saved.policy, source: "database", updatedAt: saved.updatedAt, persistenceAvailable: true });
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "Cannot save catalog policies" }, 400);
      }
    }
    return json({ error: "Method not allowed" }, 405);
  }

  if (url.pathname === "/api/integrations/approval/policies") {
    const denied = requirePortalPermission(request, baseEnv, "settings.manage");
    if (denied) return denied;
    if (!await administratorAuthorized(request, baseEnv)) return json({ error: "Administrator authorization required" }, 401);
    if (request.method === "GET") {
      try {
        const state = await readApprovalPolicySet(baseEnv);
        return json({ ...state, persistenceAvailable: Boolean(baseEnv.DB) });
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "Cannot load approval policies" }, 503);
      }
    }
    if (request.method === "PUT") {
      if (!baseEnv.DB) return json({ error: "Persistent database is unavailable" }, 503);
      try {
        const body = await request.json() as Record<string, unknown>;
        const saved = await saveApprovalPolicySet(baseEnv, body.policy);
        await appendAuditEvent(baseEnv, audit, { action: "approval.policy.updated", resourceType: "policy", resourceId: "xyops_approval", outcome: "success", metadata: { version: saved.policy.version, dangerousDefaultEnabled: Boolean(saved.policy.dangerousDefaults), ruleCount: saved.policy.rules.length } }).catch(() => {});
        return json({ policy: saved.policy, source: "database", updatedAt: saved.updatedAt, persistenceAvailable: true });
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "Cannot save approval policies" }, 400);
      }
    }
    return json({ error: "Method not allowed" }, 405);
  }

  if (request.method === "GET" && url.pathname === "/api/integrations/routes") {
    const denied = requirePortalPermission(request, baseEnv, "settings.manage");
    if (denied) return denied;
    const routes = automationRoutes(env);
    return json({ mode: boolValue(env.DEMO_MODE) ? "demo" : routes.length ? "live" : "unconfigured", routes: routes.map(publicRoute) });
  }

  if (request.method === "PUT" && url.pathname === "/api/integrations/routes") {
    const denied = requirePortalPermission(request, baseEnv, "settings.manage");
    if (denied) return denied;
    if (!await administratorAuthorized(request, baseEnv)) return json({ error: "Administrator authorization required" }, 401);
    if (!baseEnv.DB || !baseEnv.CONFIG_ENCRYPTION_KEY) return json({ error: "Persistent encrypted storage is unavailable" }, 503);
    try {
      const body = await request.json() as Record<string, unknown>;
      const routes = sanitizeRoutes(body.routes);
      const current = await readStoredSettings(baseEnv) ?? envSettings(baseEnv);
      const next = { ...current, config: { ...current.config, routes }, updatedAt: Date.now() };
      await saveStoredSettings(baseEnv, next);
      await appendAuditEvent(baseEnv, audit, { action: "routes.updated", resourceType: "automation_routes", resourceId: "current", outcome: "success", metadata: { routeCount: routes.length, enabledCount: routes.filter((route) => route.enabled !== false).length, eventIds: routes.map((route) => route.eventId).slice(0, 100) } }).catch(() => {});
      return json({ mode: routes.length ? "live" : "unconfigured", routes: routes.map(publicRoute) });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Cannot save routes" }, 400);
    }
  }

  // Preserve the legacy /routes method-mismatch fall-through to the compatibility tail.
  return null;
}
