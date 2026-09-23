import { listAuditEvents } from "../audit-log.ts";
import {
  requirePortalPermission,
  type PortalAccessEnv,
} from "./portal-access-runtime.ts";

export type IntegrationAuditHttpEnv = PortalAccessEnv & {
  DB?: D1Database;
};

const AUDIT_PATH = "/api/integrations/audit";
const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}

function finiteQueryNumber(url: URL, name: string): number | undefined {
  const value = Number(url.searchParams.get(name) ?? "");
  return Number.isFinite(value) ? value : undefined;
}

export async function handleIntegrationAuditRequest(
  request: Request,
  env: IntegrationAuditHttpEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== AUDIT_PATH) return null;

  const denied = requirePortalPermission(request, env, "settings.manage");
  if (denied) return denied;
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);

  try {
    return json(await listAuditEvents(env, {
      limit: finiteQueryNumber(url, "limit"),
      actor: url.searchParams.get("actor") ?? undefined,
      action: url.searchParams.get("action") ?? undefined,
      outcome: url.searchParams.get("outcome") ?? undefined,
      eventId: url.searchParams.get("eventId") ?? undefined,
      approvalId: url.searchParams.get("approvalId") ?? undefined,
      runId: url.searchParams.get("runId") ?? undefined,
      correlationId: url.searchParams.get("correlationId") ?? undefined,
      dateFrom: finiteQueryNumber(url, "dateFrom"),
      dateTo: finiteQueryNumber(url, "dateTo"),
    }));
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : "Cannot load audit log",
    }, 503);
  }
}
