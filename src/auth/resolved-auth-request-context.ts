import {
  createPortalRequestContext,
  type PortalAuthMode,
  type PortalRequestContext,
} from "./portal-request-context.ts";
import type { PortalRole } from "./portal-permissions.ts";

export type ResolvedPortalAuthMode = Extract<PortalAuthMode, "workspace" | "proxy" | "static" | "service-admin">;

export type ResolvedPortalPrincipal = Readonly<{
  identity: string;
  role: PortalRole;
  groups?: readonly string[] | ReadonlySet<string>;
  authMode: ResolvedPortalAuthMode;
}>;

function resolvedAuthCorrelationId(): string {
  return `cor_${crypto.randomUUID().replaceAll("-", "")}`;
}

/**
 * Adapts a principal that has already passed its mechanism-specific trust check
 * into the canonical request context. Trust verification remains owned by the
 * existing workspace, proxy, static, and service-admin authentication paths.
 */
export function resolvedAuthRequestContext(principal: ResolvedPortalPrincipal): PortalRequestContext {
  return createPortalRequestContext({
    correlationId: resolvedAuthCorrelationId(),
    identity: principal.identity,
    role: principal.role,
    groups: principal.groups,
    authMode: principal.authMode,
  });
}
