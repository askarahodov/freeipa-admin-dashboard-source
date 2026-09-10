import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  createExecutionContext,
  createStaticAssetsFetcher,
  nodeRequestToWebRequest,
  writeWebResponse,
} from "./node-runtime-http.mjs";

function singleHeaderValue(value) {
  if (Array.isArray(value)) return value.length === 1 ? String(value[0]).trim() : "";
  return String(value ?? "").trim();
}

function constantTimeSecretMatch(expectedValue, suppliedValue) {
  const expected = Buffer.from(String(expectedValue ?? ""));
  const supplied = Buffer.from(singleHeaderValue(suppliedValue));
  if (expected.length === 0 || expected.length !== supplied.length) return false;
  return timingSafeEqual(expected, supplied);
}

function normalizeForwardedProto(value) {
  const candidate = singleHeaderValue(value).toLowerCase();
  return candidate === "http" || candidate === "https" ? candidate : null;
}

function normalizeAuthority(value) {
  const candidate = singleHeaderValue(value);
  if (!candidate || candidate.length > 255 || /[,/\\\s@?#\u0000-\u001f\u007f]/.test(candidate)) return null;
  try {
    const parsed = new URL(`http://${candidate}`);
    if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) return null;
    return parsed.host || null;
  } catch {
    return null;
  }
}

function trustedProxyProof(request, env) {
  if (String(env?.PORTAL_CLIENT_IP_SOURCE ?? "").trim().toLowerCase() !== "trusted-proxy") return false;
  return constantTimeSecretMatch(env?.PORTAL_TRUSTED_PROXY_SECRET, request.headers["x-portal-proxy-secret"]);
}

export function resolveRuntimeOrigin(request, host, port, env = {}) {
  const directHost = normalizeAuthority(request.headers.host) ?? `${host}:${port}`;
  if (!trustedProxyProof(request, env)) return `http://${directHost}`;

  const forwardedProto = normalizeForwardedProto(request.headers["x-forwarded-proto"]);
  const forwardedHost = normalizeAuthority(request.headers["x-forwarded-host"]);
  if (!forwardedProto || !forwardedHost) return `http://${directHost}`;
  return `${forwardedProto}://${forwardedHost}`;
}

function publicAddress(server) {
  const address = server.address();
  if (!address || typeof address === "string") return null;
  return { host: address.address, port: address.port };
}

function validatedWorker(worker) {
  if (!worker || typeof worker.fetch !== "function") {
    throw new Error("Worker artifact must export a default fetch handler");
  }
  return worker;
}

export async function loadWorkerArtifact(artifactPath = "dist/server/index.js") {
  const resolvedArtifactPath = resolve(artifactPath);
  const artifact = await import(pathToFileURL(resolvedArtifactPath).href);
  return validatedWorker(artifact.default);
}

export async function startNodeWorkerHost(options = {}) {
  const artifactPath = resolve(options.artifactPath ?? "dist/server/index.js");
  const assetsRoot = resolve(options.assetsRoot ?? "dist/client");
  const host = options.host ?? "127.0.0.1";
  const port = Number(options.port ?? 0);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("port must be an integer between 0 and 65535");

  const worker = options.worker === undefined
    ? await loadWorkerArtifact(artifactPath)
    : validatedWorker(options.worker);

  const assets = createStaticAssetsFetcher(assetsRoot);
  const runtimeEnv = { ...options.env, ASSETS: assets };
  const activeContexts = new Set();
  let closing = false;

  const server = createServer(async (request, responseStream) => {
    if (closing) {
      responseStream.statusCode = 503;
      responseStream.end("Service Unavailable");
      return;
    }

    const origin = resolveRuntimeOrigin(request, host, port, runtimeEnv);
    const webRequest = nodeRequestToWebRequest(request, origin);

    if ((webRequest.method === "GET" || webRequest.method === "HEAD") && new URL(webRequest.url).pathname.includes(".")) {
      const assetResponse = await assets.fetch(webRequest);
      if (assetResponse.status !== 404) {
        await writeWebResponse(responseStream, assetResponse);
        return;
      }
    }

    const ctx = createExecutionContext();
    activeContexts.add(ctx);
    try {
      const response = await worker.fetch(webRequest, runtimeEnv, ctx);
      await writeWebResponse(responseStream, response);
    } catch (error) {
      if (!responseStream.headersSent) {
        responseStream.statusCode = 500;
        responseStream.setHeader("content-type", "application/json; charset=utf-8");
      }
      if (!responseStream.writableEnded) responseStream.end(JSON.stringify({ error: "runtime_request_failed" }));
      console.error(`Node Worker request failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      await ctx.drain();
      activeContexts.delete(ctx);
    }
  });

  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolvePromise();
    });
  });

  return {
    server,
    worker,
    address: publicAddress(server),
    async close() {
      if (closing) return;
      closing = true;
      await new Promise((resolvePromise, reject) => {
        server.close((error) => error ? reject(error) : resolvePromise());
      });
      await Promise.allSettled([...activeContexts].map((ctx) => ctx.drain()));
    },
  };
}

async function runFromCli() {
  const runtime = await startNodeWorkerHost({
    host: process.env.HOST || "0.0.0.0",
    port: Number(process.env.PORT || 3001),
    env: process.env,
  });

  const address = runtime.address;
  console.log(`Node Worker host listening on ${address?.host ?? "unknown"}:${address?.port ?? "unknown"}`);

  let stopping = false;
  const stop = async (signal) => {
    if (stopping) return;
    stopping = true;
    try {
      await runtime.close();
      process.exitCode = 0;
    } catch (error) {
      console.error(`Node Worker shutdown failed after ${signal}: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  };

  process.once("SIGTERM", () => void stop("SIGTERM"));
  process.once("SIGINT", () => void stop("SIGINT"));
}

const currentModulePath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === resolve(currentModulePath)) {
  await runFromCli();
}
