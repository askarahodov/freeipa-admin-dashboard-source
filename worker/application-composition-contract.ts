/**
 * Pure application-composition ownership metadata.
 *
 * Keep this module runtime-import-free. It is not a route registry and does not
 * duplicate permission/auth metadata. It records only the production Worker
 * composition owners and the bounded compatibility exceptions that still need
 * parity-gated removal or thinning.
 */
export const portalApplicationComposition = Object.freeze({
  productionBuildEntry: "worker/http-security-root-entry.ts",
  httpSecurityBoundary: "worker/http-security-root-entry.ts",
  schemaBoundary: "worker/schema-migrations-entry.ts",
  httpApplication: "worker/application.ts",
  routeClassifier: "worker/application-router.ts",
  httpSecurityComposition: "worker/security-composition.ts",
  scheduledOwner: "worker/application-scheduled.ts",
  frameworkOwner: "worker/framework-http-entry.ts",
  frameworkPolicy: "worker/framework-http.ts",
  frameworkDispatchMode: "compatibility-tail",
  compatibilityRoot: "worker/maintenance-control-root-entry.ts",
  centralCompatibilityTail: "worker/index.ts",
} as const);

export const portalCompatibilityAdapters = Object.freeze([
  Object.freeze({
    path: "worker/local-secure-entry.ts",
    responsibility: "owns local authentication HTTP handling while invoking the historical-position local security routing middleware",
    reason: "auth route ownership and local session/service-admin/origin composition still share one adapter boundary",
    removalCondition: "register local-auth handlers and local-security middleware independently with exact 401/403/origin parity and no trusted-header regression",
  }),
  Object.freeze({
    path: "worker/settings-source-safe-entry.ts",
    responsibility: "preserves source authorization, inherited-environment handling, lock/release and compensation sequencing",
    reason: "security and compensation semantics still span the HTTP wrapper boundary",
    removalCondition: "compose source authorization/locking/compensation explicitly without hidden env mutation and pass settings negative/conflict/rollback parity",
  }),
  Object.freeze({
    path: "worker/settings-source-entry.ts",
    responsibility: "preserves inherited-source synchronization, source mutation locking, CAS and effective-settings source metadata",
    reason: "source-of-value semantics are still coupled to request wrapping and response patching",
    removalCondition: "move source/CAS semantics behind one canonical settings service boundary and prove revision/source/effective response parity",
  }),
  Object.freeze({
    path: "worker/secure-entry.ts",
    responsibility: "normalizes trusted identity headers/environment and still owns catalog-sync plus post-identity settings dispatch",
    reason: "canonical request context exists but some downstream compatibility handlers still consume trusted legacy headers/env",
    removalCondition: "make downstream handlers consume canonical request context directly, register settings/catalog-sync explicitly, and prove no header/env impersonation path remains",
  }),
] as const);

export const portalCentralCompatibilityTail = Object.freeze({
  path: "worker/index.ts",
  responsibility: "compatibility-only integration audit/legacy catalog helpers before explicit framework delegation",
  reason: "canonical stable route ownership has been extracted, but framework dispatch and a small non-canonical compatibility tail still terminate here",
  removalCondition: "move remaining compatibility-only surfaces/helpers, route framework traffic directly to its explicit owner after parity proof, then delete the central compatibility dispatch",
} as const);

export type PortalCompatibilityAdapter = (typeof portalCompatibilityAdapters)[number];
