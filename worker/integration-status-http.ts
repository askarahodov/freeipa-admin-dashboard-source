import {
  effectiveIntegrationRuntime,
  type IntegrationSettingsEnv,
} from "./integration-settings-runtime.ts";
import { freeIpaRpc, type FreeIpaRpcEnv } from "./freeipa-rpc.ts";
import {
  portalAccess,
  requestActor,
  type PortalAccessEnv,
} from "./portal-access-runtime.ts";

export type IntegrationStatusEnv = IntegrationSettingsEnv & FreeIpaRpcEnv & PortalAccessEnv;

export type IntegrationStatusDependencies = {
  resolveRuntime?: typeof effectiveIntegrationRuntime;
  probeFreeIpa?: (env: IntegrationStatusEnv, ipaUrl: string) => Promise<void>;
  probeXyOps?: (url: string) => Promise<boolean>;
};

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}

function boolValue(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  return ["true", "1", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}

async function reachable(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
      redirect: "manual",
    });
    return response.status < 500;
  } catch {
    return false;
  }
}

async function probeFreeIpa(env: IntegrationStatusEnv, ipaUrl: string): Promise<void> {
  await freeIpaRpc(env, ipaUrl, "user_find", [""], { sizelimit: 1 });
}

/**
 * Handles only the exact, read-only integration status route.
 *
 * Authentication/session ordering remains owned by the upstream compatibility
 * security chain. Returning null for every other method/path deliberately
 * preserves the existing downstream method-mismatch/negative routing behavior.
 */
export async function handleIntegrationStatusRequest(
  request: Request,
  baseEnv: IntegrationStatusEnv,
  dependencies: IntegrationStatusDependencies = {},
): Promise<Response | null> {
  const url = new URL(request.url);
  if (request.method !== "GET" || url.pathname !== "/api/integrations/status") return null;

  const resolved = await (dependencies.resolveRuntime ?? effectiveIntegrationRuntime)(baseEnv);
  const env = resolved.env as IntegrationStatusEnv;
  const demoMode = boolValue(env.DEMO_MODE);
  const ipaConfigured = Boolean(resolved.ipaUrl && env.IPA_USERNAME && env.IPA_PASSWORD);
  const xyopsConfigured = Boolean(resolved.xyopsUrl && env.XYOPS_API_KEY);
  const freeIpaProbe = dependencies.probeFreeIpa ?? probeFreeIpa;
  const xyOpsProbe = dependencies.probeXyOps ?? reachable;

  const [ipaProbe, xyopsReachable] = await Promise.all([
    !demoMode && ipaConfigured && resolved.ipaUrl
      ? freeIpaProbe(env, resolved.ipaUrl)
        .then(() => ({ reachable: true, error: null }))
        .catch((error) => ({
          reachable: false,
          error: error instanceof Error ? error.message : "FreeIPA connection failed",
        }))
      : Promise.resolve({ reachable: false, error: null }),
    !demoMode && xyopsConfigured && resolved.xyopsUrl
      ? xyOpsProbe(resolved.xyopsUrl)
      : false,
  ]);

  const access = portalAccess(request, baseEnv);
  return json({
    mode: demoMode ? "demo" : ipaConfigured || xyopsConfigured ? "live" : "unconfigured",
    viewer: requestActor(request),
    access: {
      identity: access.identity,
      role: access.role,
      permissions: access.permissions,
    },
    persistence: {
      available: Boolean(baseEnv.DB),
      configured: Boolean(baseEnv.CONFIG_ENCRYPTION_KEY),
    },
    freeipa: {
      configured: ipaConfigured,
      reachable: ipaProbe.reachable,
      error: ipaProbe.error,
    },
    xyops: {
      configured: xyopsConfigured,
      reachable: xyopsReachable,
    },
  });
}
