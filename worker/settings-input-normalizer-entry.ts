import runtime from "./settings-revisions-entry";

type RuntimeEnv = NonNullable<Parameters<typeof runtime.fetch>[1]>;
type RuntimeContext = Parameters<typeof runtime.fetch>[2];
type ScheduledController = Parameters<NonNullable<typeof runtime.scheduled>>[0];

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeSecretReplacement(body: Record<string, unknown>, valueKey: string, clearKey: string): void {
  if (typeof body[valueKey] === "string" && !String(body[valueKey]).trim()) delete body[valueKey];
  if (body[clearKey] !== true) delete body[clearKey];
}

export function normalizeSettingsRequestBody(
  pathname: string,
  method: string,
  body: Record<string, unknown>,
): Record<string, unknown> {
  if (method === "PUT" && pathname === "/api/integrations/settings") {
    const normalized = { ...body };
    normalizeSecretReplacement(normalized, "ipaPassword", "clearIpaPassword");
    normalizeSecretReplacement(normalized, "xyopsApiKey", "clearXyopsApiKey");
    return normalized;
  }

  if (method === "POST" && pathname === "/api/integrations/settings/drafts") {
    const nested = objectValue(body.changes);
    if (nested) {
      if (!Array.isArray(nested.resetFields) || nested.resetFields.length > 0) return body;
      const changes = { ...nested };
      delete changes.resetFields;
      return { ...body, changes };
    }
    if (!Array.isArray(body.resetFields) || body.resetFields.length > 0) return body;
    const normalized = { ...body };
    delete normalized.resetFields;
    return normalized;
  }

  return body;
}

async function normalizedRequest(request: Request): Promise<Request> {
  const url = new URL(request.url);
  const relevant = (request.method === "PUT" && url.pathname === "/api/integrations/settings")
    || (request.method === "POST" && url.pathname === "/api/integrations/settings/drafts");
  if (!relevant) return request;

  const body = await request.clone().json().catch(() => null) as unknown;
  const parsed = objectValue(body);
  if (!parsed) return request;
  const normalized = normalizeSettingsRequestBody(url.pathname, request.method, parsed);
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  headers.set("content-type", "application/json");
  return new Request(request.url, {
    method: request.method,
    headers,
    body: JSON.stringify(normalized),
  });
}

const worker = {
  async fetch(request: Request, env: RuntimeEnv | undefined, ctx: RuntimeContext): Promise<Response> {
    return runtime.fetch(await normalizedRequest(request), env, ctx);
  },

  async scheduled(controller: ScheduledController, env: RuntimeEnv | undefined, ctx: RuntimeContext): Promise<void> {
    return runtime.scheduled?.(controller, env, ctx);
  },
};

export default worker;
