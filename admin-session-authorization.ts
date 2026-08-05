import { STORAGE_STATUS_PATH } from "./storage-status-contract.ts";

export const LOCAL_ADMIN_SESSION_MARKER = "__local_admin_session__";

const ADMIN_INTEGRATION_PATHS = new Set([
  STORAGE_STATUS_PATH,
  "/api/admin/backups/export/encrypted",
  "/api/admin/backups/import/encrypted/preview",
  "/api/admin/backups/import/encrypted/test-restore",
  "/api/admin/backups/import/encrypted/prepare-commit",
  "/api/admin/backups/import/encrypted/commit",
  "/api/admin/backups/import/encrypted/cancel",
  "/api/admin/backups/import/preview",
  "/api/admin/maintenance/status",
  "/api/admin/maintenance/prepare",
  "/api/admin/maintenance/enter",
  "/api/admin/maintenance/verification/start",
  "/api/admin/maintenance/verification/smoke",
  "/api/admin/maintenance/exit",
  "/api/admin/maintenance/complete",
  "/api/admin/maintenance/cancel",
  "/api/integrations/settings",
  "/api/integrations/settings/test",
  "/api/integrations/settings/effective",
  "/api/integrations/settings/drafts",
  "/api/integrations/settings/revisions",
  "/api/integrations/catalog/presentation",
  "/api/integrations/catalog/policies",
  "/api/integrations/approval/policies",
  "/api/integrations/routes",
  "/api/integrations/catalog/sync",
]);

export function isAdminIntegrationPath(pathname: string): boolean {
  return ADMIN_INTEGRATION_PATHS.has(pathname)
    || pathname.startsWith("/api/integrations/settings/drafts/")
    || pathname.startsWith("/api/integrations/settings/revisions/");
}

export function isReadOnlyMethod(method: string): boolean {
  return ["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

export function sameOriginAdminMutation(request: Request): boolean {
  if (isReadOnlyMethod(request.method)) return true;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

async function secretsMatch(provided: string | null, expected: string | undefined): Promise<boolean> {
  if (!provided || !expected) return false;
  const encoder = new TextEncoder();
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const actual = new Uint8Array(providedHash);
  const wanted = new Uint8Array(expectedHash);
  let difference = actual.length ^ wanted.length;
  for (let index = 0; index < wanted.length; index += 1) difference |= wanted[index] ^ (actual[index] ?? 0);
  return difference === 0;
}

export async function serviceAdminTokenAuthorized(request: Request, expected: string | undefined): Promise<boolean> {
  return secretsMatch(request.headers.get("x-admin-token"), expected);
}

export function localAdminSessionToken(session: { userId: string; expiresAt: number }): string {
  return `local-session:${session.userId}:${session.expiresAt}`;
}
