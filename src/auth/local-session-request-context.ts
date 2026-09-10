import { createPortalRequestContext, type PortalRequestContext } from "./portal-request-context.ts";
import type { PortalRole } from "./portal-permissions.ts";

type LocalSessionPrincipal = Readonly<{
  identity: string;
  role: PortalRole;
}>;

function localSessionCorrelationId(): string {
  return `cor_${crypto.randomUUID().replaceAll("-", "")}`;
}

/**
 * Adapts an already-authenticated local session into the canonical request
 * context without changing how the session itself is resolved or authorized.
 */
export function localSessionRequestContext(session: LocalSessionPrincipal): PortalRequestContext {
  return createPortalRequestContext({
    correlationId: localSessionCorrelationId(),
    identity: session.identity,
    role: session.role,
    groups: [],
    authMode: "local-session",
  });
}
