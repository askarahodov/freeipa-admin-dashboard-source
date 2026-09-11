/**
 * Pure migration metadata for the security-critical Worker request path.
 *
 * Keep this module free of runtime imports so architecture/parity tests can
 * inspect the contract without loading the legacy Worker wrapper graph.
 */
export const portalSecurityGateOrder = Object.freeze([
  Object.freeze({
    id: "storage-migration-apply",
    owner: "worker/maintenance-mode-root-entry.ts",
    responsibility: "privileged storage migration apply boundary",
  }),
  Object.freeze({
    id: "maintenance",
    owner: "worker/maintenance-mode-root-entry.ts",
    responsibility: "maintenance and recovery availability restrictions",
  }),
  Object.freeze({
    id: "service-admin-authentication",
    owner: "worker/service-admin-root-entry.ts",
    responsibility: "local-mode allowlisted service-admin token adaptation",
  }),
  Object.freeze({
    id: "local-session-authentication",
    owner: "worker/local-secure-entry.ts",
    responsibility: "local session resolution and anonymous fail-closed behavior",
  }),
  Object.freeze({
    id: "mutation-origin",
    owner: "worker/local-secure-entry.ts",
    responsibility: "same-origin protection for local administrative mutations",
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

export const portalAuthenticationMechanisms = Object.freeze([
  "anonymous",
  "local-session",
  "service-admin",
] as const);

export type PortalSecurityGateId = (typeof portalSecurityGateOrder)[number]["id"];
export type PortalAuthenticationMechanism = (typeof portalAuthenticationMechanisms)[number];
