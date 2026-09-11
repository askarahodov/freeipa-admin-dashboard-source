/**
 * Pure migration metadata for the security-critical Worker request path.
 *
 * Keep this module free of runtime imports so architecture/parity tests can
 * inspect the contract without loading the legacy Worker wrapper graph.
 *
 * The outer order is universal only until traffic enters local-secure-entry.
 * Local auth/admin routes intentionally have route-specific origin/session
 * ordering today; those profiles are captured separately below so #629 does
 * not accidentally change 401/403 semantics while extracting middleware.
 */
export const portalSecurityGateOrder = Object.freeze([
  Object.freeze({
    id: "storage-migration-apply",
    owner: "worker/security-composition.ts",
    responsibility: "explicit privileged storage migration apply boundary",
  }),
  Object.freeze({
    id: "maintenance",
    owner: "worker/security-composition.ts",
    responsibility: "explicit maintenance and recovery availability restrictions",
  }),
  Object.freeze({
    id: "service-admin-authentication",
    owner: "worker/security-composition.ts",
    responsibility: "explicit outer local-mode allowlisted service-admin token authentication and adaptation",
  }),
  Object.freeze({
    id: "local-security-routing",
    owner: "worker/local-secure-entry.ts",
    responsibility: "route-specific local session, service-admin fallback and mutation-origin ordering",
  }),
  Object.freeze({
    id: "authorization-and-domain",
    owner: "worker compatibility dispatch graph",
    responsibility: "route permission checks, route-specific restrictions and handler dispatch",
  }),
  Object.freeze({
    id: "audit-and-error",
    owner: "worker compatibility dispatch graph",
    responsibility: "existing audit context and safe outward error behavior",
  }),
] as const);

export const portalLocalSecurityOrderProfiles = Object.freeze([
  Object.freeze({
    id: "local-auth-mutation",
    match: "local-mode /api/auth/** mutation",
    order: Object.freeze(["mutation-origin", "local-session-authorization"] as const),
    note: "same-origin is checked before requireAdmin; logout revokes the current session after origin validation without requireAdmin",
  }),
  Object.freeze({
    id: "local-admin-integration",
    match: "local-mode authenticated admin integration path",
    order: Object.freeze(["local-session-authentication", "mutation-origin", "internal-token-delegation"] as const),
    note: "session resolution precedes same-origin validation for admin integration delegation",
  }),
  Object.freeze({
    id: "local-api-no-session",
    match: "local-mode non-auth API path without a resolved session",
    order: Object.freeze(["local-session-authentication", "service-admin-fallback", "anonymous-api-denial"] as const),
    note: "service-admin remains an allowlisted fallback after local-session resolution fails, not a universal bypass",
  }),
] as const);

export const portalAuthenticationMechanisms = Object.freeze([
  "anonymous",
  "local-session",
  "service-admin",
] as const);

export type PortalSecurityGateId = (typeof portalSecurityGateOrder)[number]["id"];
export type PortalLocalSecurityOrderProfile = (typeof portalLocalSecurityOrderProfiles)[number];
export type PortalAuthenticationMechanism = (typeof portalAuthenticationMechanisms)[number];
