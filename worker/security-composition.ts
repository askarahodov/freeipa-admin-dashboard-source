import compatibilityRuntime from "./maintenance-mode-root-entry.ts";

/**
 * Canonical migration contract for the security-critical Worker request path.
 *
 * This list describes the order that must be preserved while #629 replaces
 * legacy wrappers with explicit middleware. It is intentionally descriptive:
 * runtime behavior still delegates to the existing compatibility graph below.
 * A stage may move out of its legacy owner only together with parity/negative
 * evidence for that stage.
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

type RuntimeEnv = NonNullable<Parameters<typeof compatibilityRuntime.fetch>[1]>;
type RuntimeContext = Parameters<typeof compatibilityRuntime.fetch>[2];
type ScheduledController = Parameters<NonNullable<typeof compatibilityRuntime.scheduled>>[0];

/**
 * Single application-facing security seam during the compatibility migration.
 *
 * Do not add security behavior here merely to make the list above "real".
 * Each gate is cut over separately only after its current behavior is captured
 * by focused negative/parity tests. Until then the legacy graph remains the
 * execution authority and this adapter preserves request/env/context exactly.
 */
const securityComposition = {
  fetch(request: Request, env: RuntimeEnv, ctx: RuntimeContext): Promise<Response> {
    return compatibilityRuntime.fetch(request, env, ctx);
  },

  async scheduled(controller: ScheduledController, env: RuntimeEnv | undefined, ctx: RuntimeContext): Promise<void> {
    return compatibilityRuntime.scheduled?.(controller, env, ctx);
  },
};

export default securityComposition;
