export type FreeIpaRpcEnv = {
  IPA_USERNAME?: string;
  IPA_PASSWORD?: string;
  IPA_NODE_GATEWAY_URL?: string;
  IPA_NODE_GATEWAY_TOKEN?: string;
};

function freeIpaNetworkError(error: unknown, stage: "вход" | "JSON-RPC" | "Node Gateway"): Error {
  const name = error instanceof Error ? error.name : "RequestError";
  const cause = error && typeof error === "object" && "cause" in error ? (error as { cause?: unknown }).cause : null;
  const rawCode = cause && typeof cause === "object" && "code" in cause ? (cause as { code?: unknown }).code : error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : "";
  const code = typeof rawCode === "string" && /^[A-Z0-9_]+$/.test(rawCode) ? rawCode : "";
  if (name === "TimeoutError" || name === "AbortError" || ["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT"].includes(code)) return new Error(`Таймаут подключения к FreeIPA на этапе «${stage}»`);
  if (["SELF_SIGNED_CERT_IN_CHAIN", "DEPTH_ZERO_SELF_SIGNED_CERT", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "CERT_HAS_EXPIRED", "ERR_TLS_CERT_ALTNAME_INVALID"].includes(code)) return new Error(`TLS-сертификат FreeIPA не принят средой портала (${code})`);
  if (["ENOTFOUND", "EAI_AGAIN"].includes(code)) return new Error(`DNS-имя FreeIPA не разрешается из среды портала (${code})`);
  if (["ECONNREFUSED", "ECONNRESET"].includes(code)) return new Error(`FreeIPA разорвал или отклонил соединение на этапе «${stage}» (${code})`);
  return new Error(`FreeIPA недоступен из среды портала на этапе «${stage}»: проверьте публичный DNS, TLS-сертификат, firewall и доступ к /ipa/session/*`);
}

async function freeIpaFetch(url: string, init: RequestInit, stage: "вход" | "JSON-RPC"): Promise<Response> {
  try { return await fetch(url, init); }
  catch (error) { throw freeIpaNetworkError(error, stage); }
}

export async function freeIpaRpc(env: FreeIpaRpcEnv, ipaUrl: string, method: string, args: unknown[] = [""], options: Record<string, unknown> = {}): Promise<Array<Record<string, unknown>>> {
  if (!env.IPA_USERNAME || !env.IPA_PASSWORD) throw new Error("FreeIPA credentials are not configured");
  if (env.IPA_NODE_GATEWAY_URL && env.IPA_NODE_GATEWAY_TOKEN) {
    let gatewayResponse: Response;
    try {
      gatewayResponse = await fetch(`${env.IPA_NODE_GATEWAY_URL}/rpc`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${env.IPA_NODE_GATEWAY_TOKEN}` },
        body: JSON.stringify({ ipaUrl, username: env.IPA_USERNAME, password: env.IPA_PASSWORD, method, args, options }),
        signal: AbortSignal.timeout(35000),
      });
    } catch (error) { throw freeIpaNetworkError(error, "Node Gateway"); }
    const gatewayPayload = await gatewayResponse.json().catch(() => null) as { result?: Array<Record<string, unknown>>; error?: string } | null;
    if (!gatewayResponse.ok) throw new Error(gatewayPayload?.error || `FreeIPA Node Gateway вернул HTTP ${gatewayResponse.status}`);
    return Array.isArray(gatewayPayload?.result) ? gatewayPayload.result : [];
  }
  const login = await freeIpaFetch(`${ipaUrl}/ipa/session/login_password`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "text/plain", referer: `${ipaUrl}/ipa/ui/` },
    body: new URLSearchParams({ user: env.IPA_USERNAME, password: env.IPA_PASSWORD }),
    signal: AbortSignal.timeout(10000),
    redirect: "manual",
  }, "вход");
  if (login.status >= 300 && login.status < 400) throw new Error(`FreeIPA перенаправляет endpoint входа (HTTP ${login.status}); укажите конечный HTTPS-адрес сервера`);
  if (login.status === 401 || login.status === 403) throw new Error(`FreeIPA отклонил учётные данные (HTTP ${login.status})`);
  if (!login.ok) throw new Error(`Endpoint входа FreeIPA вернул HTTP ${login.status}`);
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("FreeIPA session cookie missing");
  const rpc = await freeIpaFetch(`${ipaUrl}/ipa/session/json`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", referer: `${ipaUrl}/ipa/ui/`, cookie },
    body: JSON.stringify({ method, params: [args, options], id: 0 }),
    signal: AbortSignal.timeout(20000),
    redirect: "manual",
  }, "JSON-RPC");
  if (rpc.status >= 300 && rpc.status < 400) throw new Error(`FreeIPA перенаправляет JSON-RPC endpoint (HTTP ${rpc.status})`);
  const payload = await rpc.json().catch(() => { throw new Error(`JSON-RPC FreeIPA вернул не-JSON ответ (HTTP ${rpc.status})`); }) as { result?: { result?: Array<Record<string, unknown>> }; error?: { message?: string } | null };
  if (!rpc.ok || payload.error) throw new Error(payload.error?.message ?? `${method} failed`);
  return payload.result?.result ?? [];
}
