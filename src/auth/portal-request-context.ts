import { isPortalRole, portalRolePermissions, type PortalPermission, type PortalRole } from "./portal-permissions.ts";

export type PortalAuthMode = "anonymous" | "local-session" | "service-admin" | "proxy" | "static";

export type PortalRequestContext = Readonly<{
  correlationId: string;
  identity: string;
  role: PortalRole;
  groups: readonly string[];
  permissions: readonly PortalPermission[];
  authMode: PortalAuthMode;
}>;

type PortalRequestContextInput = {
  correlationId: string;
  identity: string;
  role: PortalRole;
  groups?: Iterable<string>;
  permissions?: Iterable<PortalPermission>;
  authMode: PortalAuthMode;
};

const portalAuthModes = new Set<PortalAuthMode>(["anonymous", "local-session", "service-admin", "proxy", "static"]);

function boundedIdentity(value: string): string {
  const identity = String(value ?? "").trim().toLowerCase();
  if (!identity || /[\r\n]/u.test(identity)) throw new Error("Portal request identity is invalid");
  return identity.slice(0, 160);
}

function boundedCorrelationId(value: string): string {
  const correlationId = String(value ?? "").trim();
  if (!correlationId || correlationId.length > 160 || /[\r\n]/u.test(correlationId)) {
    throw new Error("Portal request correlation id is invalid");
  }
  return correlationId;
}

function normalizedGroups(values: Iterable<string> | undefined): readonly string[] {
  const groups = Array.from(new Set(Array.from(values ?? [], (value) => String(value ?? "").trim().toLowerCase())
    .filter((value) => value && value.length <= 120 && !/[\r\n]/u.test(value))))
    .slice(0, 100);
  return Object.freeze(groups);
}

function normalizedPermissions(role: PortalRole, values: Iterable<PortalPermission> | undefined): readonly PortalPermission[] {
  const allowed = portalRolePermissions[role];
  if (values === undefined) return Object.freeze([...allowed]);

  const permissions = Array.from(new Set(values));
  const expanded = permissions.find((permission) => !allowed.includes(permission));
  if (expanded) throw new Error(`Portal request permission '${expanded}' exceeds role '${role}'`);
  return Object.freeze(permissions);
}

function validatedRole(value: unknown): PortalRole {
  if (!isPortalRole(value)) throw new Error("Portal request role is invalid");
  return value;
}

function validatedAuthMode(value: unknown): PortalAuthMode {
  if (!portalAuthModes.has(value as PortalAuthMode)) throw new Error("Portal request auth mode is invalid");
  return value as PortalAuthMode;
}

/**
 * Canonical resolved request context for the future explicit middleware pipeline.
 *
 * Authentication remains owned by the existing mechanisms. This helper only
 * packages an already-resolved principal into one immutable shape, so adopting
 * it can happen incrementally without changing current dispatch or trust rules.
 * Explicit permission snapshots may narrow a role but may never expand it.
 */
export function createPortalRequestContext(input: PortalRequestContextInput): PortalRequestContext {
  const role = validatedRole(input.role);
  return Object.freeze({
    correlationId: boundedCorrelationId(input.correlationId),
    identity: boundedIdentity(input.identity),
    role,
    groups: normalizedGroups(input.groups),
    permissions: normalizedPermissions(role, input.permissions),
    authMode: validatedAuthMode(input.authMode),
  });
}
