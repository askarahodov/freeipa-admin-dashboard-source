export type StorageMigrationApplyGateDependencies<RuntimeEnv, RuntimeContext> = Readonly<{
  handleApply: (request: Request, env: RuntimeEnv) => Promise<Response | null>;
  nextFetch: (request: Request, env: RuntimeEnv, ctx: RuntimeContext) => Promise<Response>;
}>;

/**
 * First explicit security-composition gate extracted from the legacy Worker
 * wrapper graph.
 *
 * Controlled storage-migration apply/status/reconcile requests must be handled
 * before maintenance restrictions. For all other traffic this gate is a pure
 * pass-through: it must preserve request, environment and runtime context
 * object identity and delegate exactly once.
 */
export async function handleStorageMigrationApplyGate<RuntimeEnv, RuntimeContext>(
  request: Request,
  env: RuntimeEnv,
  ctx: RuntimeContext,
  dependencies: StorageMigrationApplyGateDependencies<RuntimeEnv, RuntimeContext>,
): Promise<Response> {
  const response = await dependencies.handleApply(request, env);
  if (response) return response;
  return dependencies.nextFetch(request, env, ctx);
}
