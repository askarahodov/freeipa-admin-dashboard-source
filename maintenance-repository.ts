import {
  MAINTENANCE_STATES,
  MaintenanceModeError,
  createMaintenanceControllerSecret,
  createMaintenanceOperationId,
  hashMaintenanceControllerSecret,
  maintenanceConfirmation,
  validateMaintenanceVerification,
  type MaintenanceConfirmationAction,
  type MaintenanceRow,
  type MaintenanceState,
  type MaintenanceVerification,
} from "./maintenance-mode.ts";

export class MaintenanceRepositoryError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "MaintenanceRepositoryError";
    this.code = code;
    this.status = status;
  }
}

type MaintenanceActor = {
  identity: string;
  groups: string[];
};

type PrepareOptions = {
  now?: () => number;
  ttlMs?: number;
  createOperationId?: () => string;
  createSecret?: () => string;
  hashSecret?: (secret: string) => Promise<string>;
};

type TransitionInput = {
  operationId: unknown;
  controllerSecret: unknown;
  confirmation: unknown;
  now?: unknown;
  verification?: unknown;
};

type TransitionDependencies = {
  hashSecret?: (secret: string) => Promise<string>;
};

type MaintenanceDatabaseRow = {
  id: unknown;
  state: unknown;
  operation_id: unknown;
  actor_identity: unknown;
  actor_groups_json: unknown;
  controller_secret_hash: unknown;
  created_at: unknown;
  updated_at: unknown;
  expires_at: unknown;
  completed_at: unknown;
  failure_code: unknown;
  verification_json: unknown;
};

const operationIdPattern = /^maintenance_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const controllerSecretPattern = /^[A-Za-z0-9_-]{43}$/;
const hashPattern = /^[0-9a-f]{64}$/;
const states = new Set<string>(MAINTENANCE_STATES);
const failureCodes = new Set([
  "maintenance_state_unavailable",
  "maintenance_transition_failed",
  "maintenance_verification_failed",
  "maintenance_recovery_failed",
]);
const selectMaintenanceStateSql = `SELECT id, state, operation_id, actor_identity, actor_groups_json,
  controller_secret_hash, created_at, updated_at, expires_at, completed_at,
  failure_code, verification_json
FROM portal_maintenance_state WHERE id = 'main'`;

function fail(code: string, status: number, message: string): never {
  throw new MaintenanceRepositoryError(code, status, message);
}

function resultChanges(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  const result = value as { meta?: { changes?: unknown }; changes?: unknown };
  const changes = Number(result.meta?.changes ?? result.changes ?? 0);
  return Number.isSafeInteger(changes) && changes >= 0 ? changes : 0;
}

function safeInteger(value: unknown, code = "maintenance_request_invalid"): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    fail(code, code === "maintenance_request_invalid" ? 400 : 409, "Maintenance request is invalid");
  }
  return number;
}

function optionalInteger(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    fail("maintenance_state_unavailable", 503, "Maintenance state is unavailable");
  }
  return number;
}

function actorContext(value: unknown): MaintenanceActor {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("maintenance_request_invalid", 400, "Maintenance request is invalid");
  }
  const source = value as { identity?: unknown; groups?: unknown };
  const identity = String(source.identity ?? "").trim();
  if (!identity || identity.length > 320 || !Array.isArray(source.groups) || source.groups.length > 128) {
    fail("maintenance_request_invalid", 400, "Maintenance request is invalid");
  }
  const groups = [...new Set(source.groups.map((item) => String(item ?? "").trim()))]
    .filter(Boolean)
    .sort();
  if (groups.some((group) => group.length > 320)) {
    fail("maintenance_request_invalid", 400, "Maintenance request is invalid");
  }
  return { identity, groups };
}

function operationId(value: unknown): string {
  if (typeof value !== "string" || !operationIdPattern.test(value)) {
    fail("maintenance_request_invalid", 400, "Maintenance request is invalid");
  }
  return value;
}

function controllerSecret(value: unknown): string {
  if (typeof value !== "string" || !controllerSecretPattern.test(value)) {
    fail("maintenance_controller_invalid", 409, "Maintenance controller is invalid");
  }
  return value;
}

function controllerHash(value: unknown): string {
  if (typeof value !== "string" || !hashPattern.test(value)) {
    fail("maintenance_transition_failed", 500, "Maintenance transition failed");
  }
  return value;
}

function fixedHashEqual(expected: string, actual: string): boolean {
  if (!hashPattern.test(expected) || !hashPattern.test(actual)) return false;
  let difference = 0;
  for (let index = 0; index < 64; index += 1) {
    difference |= expected.charCodeAt(index) ^ actual.charCodeAt(index);
  }
  return difference === 0;
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "string" || value.length > 16_384) {
    fail("maintenance_state_unavailable", 503, "Maintenance state is unavailable");
  }
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
    return parsed as Record<string, unknown>;
  } catch {
    fail("maintenance_state_unavailable", 503, "Maintenance state is unavailable");
  }
}

function parseGroups(value: unknown): string[] {
  if (typeof value !== "string" || value.length > 65_536) {
    fail("maintenance_state_unavailable", 503, "Maintenance state is unavailable");
  }
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length > 128) throw new Error("invalid");
    const groups = parsed.map((item) => String(item ?? "").trim());
    if (groups.some((group) => !group || group.length > 320) || new Set(groups).size !== groups.length) {
      throw new Error("invalid");
    }
    return groups;
  } catch {
    fail("maintenance_state_unavailable", 503, "Maintenance state is unavailable");
  }
}

function parseVerification(value: unknown): Partial<MaintenanceVerification> {
  const parsed = parseJsonObject(value);
  const output: Partial<MaintenanceVerification> = {};
  const allowed = new Set([
    "integrity",
    "schema",
    "administratorAccess",
    "settingsDecryption",
    "auditWrite",
  ]);
  for (const [key, result] of Object.entries(parsed)) {
    if (!allowed.has(key) || result !== "ok") {
      fail("maintenance_state_unavailable", 503, "Maintenance state is unavailable");
    }
    output[key as keyof MaintenanceVerification] = "ok";
  }
  return output;
}

function normalizeRow(value: MaintenanceDatabaseRow): MaintenanceRow {
  if (value.id !== "main" || typeof value.state !== "string" || !states.has(value.state)) {
    fail("maintenance_state_unavailable", 503, "Maintenance state is unavailable");
  }
  const state = value.state as MaintenanceState;
  const normalizedOperationId = value.operation_id === null ? null : operationId(value.operation_id);
  const actorIdentity = value.actor_identity === null ? null : String(value.actor_identity ?? "").trim();
  const secretHash = value.controller_secret_hash === null ? null : controllerHash(value.controller_secret_hash);
  const createdAt = optionalInteger(value.created_at);
  const updatedAt = optionalInteger(value.updated_at);
  const expiresAt = optionalInteger(value.expires_at);
  const completedAt = optionalInteger(value.completed_at);
  const failureCode = value.failure_code === null
    ? null
    : typeof value.failure_code === "string" && failureCodes.has(value.failure_code)
      ? value.failure_code
      : fail("maintenance_state_unavailable", 503, "Maintenance state is unavailable");
  const actorGroups = parseGroups(value.actor_groups_json);
  const verification = parseVerification(value.verification_json);

  if (updatedAt === null || (actorIdentity !== null && (!actorIdentity || actorIdentity.length > 320))) {
    fail("maintenance_state_unavailable", 503, "Maintenance state is unavailable");
  }
  if (state === "inactive") {
    if (normalizedOperationId !== null || actorIdentity !== null || secretHash !== null || createdAt !== null || expiresAt !== null) {
      fail("maintenance_state_unavailable", 503, "Maintenance state is unavailable");
    }
  } else if (!normalizedOperationId || !actorIdentity || !secretHash || createdAt === null) {
    fail("maintenance_state_unavailable", 503, "Maintenance state is unavailable");
  }

  return {
    id: "main",
    state,
    operationId: normalizedOperationId,
    actorIdentity,
    actorGroups,
    controllerSecretHash: secretHash,
    createdAt,
    updatedAt,
    expiresAt,
    completedAt,
    failureCode,
    verification,
  };
}

async function loadRawMaintenanceState(db: D1Database): Promise<MaintenanceRow | null> {
  const row = await db.prepare(selectMaintenanceStateSql).first<MaintenanceDatabaseRow>();
  return row ? normalizeRow(row) : null;
}

export async function loadMaintenanceState(db: D1Database): Promise<MaintenanceRow | null> {
  try {
    if (!db || typeof db.prepare !== "function") {
      fail("maintenance_state_unavailable", 503, "Maintenance state is unavailable");
    }
    return await loadRawMaintenanceState(db);
  } catch (error) {
    if (error instanceof MaintenanceRepositoryError) throw error;
    throw new MaintenanceRepositoryError(
      "maintenance_state_unavailable",
      503,
      "Maintenance state is unavailable",
    );
  }
}

function normalizedNow(value: unknown): number {
  return safeInteger(value ?? Date.now());
}

function safeTtl(value: unknown): number {
  const number = Number(value ?? 15 * 60 * 1000);
  if (!Number.isSafeInteger(number) || number < 60_000 || number > 60 * 60 * 1000) {
    fail("maintenance_request_invalid", 400, "Maintenance request is invalid");
  }
  return number;
}

function transitionError(error: unknown): MaintenanceRepositoryError {
  if (error instanceof MaintenanceRepositoryError) {
    if (error.code === "maintenance_state_unavailable") {
      return new MaintenanceRepositoryError(
        "maintenance_transition_failed",
        500,
        "Maintenance transition failed",
      );
    }
    return error;
  }
  if (error instanceof MaintenanceModeError) {
    return new MaintenanceRepositoryError(error.code, error.status, error.message);
  }
  return new MaintenanceRepositoryError(
    "maintenance_transition_failed",
    500,
    "Maintenance transition failed",
  );
}

export async function prepareMaintenance(
  db: D1Database,
  actorValue: unknown,
  options: PrepareOptions = {},
): Promise<{ row: MaintenanceRow; secret: string }> {
  try {
    if (!db || typeof db.batch !== "function" || typeof db.prepare !== "function") {
      fail("maintenance_state_unavailable", 503, "Maintenance state is unavailable");
    }
    const actor = actorContext(actorValue);
    const now = normalizedNow(options.now?.());
    const expiresAt = now + safeTtl(options.ttlMs);
    const id = operationId((options.createOperationId ?? createMaintenanceOperationId)());
    const secret = controllerSecret((options.createSecret ?? createMaintenanceControllerSecret)());
    const hash = controllerHash(await (options.hashSecret ?? hashMaintenanceControllerSecret)(secret));
    const initialize = db.prepare(
      "INSERT OR IGNORE INTO portal_maintenance_state (id, state, actor_groups_json, updated_at, verification_json) VALUES ('main', 'inactive', '[]', ?, '{}')",
    ).bind(now);
    const claim = db.prepare(
      `UPDATE portal_maintenance_state SET state = 'entering', operation_id = ?, actor_identity = ?,
        actor_groups_json = ?, controller_secret_hash = ?, created_at = ?, updated_at = ?, expires_at = ?,
        completed_at = NULL, failure_code = NULL, verification_json = '{}'
      WHERE id = 'main' AND state = 'inactive'`,
    ).bind(id, actor.identity, JSON.stringify(actor.groups), hash, now, now, expiresAt);
    const results = await db.batch([initialize, claim]);
    if (!Array.isArray(results) || results.length !== 2 || resultChanges(results[1]) !== 1) {
      fail("maintenance_operation_conflict", 409, "Maintenance operation conflicts with current state");
    }
    const row = await loadRawMaintenanceState(db);
    if (!row || row.state !== "entering" || row.operationId !== id || row.controllerSecretHash !== hash) {
      fail("maintenance_transition_failed", 500, "Maintenance transition failed");
    }
    return { row, secret };
  } catch (error) {
    const normalized = transitionError(error);
    if (normalized.code === "maintenance_state_unavailable") {
      throw new MaintenanceRepositoryError("maintenance_state_unavailable", 503, "Maintenance state is unavailable");
    }
    throw normalized;
  }
}

async function authorizeTransition(
  db: D1Database,
  input: TransitionInput,
  action: MaintenanceConfirmationAction,
  expectedState: MaintenanceState,
  dependencies: TransitionDependencies,
): Promise<{ row: MaintenanceRow; id: string; hash: string; now: number }> {
  const id = operationId(input.operationId);
  const secret = controllerSecret(input.controllerSecret);
  const expectedConfirmation = maintenanceConfirmation(action, id);
  if (input.confirmation !== expectedConfirmation) {
    fail("maintenance_confirmation_required", 422, "Maintenance confirmation is required");
  }
  const now = normalizedNow(input.now);
  const row = await loadRawMaintenanceState(db);
  if (!row || row.state !== expectedState || row.operationId !== id || !row.controllerSecretHash) {
    fail("maintenance_transition_invalid", 409, "Maintenance transition is invalid");
  }
  if (expectedState === "entering" && (row.expiresAt === null || row.expiresAt <= now)) {
    fail("maintenance_prepare_expired", 409, "Maintenance prepare operation expired");
  }
  const hash = controllerHash(await (dependencies.hashSecret ?? hashMaintenanceControllerSecret)(secret));
  if (!fixedHashEqual(row.controllerSecretHash, hash)) {
    fail("maintenance_controller_invalid", 409, "Maintenance controller is invalid");
  }
  return { row, id, hash, now };
}

async function finishTransition(
  db: D1Database,
  results: unknown,
  expectedState: MaintenanceState,
): Promise<MaintenanceRow> {
  if (!Array.isArray(results) || results.length < 1 || resultChanges(results[0]) !== 1) {
    fail("maintenance_transition_invalid", 409, "Maintenance transition is invalid");
  }
  const row = await loadRawMaintenanceState(db);
  if (!row || row.state !== expectedState) {
    fail("maintenance_transition_failed", 500, "Maintenance transition failed");
  }
  return row;
}

export async function enterMaintenance(
  db: D1Database,
  input: TransitionInput,
  dependencies: TransitionDependencies = {},
): Promise<MaintenanceRow> {
  try {
    const context = await authorizeTransition(db, input, "enter", "entering", dependencies);
    const activate = db.prepare(
      `UPDATE portal_maintenance_state SET state = 'active', updated_at = ?, expires_at = NULL
      WHERE id = 'main' AND state = 'entering' AND operation_id = ?
        AND controller_secret_hash = ? AND expires_at > ?`,
    ).bind(context.now, context.id, context.hash, context.now);
    const revoke = db.prepare(
      `DELETE FROM portal_sessions WHERE EXISTS (
        SELECT 1 FROM portal_maintenance_state
        WHERE id = 'main' AND state = 'active' AND operation_id = ? AND controller_secret_hash = ?
      )`,
    ).bind(context.id, context.hash);
    return await finishTransition(db, await db.batch([activate, revoke]), "active");
  } catch (error) {
    throw transitionError(error);
  }
}

export async function startMaintenanceVerification(
  db: D1Database,
  input: TransitionInput,
  dependencies: TransitionDependencies = {},
): Promise<MaintenanceRow> {
  try {
    const context = await authorizeTransition(db, input, "verify", "active", dependencies);
    const statement = db.prepare(
      `UPDATE portal_maintenance_state SET state = 'verifying', updated_at = ?
      WHERE id = 'main' AND state = 'active' AND operation_id = ? AND controller_secret_hash = ?`,
    ).bind(context.now, context.id, context.hash);
    return await finishTransition(db, await db.batch([statement]), "verifying");
  } catch (error) {
    throw transitionError(error);
  }
}

export async function exitMaintenance(
  db: D1Database,
  input: TransitionInput,
  dependencies: TransitionDependencies = {},
): Promise<MaintenanceRow> {
  try {
    const context = await authorizeTransition(db, input, "exit", "verifying", dependencies);
    const verification = validateMaintenanceVerification(input.verification);
    const statement = db.prepare(
      `UPDATE portal_maintenance_state SET state = 'exiting', verification_json = ?, updated_at = ?
      WHERE id = 'main' AND state = 'verifying' AND operation_id = ? AND controller_secret_hash = ?`,
    ).bind(JSON.stringify(verification), context.now, context.id, context.hash);
    return await finishTransition(db, await db.batch([statement]), "exiting");
  } catch (error) {
    throw transitionError(error);
  }
}

export async function completeMaintenance(
  db: D1Database,
  input: TransitionInput,
  dependencies: TransitionDependencies = {},
): Promise<MaintenanceRow> {
  try {
    const context = await authorizeTransition(db, input, "complete", "exiting", dependencies);
    const statement = db.prepare(
      `UPDATE portal_maintenance_state SET state = 'inactive', operation_id = NULL, actor_identity = NULL,
        actor_groups_json = '[]', controller_secret_hash = NULL, created_at = NULL, updated_at = ?,
        expires_at = NULL, completed_at = ?, failure_code = NULL, verification_json = '{}'
      WHERE id = 'main' AND state = 'exiting' AND operation_id = ? AND controller_secret_hash = ?`,
    ).bind(context.now, context.now, context.id, context.hash);
    return await finishTransition(db, await db.batch([statement]), "inactive");
  } catch (error) {
    throw transitionError(error);
  }
}

export async function cancelMaintenance(
  db: D1Database,
  input: TransitionInput,
  dependencies: TransitionDependencies = {},
): Promise<MaintenanceRow> {
  try {
    const context = await authorizeTransition(db, input, "cancel", "entering", dependencies);
    const statement = db.prepare(
      `UPDATE portal_maintenance_state SET state = 'inactive', operation_id = NULL, actor_identity = NULL,
        actor_groups_json = '[]', controller_secret_hash = NULL, created_at = NULL, updated_at = ?,
        expires_at = NULL, completed_at = ?, failure_code = NULL, verification_json = '{}'
      WHERE id = 'main' AND state = 'entering' AND operation_id = ? AND controller_secret_hash = ? AND expires_at > ?`,
    ).bind(context.now, context.now, context.id, context.hash, context.now);
    return await finishTransition(db, await db.batch([statement]), "inactive");
  } catch (error) {
    throw transitionError(error);
  }
}
