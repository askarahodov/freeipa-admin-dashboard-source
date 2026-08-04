import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";

const allowedMethods = new Set([
  "user_find",
  "user_add",
  "user_mod",
  "user_enable",
  "user_disable",
  "user_del",
  "group_find",
  "group_add",
  "group_del",
  "group_add_member",
  "group_remove_member",
]);

class FreeIpaGatewayError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "FreeIpaGatewayError";
    this.gatewayCode = code;
  }
}

function gatewayError(code, message) {
  return new FreeIpaGatewayError(code, message);
}

function jsonResponse(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(payload));
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

function validFreeIpaUrl(value) {
  try {
    const parsed = new URL(value);
    const loopback = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
    if ((parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) || parsed.username || parsed.password) return null;
    return parsed.href.replace(/\/$/, "");
  } catch { return null; }
}

function requestError(error, stage) {
  const cause = error && typeof error === "object" && "cause" in error ? error.cause : null;
  const rawCode = cause && typeof cause === "object" && "code" in cause ? cause.code : error && typeof error === "object" && "code" in error ? error.code : "";
  const code = typeof rawCode === "string" && /^[A-Z0-9_]+$/.test(rawCode) ? rawCode : "";
  if (["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT"].includes(code) || error?.name === "TimeoutError" || error?.name === "AbortError") {
    return gatewayError("freeipa_timeout", `Таймаут подключения к FreeIPA на этапе «${stage}»`);
  }
  if (["SELF_SIGNED_CERT_IN_CHAIN", "DEPTH_ZERO_SELF_SIGNED_CERT", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "CERT_HAS_EXPIRED", "ERR_TLS_CERT_ALTNAME_INVALID"].includes(code)) {
    return gatewayError("freeipa_tls_failed", `TLS-сертификат FreeIPA не принят Node Gateway (${code})`);
  }
  if (["ENOTFOUND", "EAI_AGAIN"].includes(code)) {
    return gatewayError("freeipa_dns_failed", `DNS-имя FreeIPA не разрешается из Node Gateway (${code})`);
  }
  if (["ECONNREFUSED", "ECONNRESET"].includes(code)) {
    return gatewayError("freeipa_unavailable", `FreeIPA разорвал или отклонил соединение на этапе «${stage}» (${code})`);
  }
  return gatewayError("freeipa_unavailable", `Node Gateway не смог подключиться к FreeIPA на этапе «${stage}»`);
}

function protocolError(message) {
  return gatewayError("freeipa_protocol_failed", message);
}

export async function runFreeIpaRpc(input, fetchImpl = fetch) {
  const ipaUrl = validFreeIpaUrl(input?.ipaUrl);
  const username = typeof input?.username === "string" ? input.username.trim() : "";
  const password = typeof input?.password === "string" ? input.password : "";
  const method = typeof input?.method === "string" ? input.method : "";
  const args = Array.isArray(input?.args) ? input.args : [""];
  const options = input?.options && typeof input.options === "object" && !Array.isArray(input.options) ? input.options : {};
  if (!ipaUrl || !username || !password || username.length > 256 || password.length > 4096 || !allowedMethods.has(method)) {
    throw protocolError("Некорректный запрос к локальному FreeIPA Gateway");
  }

  let login;
  try {
    login = await fetchImpl(`${ipaUrl}/ipa/session/login_password`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "text/plain", referer: `${ipaUrl}/ipa/ui/` },
      body: new URLSearchParams({ user: username, password }),
      signal: AbortSignal.timeout(10000),
    });
  } catch (error) { throw requestError(error, "вход"); }
  if (login.status >= 300 && login.status < 400) throw protocolError(`FreeIPA перенаправляет endpoint входа (HTTP ${login.status})`);
  if (login.status === 401 || login.status === 403) throw gatewayError("freeipa_auth_rejected", `FreeIPA отклонил учётные данные (HTTP ${login.status})`);
  if (!login.ok) {
    const code = login.status >= 500 ? "freeipa_unavailable" : "freeipa_protocol_failed";
    throw gatewayError(code, `Endpoint входа FreeIPA вернул HTTP ${login.status}`);
  }
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw protocolError("FreeIPA не вернул session cookie");

  let rpc;
  try {
    rpc = await fetchImpl(`${ipaUrl}/ipa/session/json`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/json", accept: "application/json", referer: `${ipaUrl}/ipa/ui/`, cookie },
      body: JSON.stringify({ method, params: [args, options], id: 0 }),
      signal: AbortSignal.timeout(20000),
    });
  } catch (error) { throw requestError(error, "JSON-RPC"); }
  if (rpc.status >= 300 && rpc.status < 400) throw protocolError(`FreeIPA перенаправляет JSON-RPC endpoint (HTTP ${rpc.status})`);
  if (rpc.status === 401 || rpc.status === 403) throw gatewayError("freeipa_auth_rejected", `FreeIPA отклонил JSON-RPC сессию (HTTP ${rpc.status})`);
  const payload = await rpc.json().catch(() => { throw protocolError(`JSON-RPC FreeIPA вернул не-JSON ответ (HTTP ${rpc.status})`); });
  if (!rpc.ok) {
    const code = rpc.status >= 500 ? "freeipa_unavailable" : "freeipa_protocol_failed";
    throw gatewayError(code, `JSON-RPC FreeIPA вернул HTTP ${rpc.status}`);
  }
  if (payload?.error) throw protocolError(payload.error.message || `${method} failed`);
  return Array.isArray(payload?.result?.result) ? payload.result.result : [];
}

export function createFreeIpaGateway({ token, fetchImpl = fetch }) {
  if (!token) throw new Error("FreeIPA Gateway token is required");
  return createServer((request, response) => {
    void (async () => {
      const provided = request.headers.authorization?.replace(/^Bearer\s+/i, "") || "";
      if (request.method === "GET" && request.url === "/health") {
        if (!safeEqual(provided, token)) {
          return jsonResponse(response, 401, { ok: false, code: "gateway_authorization_required" });
        }
        return jsonResponse(response, 200, { ok: true, code: "gateway_ready" });
      }
      if (request.method !== "POST" || request.url !== "/rpc") return jsonResponse(response, 404, { error: "Not found" });
      if (!safeEqual(provided, token)) return jsonResponse(response, 401, { error: "Unauthorized" });
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 32768) return jsonResponse(response, 413, { error: "Request too large" });
        chunks.push(chunk);
      }
      let input;
      try { input = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
      catch { return jsonResponse(response, 400, { error: "Invalid JSON" }); }
      try { return jsonResponse(response, 200, { result: await runFreeIpaRpc(input, fetchImpl) }); }
      catch (error) {
        return jsonResponse(response, 502, {
          error: error instanceof Error ? error.message : "FreeIPA Gateway request failed",
          code: error instanceof FreeIpaGatewayError ? error.gatewayCode : "freeipa_protocol_failed",
        });
      }
    })().catch(() => jsonResponse(response, 500, { error: "FreeIPA Gateway internal error", code: "freeipa_protocol_failed" }));
  });
}
